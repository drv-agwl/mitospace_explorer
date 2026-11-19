/// <reference lib="webworker" />
/**
 * Dataset worker: loads the compact v3 dataset off the main thread, then stays
 * alive to run the per-feature axis work (k-NN colour smoothing and the cursor
 * path), which would otherwise freeze the page for a few hundred ms per switch.
 */
import {
  COMPACT_FORMAT,
  compactRowHash,
  type CompactHeader,
  type CompactPoints,
} from '../data/compactPoints';
import { computeFeatureAxis } from '../utils/featureAxis';
import type { CursorPath } from '../utils/axisCursorPath';
import type { Sample } from '../types';

export type DatasetWorkerRequest =
  | { type: 'load'; url: string }
  | {
      type: 'axis';
      id: number;
      /** Feature values by embedding index (NaN = no measurement). */
      values: Float32Array;
      /** Embedding index of each visible cell, in display order; null = all cells. */
      indices: Int32Array | null;
      range: { min: number; max: number };
    };

export type DatasetWorkerResponse =
  | {
      type: 'loaded';
      ok: true;
      header: CompactHeader;
      xyz: Float32Array;
      condition: Uint16Array;
      rowHash: string;
    }
  | { type: 'loaded'; ok: false; error: string }
  | { type: 'axis'; id: number; smoothed: Float32Array; cursorPath: CursorPath | null }
  | { type: 'axis-error'; id: number; error: string };

let xyz: Float32Array | null = null;
let points: Array<Pick<Sample, 'x' | 'y' | 'z'>> = [];

const post = (msg: DatasetWorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

async function load(url: string) {
  try {
    // Absolute URL: blob workers (Vite production) have no base URL to resolve against.
    const res = await fetch(new URL(url, self.location.href).href);
    if (!res.ok) throw new Error(`Failed to load dataset (${res.status} ${res.statusText})`);
    const data = (await res.json()) as CompactPoints;
    if (data.format !== COMPACT_FORMAT) throw new Error(`Unexpected dataset format: ${data.format}`);
    const { condition: cond, xyz: coords, ...header } = data;
    const all = Float32Array.from(coords);
    xyz = all;
    points = Array.from({ length: data.count }, (_, i) => ({
      x: all[i * 3],
      y: all[i * 3 + 1],
      z: all[i * 3 + 2],
    }));
    const condition = Uint16Array.from(cond);
    const rowHash = compactRowHash(header, condition);
    const copy = all.slice();
    post({ type: 'loaded', ok: true, header, xyz: copy, condition, rowHash }, [copy.buffer, condition.buffer]);
  } catch (err) {
    post({ type: 'loaded', ok: false, error: err instanceof Error ? err.message : 'Failed to load dataset' });
  }
}

function axis(req: Extract<DatasetWorkerRequest, { type: 'axis' }>) {
  try {
    if (!xyz) throw new Error('dataset not loaded');
    const { smoothed, cursorPath } = computeFeatureAxis(xyz, points, req.values, req.indices, req.range);
    const transfer: Transferable[] = [smoothed.buffer];
    if (cursorPath) transfer.push(cursorPath.positions.buffer, cursorPath.values.buffer);
    post({ type: 'axis', id: req.id, smoothed, cursorPath }, transfer);
  } catch (err) {
    post({ type: 'axis-error', id: req.id, error: err instanceof Error ? err.message : 'axis failed' });
  }
}

self.onmessage = (e: MessageEvent<DatasetWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') void load(msg.url);
  else if (msg.type === 'axis') axis(msg);
};
