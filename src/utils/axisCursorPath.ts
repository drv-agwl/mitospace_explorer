/**
 * Cell-anchored cursor path for the "Cursor" axis style.
 *
 * The cursor traverses the UMAP cloud as the user drags the slider. Two
 * hard requirements:
 *
 *   (A) the cursor must NEVER be in empty space — every position it
 *       occupies must be on top of real cells;
 *   (B) when the feature genuinely lives in disjoint clusters, the
 *       cursor must visit ALL of them as the slider sweeps the range,
 *       not just the dominant one.
 *
 * Why a centroid / Viterbi was wrong
 * ----------------------------------
 * - A kernel-weighted centroid of "K cells whose values are nearest v"
 *   can fall in empty space if those K cells are split across UMAP
 *   clusters (violates A).
 * - Viterbi with a momentum + density cost over-prefers the dense main
 *   cluster's *outlier cells* — physically close to the previous pick —
 *   over genuine cells in disjoint outlier clusters (violates B).
 *
 * What this implementation does
 * -----------------------------
 * Mode-seeking by bucket count, with a teleport-aware evaluator.
 *
 * For each of `resolution` slider positions:
 *   1. Pick the K cells whose feature values are nearest the target.
 *   2. Hash each candidate's (x, y, z) into a coarse bucket; count
 *      candidates per bucket. The bucket with the most candidates is
 *      "where cells with this feature value actually live".
 *   3. Within that dominant bucket, pick the cell with the highest local
 *      density (so we land at a high-confidence point inside the
 *      cluster, not at its fringe).
 *
 * This guarantees:
 *   - every row of the path is at a real cell (A);
 *   - when the feature spans disjoint clusters and the slider moves
 *     into a value range that lives in a different cluster, the
 *     dominant bucket shifts and the path's row honestly teleports
 *     there (B).
 *
 * `evaluateCursorPath` then refuses to linearly interpolate across two
 * rows that are physically far apart (`> maxLerpDist`), instead snapping
 * to whichever row is closer in feature value. So the ball glides
 * smoothly through contiguous cluster regions but *snaps* across
 * inter-cluster gaps — never crossing empty space.
 */

import type { Sample } from '../types';
import { estimateDensityRadius } from './axisGeometry';

export interface CursorPath {
  /** Flat XYZ buffer, length = resolution * 3. RAW UMAP coordinates. */
  positions: Float32Array;
  /** Length-`resolution` array of the feature values associated with each row. */
  values: Float32Array;
  /** Feature value at row 0 (= featureRange.min). */
  vMin: number;
  /** Feature value at the last row (= featureRange.max). */
  vMax: number;
  /** Number of sampled positions along the path. */
  resolution: number;
  /**
   * Maximum 3D distance (raw UMAP units) over which `evaluateCursorPath`
   * is allowed to linearly interpolate between two consecutive rows. If
   * two rows are farther apart than this, the evaluator snaps to one of
   * them instead — so the ball teleports across cluster boundaries
   * rather than gliding through empty space.
   */
  maxLerpDist: number;
}

interface Entry {
  v: number;
  i: number;
}

function buildSortedEntries(
  samples: readonly Sample[],
  featureValues: readonly number[],
  embeddingIndexOf: (sampleIdx: number) => number
): Entry[] {
  const out: Entry[] = [];
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

// ─── 3D grid hash, dual-purpose ────────────────────────────────────────
//
// Used for two distinct lookups in this module:
//   (a) per-cell local density (count cells within a small radius);
//   (b) per-cluster bucket assignment (which coarse bucket does a cell
//       fall into?). The same `Grid` type powers both — only the cell
//       size changes.

interface Grid {
  cellSize: number;
  buckets: Map<string, number[]>;
}

function gridKey(i: number, j: number, k: number): string {
  return `${i},${j},${k}`;
}

function bucketKeyFor(s: Sample, cellSize: number): string {
  return gridKey(
    Math.floor(s.x / cellSize),
    Math.floor(s.y / cellSize),
    Math.floor(s.z / cellSize)
  );
}

function buildGrid(samples: readonly Sample[], cellSize: number): Grid {
  const buckets = new Map<string, number[]>();
  for (let n = 0; n < samples.length; n++) {
    const key = bucketKeyFor(samples[n], cellSize);
    const arr = buckets.get(key);
    if (arr) arr.push(n);
    else buckets.set(key, [n]);
  }
  return { cellSize, buckets };
}

function countNeighborsAt(
  grid: Grid,
  samples: readonly Sample[],
  pos: { x: number; y: number; z: number },
  radius: number
): number {
  const r2 = radius * radius;
  const ci = Math.floor(pos.x / grid.cellSize);
  const cj = Math.floor(pos.y / grid.cellSize);
  const ck = Math.floor(pos.z / grid.cellSize);
  let count = 0;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dk = -1; dk <= 1; dk++) {
        const key = gridKey(ci + di, cj + dj, ck + dk);
        const idx = grid.buckets.get(key);
        if (!idx) continue;
        for (let m = 0; m < idx.length; m++) {
          const s = samples[idx[m]];
          const dx = s.x - pos.x;
          const dy = s.y - pos.y;
          const dz = s.z - pos.z;
          if (dx * dx + dy * dy + dz * dz <= r2) count++;
        }
      }
    }
  }
  return count;
}

