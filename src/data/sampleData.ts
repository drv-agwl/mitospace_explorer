import type { DatasetVersion, Sample } from '../types';

interface PointsData {
  points: Sample[];
}

// v3 (~20 MB) is served from /public/data and fetched on demand so the
// initial JS bundle stays small. Parsed result is cached after first fetch.
// (v1/2D JSON under src/data/ is archival and no longer imported.)
let samples4DV3Cache: Sample[] | null = null;
let samples4DV3Promise: Promise<Sample[]> | null = null;

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url);
}

/**
 * v3 stores its single MitoTracker movie in the `images` field as an .mp4 URL.
 * Promote those to `videos` so the existing UI plays them as movies.
 */
function normalizeV3Sample(s: Sample): Sample {
  const imgs = s.images ?? [];
  const vids = s.videos ?? [];
  if (vids.length === 0 && imgs.length > 0 && imgs.every(isVideoUrl)) {
    return { ...s, videos: imgs, images: undefined };
  }
  return s;
}

function datasetUrl(): string {
  // Use Vite's BASE_URL so it works under any deploy path.
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const path = `${base}/data/points4d_v3.json`;
  // Workers (esp. Vite blob: workers in production) have no document base URL,
  // so fetch('/data/...') throws "Failed to parse URL". Always absolute.
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL(path, window.location.href).href;
  }
  return path;
}

/** Main-thread fallback when Web Workers are unavailable. */
async function fetchSamples4DV3OnMain(): Promise<Sample[]> {
  const res = await fetch(datasetUrl(), { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load v3 dataset (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as PointsData;
  const points = data.points || [];
  return points.map(normalizeV3Sample);
}

/** Parse the dataset in a Web Worker so the ~20MB JSON.parse never blocks the UI. */
function fetchSamples4DV3ViaWorker(): Promise<Sample[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../workers/pointsLoader.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (err) {
      // Worker construction failed (e.g. unsupported env) — fall back.
      fetchSamples4DV3OnMain().then(resolve, reject);
      return;
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      worker.terminate();
      if (msg?.ok) {
        resolve(msg.samples as Sample[]);
      } else {
        // Worker fetch/parse failed — fall back to main thread rather than
        // hard-failing (covers edge cases like opaque worker origins).
        console.warn('[dataset] worker failed, falling back to main thread:', msg?.error);
        fetchSamples4DV3OnMain().then(resolve, reject);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      // Fall back to main-thread parse on worker error.
      fetchSamples4DV3OnMain().then(resolve, reject);
    };
    worker.postMessage({ url: datasetUrl() });
  });
}

export function loadSamples4DV3(): Promise<Sample[]> {
  if (samples4DV3Cache) return Promise.resolve(samples4DV3Cache);
  if (samples4DV3Promise) return samples4DV3Promise;
  const loader =
    typeof Worker !== 'undefined' ? fetchSamples4DV3ViaWorker() : fetchSamples4DV3OnMain();
  samples4DV3Promise = loader.then((pts) => {
    samples4DV3Cache = pts;
    return pts;
  });
  return samples4DV3Promise;
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
