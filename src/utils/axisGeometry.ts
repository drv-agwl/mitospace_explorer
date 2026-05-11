/**
 * Geometry helpers for the new semantic-axis representations.
 *
 * Why this module exists
 * ----------------------
 * The original "tube" representation drew a continuous Catmull-Rom spline
 * through smoothed bin centroids in UMAP space. The visual gestalt of a
 * continuous curve made users read it as a path through cells — even when
 * the curve crossed empty UMAP regions where no cells live.
 *
 * The helpers below let us draw alternative representations that stay
 * grounded in the data:
 *  - `computeQuantileBeads`: discrete waypoints anchored to actual cell
 *    centroids at evenly spaced feature quantiles. Every bead lives inside
 *    a dense region by construction.
 *  - `segmentDensity`: how well a 3D line segment is "supported" by nearby
 *    cells. Used to fade tube segments / bead connectors in empty regions
 *    so the visualization stops claiming what the data doesn't say.
 *  - `computeEndpointAnchors`: centroids of the bottom-p% and top-p%
 *    feature-value cells — used as "Low"/"High" anchor markers in the
 *    `bare` axis style.
 *
 * All inputs/outputs use *raw UMAP coordinates* (the same coordinates as
 * `Sample.{x,y,z}`). Callers are responsible for transforming to scene
 * space (subtract cloud centroid, multiply by SCALE_FACTOR).
 */

import type { Sample } from '../types';

export interface AxisBead {
  /** Raw UMAP coordinates. */
  x: number;
  y: number;
  z: number;
  /** Average feature value of the contributing cells. */
  value: number;
  /** Normalized position along the chain in [0, 1]. */
  t: number;
}

export interface EndpointAnchors {
  low: { x: number; y: number; z: number; value: number };
  high: { x: number; y: number; z: number; value: number };
}

interface FeatureEntry {
  v: number;
  i: number;
}

/**
 * Build (value, index) pairs for samples that have a finite feature value.
 * Sorted ascending by value. Returned indices reference `samples` directly.
 */
function buildSortedEntries(
  samples: readonly Sample[],
  featureValues: readonly number[],
  embeddingIndexOf: (sampleIdx: number) => number
): FeatureEntry[] {
  const out: FeatureEntry[] = [];
  for (let i = 0; i < samples.length; i++) {
    const ei = embeddingIndexOf(i);
    if (ei < 0 || ei >= featureValues.length) continue;
    const v = featureValues[ei];
    if (!Number.isFinite(v)) continue;
    out.push({ v, i });
  }
  out.sort((a, b) => a.v - b.v);
  return out;
}

/**
 * Compute `N` waypoint beads spread evenly across the feature value range.
 *
 * For each quantile target value we take the centroid (in raw UMAP space)
 * of the `K` cells whose feature values are nearest that target. This
 * guarantees beads land inside dense regions — there is no fitted curve
 * that can wander through empty UMAP valleys.
 *
 * Returns `[]` if there is no data; otherwise an array of at most `N`
 * beads, sorted from low → high feature value.
 */
export function computeQuantileBeads(
  samples: readonly Sample[],
  featureValues: readonly number[],
  embeddingIndexOf: (sampleIdx: number) => number,
  featureRange: { min: number; max: number },
  N: number = 7,
  K: number = 24
): AxisBead[] {
  if (samples.length === 0 || featureValues.length === 0 || N < 2) return [];
  const entries = buildSortedEntries(samples, featureValues, embeddingIndexOf);
  if (entries.length === 0) return [];

  const range = featureRange.max - featureRange.min;
  if (!Number.isFinite(range) || range <= 0) return [];

  const beads: AxisBead[] = [];
  for (let q = 0; q < N; q++) {
    const t = q / (N - 1);
    const target = featureRange.min + t * range;

    // Binary search for the entry with value closest to target.
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].v < target) lo = mid + 1;
      else hi = mid;
    }
    const center = Math.min(entries.length - 1, lo);

    // Take K nearest neighbors *in feature-value space*, then centroid their
    // UMAP positions. This is more robust to multimodal distributions than
    // averaging cells in a fixed feature-value window.
    const half = Math.floor(K / 2);
    let start = center - half;
    let end = center + (K - half);
    if (start < 0) {
      end += -start;
      start = 0;
    }
    if (end > entries.length) {
      start = Math.max(0, start - (end - entries.length));
      end = entries.length;
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sv = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const s = samples[entries[j].i];
      sx += s.x;
      sy += s.y;
      sz += s.z;
      sv += entries[j].v;
      count++;
    }
    if (count === 0) continue;
    beads.push({
      x: sx / count,
      y: sy / count,
      z: sz / count,
      value: sv / count,
      t,
    });
  }
  return beads;
}

