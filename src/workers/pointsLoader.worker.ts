/// <reference lib="webworker" />
/**
 * Off-main-thread loader for the v3 point dataset.
 *
 * Fetching + JSON.parse (~20MB) + normalization runs here so the UI thread
 * stays responsive (no ~300-500ms parse hitch that would stutter the shell
 * animation). We also pre-extract a transferable Float32Array of positions so
 * the renderer can seed geometry cheaply.
 */
import type { Sample } from '../types';

interface PointsData {
  points: Sample[];
}

const VIDEO_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i;
const isVideoUrl = (url: string) => VIDEO_RE.test(url);

function normalizeV3Sample(s: Sample): Sample {
  const imgs = s.images ?? [];
  const vids = s.videos ?? [];
  if (vids.length === 0 && imgs.length > 0 && imgs.every(isVideoUrl)) {
    return { ...s, videos: imgs, images: undefined };
  }
  return s;
}

interface RequestMsg {
  url: string;
}

export interface PointsLoadedMsg {
  ok: true;
  samples: Sample[];
  positions: Float32Array;
}

export interface PointsErrorMsg {
  ok: false;
  error: string;
}

self.onmessage = async (e: MessageEvent<RequestMsg>) => {
  const { url } = e.data;
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) {
      throw new Error(`Failed to load v3 dataset (${res.status} ${res.statusText})`);
    }
    const data = (await res.json()) as PointsData;
    const raw = data.points || [];
    const samples = raw.map(normalizeV3Sample);

    const positions = new Float32Array(samples.length * 3);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      positions[i * 3] = s.x ?? 0;
      positions[i * 3 + 1] = s.y ?? 0;
      positions[i * 3 + 2] = s.z ?? 0;
    }

    const msg: PointsLoadedMsg = { ok: true, samples, positions };
    // Transfer the positions buffer to avoid a copy.
    (self as unknown as Worker).postMessage(msg, [positions.buffer]);
  } catch (err) {
    const msg: PointsErrorMsg = {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to load dataset',
    };
    (self as unknown as Worker).postMessage(msg);
  }
};
