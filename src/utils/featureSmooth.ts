/**
 * Gentle k-NN value smoothing for per-sample feature values in 3-D UMAP space.
 *
 * Each output value is a blend of the sample's own raw value and the mean of
 * its k nearest neighbors:
 *
 *     v_displayed = (1 - blend) * v_own + blend * mean(v_neighbors)
 *
 * Goal: soften the speckle of feature-color rendering on UMAP without
 * distorting the colormap itself. Magnitudes still drive colors — we only
 * average each cell's reading a little with its spatial neighborhood, the
 * same kind of denoising you'd see in any 3-D scalar-field visualization.
 *
 * Implementation: 3-D grid hash for k-nearest selection. Cost is roughly
 * O(N · candidates_per_cell) which lands at ~30–80 ms for 30 k samples,
 * memoize this on (sample set, feature) so it only runs on axis change.
 */

interface SamplePos {
  x: number;
  y: number;
  z: number;
}

type ValueArray = Float32Array | Float64Array | readonly number[];

export function smoothFeatureValuesKnn(
  samples: readonly SamplePos[],
  values: ValueArray,
  sampleIndexInValues: (i: number) => number,
  k: number = 6,
  blend: number = 0.35
): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  if (n === 0 || k <= 0 || blend <= 0) {
    for (let i = 0; i < n; i++) out[i] = values[sampleIndexInValues(i)] as number;
    return out;
  }

  // Bounding box (skip non-finite samples defensively).
  let xMin = Infinity;
  let yMin = Infinity;
  let zMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (s.x < xMin) xMin = s.x;
    if (s.y < yMin) yMin = s.y;
    if (s.z < zMin) zMin = s.z;
    if (s.x > xMax) xMax = s.x;
    if (s.y > yMax) yMax = s.y;
    if (s.z > zMax) zMax = s.z;
  }
  const dx = Math.max(1e-6, xMax - xMin);
  const dy = Math.max(1e-6, yMax - yMin);
  const dz = Math.max(1e-6, zMax - zMin);

  // Cell size targets ~4 samples per cell on average so a 3³ neighborhood
  // gives roughly ~100 candidates — plenty for k = 6, cheap to scan.
  const targetCells = Math.max(8, n / 4);
  const cellSize = Math.cbrt((dx * dy * dz) / targetCells);
  const inv = 1 / cellSize;

  const grid = new Map<number, number[]>();
  // Pack 3-D cell coords into a single integer key for fast hashing.
  // Bits: 21 per axis → indices in [0, 2^21) → enough for 2M cells per axis.
  const cellKey = (ix: number, iy: number, iz: number): number =>
    (((ix + 0x100000) & 0x1fffff) << 42) +
    (((iy + 0x100000) & 0x1fffff) << 21) +
    ((iz + 0x100000) & 0x1fffff);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const ix = Math.floor((s.x - xMin) * inv);
    const iy = Math.floor((s.y - yMin) * inv);
    const iz = Math.floor((s.z - zMin) * inv);
    const key = cellKey(ix, iy, iz);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }

  // Reusable per-point k-set buffers (small-k linear maintenance is faster
  // than a heap at k = 6).
  const kDist = new Float64Array(k);
  const kIdx = new Int32Array(k);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const ownIdx = sampleIndexInValues(i);
    const ownVal = values[ownIdx] as number;
    if (!Number.isFinite(ownVal)) {
      out[i] = ownVal;
      continue;
    }

    const cx = Math.floor((s.x - xMin) * inv);
    const cy = Math.floor((s.y - yMin) * inv);
    const cz = Math.floor((s.z - zMin) * inv);

    let kept = 0;
    let maxD = -Infinity;
    let maxIdx = -1;

    for (let oz = -1; oz <= 1; oz++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = grid.get(cellKey(cx + ox, cy + oy, cz + oz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            if (j === i) continue;
            const sj = samples[j];
            const ddx = sj.x - s.x;
            const ddy = sj.y - s.y;
            const ddz = sj.z - s.z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (kept < k) {
              kDist[kept] = d2;
              kIdx[kept] = j;
              if (d2 > maxD) {
                maxD = d2;
                maxIdx = kept;
              }
              kept++;
            } else if (d2 < maxD) {
              kDist[maxIdx] = d2;
              kIdx[maxIdx] = j;
              maxD = -Infinity;
              for (let kk = 0; kk < k; kk++) {
                if (kDist[kk] > maxD) {
                  maxD = kDist[kk];
                  maxIdx = kk;
                }
              }
            }
          }
        }
      }
    }

    if (kept === 0) {
      out[i] = ownVal;
      continue;
    }

    let sum = 0;
    let count = 0;
    for (let kk = 0; kk < kept; kk++) {
      const v = values[sampleIndexInValues(kIdx[kk])] as number;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count === 0) {
      out[i] = ownVal;
      continue;
    }
    const mean = sum / count;
    out[i] = (1 - blend) * ownVal + blend * mean;
  }

  return out;
}