/**
 * Centroids of the bottom-`pct` and top-`pct` cells by feature value.
 * Used to plant "Low" / "High" endpoint anchors in the `bare` axis style.
 *
 * Returns `null` if there's no data.
 */
export function computeEndpointAnchors(
  samples: readonly Sample[],
  featureValues: readonly number[],
  embeddingIndexOf: (sampleIdx: number) => number,
  pct: number = 0.05
): EndpointAnchors | null {
  const entries = buildSortedEntries(samples, featureValues, embeddingIndexOf);
  if (entries.length === 0) return null;
  const k = Math.max(1, Math.floor(entries.length * pct));
  const slice = (start: number, end: number) => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sv = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const s = samples[entries[j].i];
      sx += s.x;
      sy += s.y;
      sz += s.z;
      sv += entries[j].v;
      count++;
    }
    return {
      x: sx / count,
      y: sy / count,
      z: sz / count,
      value: sv / count,
    };
  };
  return {
    low: slice(0, k),
    high: slice(entries.length - k, entries.length),
  };
}

/**
 * Estimate a sensible neighborhood radius (in raw UMAP units) for density
 * queries on a given sample cloud.
 *
 * Heuristic: scale a "typical inter-point distance" from the cloud's
 * bounding box volume and sample count, so the same density helper works
 * across v1 / v3 datasets of different sizes without re-tuning.
 */
export function estimateDensityRadius(samples: readonly Sample[]): number {
  if (samples.length === 0) return 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
    if (s.z < minZ) minZ = s.z;
    if (s.z > maxZ) maxZ = s.z;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const vol = Math.max(1e-9, dx * dy * dz);
  // Typical cube-root distance per point, then upscale ~3x so the
  // neighborhood is meaningful (≈26 neighbors at uniform density).
  const perPoint = Math.cbrt(vol / Math.max(1, samples.length));
  return perPoint * 3.0;
}

/**
 * Average local point density along a 3D line segment, returned in [0, 1]
 * where 1 = saturated with data, 0 = no data nearby.
 *
 * We sample `samplesAlong` evenly spaced positions along the segment, count
 * cells within `radius`, and normalize by `expectedFull` (the count we'd
 * consider "fully supported"). The result is averaged across sample
 * positions and clamped.
 *
 * O(samplesAlong * N) — for clouds < 100K and `samplesAlong` ~ 6 this is
 * fine without spatial indexing. If we ever push much larger clouds we
 * should add a grid hash here.
 */
export function segmentDensity(
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  samples: readonly Sample[],
  radius: number,
  samplesAlong: number = 6,
  expectedFull: number = 30
): number {
  if (samples.length === 0) return 0;
  const r2 = radius * radius;
  let acc = 0;
  for (let s = 0; s < samplesAlong; s++) {
    const t = (s + 0.5) / samplesAlong;
    const px = p0.x + (p1.x - p0.x) * t;
    const py = p0.y + (p1.y - p0.y) * t;
    const pz = p0.z + (p1.z - p0.z) * t;
    let count = 0;
    for (let i = 0; i < samples.length; i++) {
      const dx = samples[i].x - px;
      const dy = samples[i].y - py;
      const dz = samples[i].z - pz;
      if (dx * dx + dy * dy + dz * dz <= r2) count++;
    }
    acc += Math.min(1, count / expectedFull);
  }
  return acc / samplesAlong;
}

/**
 * Bulk density evaluation along a polyline. Returns one density value in
 * [0, 1] for each adjacent (i, i+1) segment.
 */
export function polylineSegmentDensities(
  polyline: ReadonlyArray<{ x: number; y: number; z: number }>,
  samples: readonly Sample[],
  radius: number
): Float32Array {
  const n = polyline.length;
  if (n < 2) return new Float32Array(0);
  const out = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    out[i] = segmentDensity(polyline[i], polyline[i + 1], samples, radius);
  }
  return out;
}
