import type { DatasetVersion, Sample } from '../types';
import points2dData from './points2d.json';
import points4dData from './points4d.json';

interface PointsData {
  points: Sample[];
}

// v1 datasets are bundled (statically imported) for instant load.
export const samples2D: Sample[] = (points2dData as PointsData)?.points || [];
export const samples4D: Sample[] = (points4dData as PointsData)?.points || [];

// v3 (~19 MB) is served from /public/data and fetched on demand to keep the
// initial bundle small. We cache the parsed result after the first fetch.
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

async function fetchSamples4DV3(): Promise<Sample[]> {
  // Use Vite's BASE_URL so it works under any deploy path.
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const url = `${base}/data/points4d_v3.json`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load v3 dataset (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as PointsData;
  const points = data.points || [];
  return points.map(normalizeV3Sample);
}

export function loadSamples4DV3(): Promise<Sample[]> {
  if (samples4DV3Cache) return Promise.resolve(samples4DV3Cache);
  if (samples4DV3Promise) return samples4DV3Promise;
  samples4DV3Promise = fetchSamples4DV3().then((pts) => {
    samples4DV3Cache = pts;
    return pts;
  });
  return samples4DV3Promise;
}

/** Convenience: returns the 4D samples for the requested dataset version. */
export function loadSamples4D(version: DatasetVersion): Promise<Sample[]> {
  if (version === 'v1') return Promise.resolve(samples4D);
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

export const timepoints4D = Array.from(
  new Set(samples4D.map((sample) => sample.t || 0))
).sort((a, b) => a - b);