/**
 * Build the cell-anchored cursor path.
 *
 * Every waypoint is an actual cell, and the algorithm follows the
 * dominant cluster of cells with feature values near each target value.
 */
export function buildSmoothCursorPath(
  samples: readonly Sample[],
  featureValues: readonly number[],
  embeddingIndexOf: (sampleIdx: number) => number,
  featureRange: { min: number; max: number },
  resolution: number = 200,
  K: number = 64
): CursorPath | null {
  if (samples.length === 0 || featureValues.length === 0) return null;
  if (!Number.isFinite(featureRange.min) || !Number.isFinite(featureRange.max)) return null;
  const span = featureRange.max - featureRange.min;
  if (span <= 0) return null;

  const entries = buildSortedEntries(samples, featureValues, embeddingIndexOf);
  if (entries.length === 0) return null;

  const effK = Math.min(K, entries.length);
  if (effK < 1) return null;

  // Two grids: a *fine* one for local density, and a *coarse* one for
  // cluster bucketing. The coarse cell size is the typical inter-cluster
  // separation we want to resolve — too small → over-fragmentation,
  // too large → adjacent clusters merge. ~3× the density radius works
  // well across v1 / v3 datasets.
  const densityRadius = estimateDensityRadius(samples);
  const densityGrid = buildGrid(samples, densityRadius);
  const clusterCellSize = densityRadius * 3.0;

  const positions = new Float32Array(resolution * 3);
  const values = new Float32Array(resolution);

  for (let r = 0; r < resolution; r++) {
    const t = resolution === 1 ? 0 : r / (resolution - 1);
    const target = featureRange.min + t * span;

    // Binary-search nearest by value, then take K neighbours centred on it.
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].v < target) lo = mid + 1;
      else hi = mid;
    }
    const center = Math.min(entries.length - 1, lo);
    const half = effK >> 1;
    let start = center - half;
    let end = center + (effK - half);
    if (start < 0) {
      end += -start;
      start = 0;
    }
    if (end > entries.length) {
      start = Math.max(0, start - (end - entries.length));
      end = entries.length;
    }

    // Group candidates by coarse cluster bucket; find the dominant one.
    const bucketCounts = new Map<string, number>();
    let dominantKey = '';
    let dominantCount = -1;
    for (let j = start; j < end; j++) {
      const s = samples[entries[j].i];
      const key = bucketKeyFor(s, clusterCellSize);
      const next = (bucketCounts.get(key) ?? 0) + 1;
      bucketCounts.set(key, next);
      if (next > dominantCount) {
        dominantCount = next;
        dominantKey = key;
      }
    }

    // Within the dominant bucket, pick the cell with the highest local
    // density. This lands the cursor at a high-confidence "core" cell
    // of the dominant cluster for this feature value, never at a fringe.
    let bestIdx = -1;
    let bestDensity = -1;
    for (let j = start; j < end; j++) {
      const s = samples[entries[j].i];
      const key = bucketKeyFor(s, clusterCellSize);
      if (key !== dominantKey) continue;
      const d = countNeighborsAt(densityGrid, samples, s, densityRadius);
      if (d > bestDensity) {
        bestDensity = d;
        bestIdx = entries[j].i;
      }
    }
    if (bestIdx < 0) {
      // Fallback: just take the nearest-by-value cell.
      bestIdx = entries[center].i;
    }

    const chosen = samples[bestIdx];
    positions[r * 3] = chosen.x;
    positions[r * 3 + 1] = chosen.y;
    positions[r * 3 + 2] = chosen.z;
    values[r] = featureValues[embeddingIndexOf(bestIdx)] ?? target;
  }

  // Allow lerp across at most ~2 inter-cluster-bucket widths. Anything
  // farther is a cluster jump and the evaluator will snap instead.
  const maxLerpDist = clusterCellSize * 1.4;

  return {
    positions,
    values,
    vMin: featureRange.min,
    vMax: featureRange.max,
    resolution,
    maxLerpDist,
  };
}

