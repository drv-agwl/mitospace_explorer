import type { DatasetVersion, Sample } from '../types';
import compactDatasetUrl from './points4d_v3.compact.json?url';
import { COMPACT_FORMAT, compactRowHash, samplesFromCompact, type CompactPoints } from './compactPoints';
import { computeFeatureAxis, type FeatureAxis } from '../utils/featureAxis';
import type { DatasetWorkerRequest, DatasetWorkerResponse } from '../workers/pointsLoader.worker';

// The compact dataset (~1 MB, scripts/compact_v3_points.mjs) is a Vite asset with a
// content-hashed name, so it is cached as immutable yet never stale after a deploy.
let samples4DV3Cache: Sample[] | null = null;
let samples4DV3Promise: Promise<Sample[]> | null = null;
/** Coordinates by embedding index, for main-thread fallbacks. */
let xyzCache: Float32Array | null = null;
let rowHashCache: string | null = null;
/** Kept alive after loading to run per-feature axis work off the main thread. */
let datasetWorker: Worker | null = null;
let nextAxisRequest = 1;
const pendingAxis = new Map<number, { resolve: (r: FeatureAxis) => void; reject: (e: Error) => void }>();

function datasetUrl(): string {
  // Workers (esp. Vite blob: workers in production) have no document base URL, so pass an absolute one.
  return new URL(compactDatasetUrl, window.location.href).href;
}

/** Main-thread fallback when Web Workers are unavailable. */
async function fetchSamples4DV3OnMain(): Promise<Sample[]> {
  const res = await fetch(datasetUrl());
  if (!res.ok) {
    throw new Error(`Failed to load v3 dataset (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as CompactPoints;
  if (data.format !== COMPACT_FORMAT) throw new Error(`Unexpected dataset format: ${data.format}`);
  const { condition, xyz, ...header } = data;
  xyzCache = Float32Array.from(xyz);
  rowHashCache = compactRowHash(header, condition);
  return samplesFromCompact(header, xyzCache, condition);
}

function rejectPendingAxis(reason: string) {
  for (const { reject } of pendingAxis.values()) reject(new Error(reason));
  pendingAxis.clear();
}

/** Fetch and parse the dataset in a Web Worker so the UI never blocks on it. */
function fetchSamples4DV3ViaWorker(): Promise<Sample[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../workers/pointsLoader.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      fetchSamples4DV3OnMain().then(resolve, reject);
      return;
    }
    let loaded = false;

    const fallBack = (reason: string) => {
      worker.terminate();
      if (datasetWorker === worker) datasetWorker = null;
      rejectPendingAxis(reason);
      if (loaded) return;
      console.warn('[dataset] worker failed, falling back to main thread:', reason);
      fetchSamples4DV3OnMain().then(resolve, reject);
    };

    worker.onmessage = (e: MessageEvent<DatasetWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'loaded') {
        if (!msg.ok) {
          fallBack(msg.error);
          return;
        }
        loaded = true;
        datasetWorker = worker;
        xyzCache = msg.xyz;
        rowHashCache = msg.rowHash;
        try {
          resolve(samplesFromCompact(msg.header, msg.xyz, msg.condition));
        } catch (err) {
          reject(err);
        }
        return;
      }
      const pending = pendingAxis.get(msg.id);
      pendingAxis.delete(msg.id);
      if (msg.type === 'axis') pending?.resolve({ smoothed: msg.smoothed, cursorPath: msg.cursorPath });
      else pending?.reject(new Error(msg.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      fallBack(e.message || 'worker error');
    };
    worker.postMessage({ type: 'load', url: datasetUrl() } satisfies DatasetWorkerRequest);
  });
}

/** Hash of the loaded dataset's per-row condition order (null until it has loaded). */
export function getDatasetRowHash(): string | null {
  return rowHashCache;
}

export function loadSamples4DV3(): Promise<Sample[]> {
  if (samples4DV3Cache) return Promise.resolve(samples4DV3Cache);
  if (samples4DV3Promise) return samples4DV3Promise;
  const loader =
    typeof Worker !== 'undefined' ? fetchSamples4DV3ViaWorker() : fetchSamples4DV3OnMain();
  samples4DV3Promise = loader.then(
    (pts) => {
      samples4DV3Cache = pts;
      return pts;
    },
    (err) => {
      // Forget the failed attempt so Retry starts a fresh request.
      samples4DV3Promise = null;
      throw err;
    }
  );
  return samples4DV3Promise;
}

function featureAxisOnMain(
  values: Float32Array,
  indices: Int32Array | null,
  range: { min: number; max: number }
): FeatureAxis {
  if (!xyzCache || !samples4DV3Cache) throw new Error('dataset not loaded');
  return computeFeatureAxis(xyzCache, samples4DV3Cache, values, indices, range);
}

function requestFeatureAxis(
  values: Float32Array,
  indices: Int32Array | null,
  range: { min: number; max: number }
): Promise<FeatureAxis> {
  const worker = datasetWorker;
  if (!worker) return Promise.resolve().then(() => featureAxisOnMain(values, indices, range));
  // The worker gets its own copies; the main thread may still need the originals for a fallback.
  const v = values.slice();
  const idx = indices ? indices.slice() : null;
  const id = nextAxisRequest++;
  return new Promise<FeatureAxis>((resolve, reject) => {
    pendingAxis.set(id, { resolve, reject });
    worker.postMessage(
      { type: 'axis', id, values: v, indices: idx, range } satisfies DatasetWorkerRequest,
      idx ? [v.buffer, idx.buffer] : [v.buffer]
    );
  }).catch(() => featureAxisOnMain(values, indices, range));
}

const AXIS_CACHE_SIZE = 12;
const featureAxisCache = new Map<string, Promise<FeatureAxis>>();

/**
 * Smoothed colour values and cursor path for one feature over the visible cells,
 * computed in the dataset worker and cached by `key` (feature + filter + range),
 * so switching back to a feature is instant.
 */
export function loadFeatureAxis(
  key: string,
  values: ArrayLike<number>,
  indices: Int32Array | null,
  range: { min: number; max: number }
): Promise<FeatureAxis> {
  const hit = featureAxisCache.get(key);
  if (hit) {
    featureAxisCache.delete(key);
    featureAxisCache.set(key, hit);
    return hit;
  }
  const request = requestFeatureAxis(Float32Array.from(values), indices, range);
  featureAxisCache.set(key, request);
  request.catch(() => featureAxisCache.delete(key));
  while (featureAxisCache.size > AXIS_CACHE_SIZE) {
    featureAxisCache.delete(featureAxisCache.keys().next().value as string);
  }
  return request;
}

/** Convenience: returns the 4D samples for the requested dataset version. */
export function loadSamples4D(version: DatasetVersion): Promise<Sample[]> {
  if (version === 'v1') {
    return Promise.reject(new Error('v1 dataset is no longer shipped in the client bundle'));
  }
  return loadSamples4DV3();
}

export const groupSamplesByTime = (samples: Sample[]): Record<number, Sample[]> => {
  return samples.reduce((acc, sample) => {
    const time = sample.t || 0;
    if (!acc[time]) {
      acc[time] = [];
    }
    acc[time].push(sample);
    return acc;
  }, {} as Record<number, Sample[]>);
};

export function timepointsFromSamples(samples: Sample[]): number[] {
  return Array.from(new Set(samples.map((sample) => sample.t || 0))).sort((a, b) => a - b);
}