/**
 * Build a cursor path by walking the backend's learnt feature trajectory
 * and snapping each trajectory point to its nearest cell in the filtered
 * cloud.
 *
 * Why this is smoother than `buildSmoothCursorPath`
 * -------------------------------------------------
 * The backend trajectory is a sequence of bin centroids sorted by feature
 * value. Adjacent trajectory points have similar feature values *and*
 * tend to be spatially close in UMAP space, so the cells they snap to
 * are usually neighbours of one another. The slider's motion across the
 * resulting path is therefore mostly smooth within a cluster, with
 * unavoidable jumps only when the trajectory genuinely crosses a UMAP
 * gap between clusters.
 *
 * The `evaluateCursorPath` evaluator's `maxLerpDist` snap-tiebreak still
 * applies, so any remaining inter-cluster jumps teleport the ball
 * rather than gliding it through empty space.
 */
export function buildTrajectorySnapPath(
  trajectoryPoints: ReadonlyArray<{ x: number; y: number; z: number }>,
  samples: readonly Sample[],
  featureRange: { min: number; max: number }
): CursorPath | null {
  if (samples.length === 0 || trajectoryPoints.length < 2) return null;
  if (!Number.isFinite(featureRange.min) || !Number.isFinite(featureRange.max)) return null;
  const span = featureRange.max - featureRange.min;
  if (span <= 0) return null;

  const densityRadius = estimateDensityRadius(samples);
  const resolution = trajectoryPoints.length;
  const positions = new Float32Array(resolution * 3);
  const values = new Float32Array(resolution);

  for (let i = 0; i < resolution; i++) {
    const tp = trajectoryPoints[i];
    // Brute-force nearest cell. O(N) per trajectory point; with ~80
    // points and N≈36k cells that's ~3M ops total at module load
    // — far below any noticeable cost.
    let bestI = 0;
    let bestD = Infinity;
    for (let j = 0; j < samples.length; j++) {
      const dx = samples[j].x - tp.x;
      const dy = samples[j].y - tp.y;
      const dz = samples[j].z - tp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        bestI = j;
      }
    }
    const s = samples[bestI];
    positions[i * 3] = s.x;
    positions[i * 3 + 1] = s.y;
    positions[i * 3 + 2] = s.z;

    // Linear value spacing: the trajectory is sorted by feature value, so
    // row `i` corresponds to fraction `t = i/(R-1)` of the slider range.
    // Using linear values keeps the slider mapping exact and the
    // snap-tiebreak well-defined.
    const t = resolution === 1 ? 0 : i / (resolution - 1);
    values[i] = featureRange.min + t * span;
  }

  // The trajectory rides through bin centroids, so consecutive snap
  // cells inside a single cluster should be within a few density radii.
  // Anything farther represents a genuine cluster transition — snap,
  // don't lerp. The factor of 3 is the same coarse "cluster bucket size"
  // used by `buildSmoothCursorPath`.
  const maxLerpDist = densityRadius * 3.0 * 1.4;

  return {
    positions,
    values,
    vMin: featureRange.min,
    vMax: featureRange.max,
    resolution,
    maxLerpDist,
  };
}

/**
 * Evaluate the cursor path at slider value `v`. Returns a 3-D position
 * in raw UMAP coordinates, or `null` if `v` is non-finite.
 *
 * Behaviour:
 *   - within contiguous regions where consecutive rows are physically
 *     close (≤ `path.maxLerpDist`), linear interpolation makes the ball
 *     glide smoothly along the cell mass;
 *   - when consecutive rows are far apart (a cluster transition), the
 *     evaluator snaps to whichever row is closer to `v` in feature value
 *     — so the ball teleports between disjoint clusters rather than
 *     gliding through empty space.
 */
export function evaluateCursorPath(
  path: CursorPath,
  v: number
): { x: number; y: number; z: number } | null {
  if (!Number.isFinite(v)) return null;
  const span = path.vMax - path.vMin;
  if (span <= 0) {
    return {
      x: path.positions[0],
      y: path.positions[1],
      z: path.positions[2],
    };
  }
  const t = Math.max(0, Math.min(1, (v - path.vMin) / span));
  const idx = t * (path.resolution - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(path.resolution - 1, i0 + 1);
  const f = idx - i0;

  const ax = path.positions[i0 * 3];
  const ay = path.positions[i0 * 3 + 1];
  const az = path.positions[i0 * 3 + 2];
  const bx = path.positions[i1 * 3];
  const by = path.positions[i1 * 3 + 1];
  const bz = path.positions[i1 * 3 + 2];

  // Inter-row distance check — if too far, we're crossing a cluster
  // boundary; snap to whichever endpoint is closer in feature value.
  if (i0 !== i1) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (segLen > path.maxLerpDist) {
      // Snap: prefer the row whose feature value is closer to v.
      const va = path.values[i0];
      const vb = path.values[i1];
      const useB = Math.abs(vb - v) < Math.abs(va - v);
      return useB ? { x: bx, y: by, z: bz } : { x: ax, y: ay, z: az };
    }
  }

  return {
    x: ax + (bx - ax) * f,
    y: ay + (by - ay) * f,
    z: az + (bz - az) * f,
  };
}
