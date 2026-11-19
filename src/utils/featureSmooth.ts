/**
 * Gentle k-NN value smoothing for per-sample feature values in 3-D UMAP space.
 *
 *     v_displayed = (1 - blend) * v_own + blend * mean(v_neighbors)
 *
 * Softens the speckle of feature colouring without distorting the colormap:
 * magnitudes still drive colours, each cell is only averaged a little with its
 * spatial neighbourhood. Cells without a value stay NaN.
 *
 * Exact k-NN on a uniform grid sized so occupied cells hold a few points, with
 * the search widened ring by ring until no closer point can exist (~40 ms for
 * the 36k v3 cells). Runs in the dataset worker; pure so it can also run on the
 * main thread as a fallback.
 */
export function smoothFeatureValuesKnn(
  xyz: Float32Array,
  values: Float32Array,
  k: number = 6,
  blend: number = 0.35
): Float32Array {
  const n = values.length;
  const out = new Float32Array(values);
  if (n < 2 || k <= 0 || blend <= 0) return out;

  let xMin = Infinity;
  let yMin = Infinity;
  let zMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    if (x < xMin) xMin = x;
    if (y < yMin) yMin = y;
    if (z < zMin) zMin = z;
    if (x > xMax) xMax = x;
    if (y > yMax) yMax = y;
    if (z > zMax) zMax = z;
  }
  const dx = Math.max(1e-6, xMax - xMin);
  const dy = Math.max(1e-6, yMax - yMin);
  const dz = Math.max(1e-6, zMax - zMin);

  // UMAP clouds are clustered, so a bounding-box cell size leaves dense cells
  // with hundreds of points. Shrink until occupied cells hold ~3.
  let cellSize = Math.cbrt((dx * dy * dz) / n);
  for (let pass = 0; pass < 3; pass++) {
    const occupied = new Set<number>();
    const inv = 1 / cellSize;
    const ny = Math.floor(dy * inv) + 1;
    const nz = Math.floor(dz * inv) + 1;
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((xyz[i * 3] - xMin) * inv);
      const iy = Math.floor((xyz[i * 3 + 1] - yMin) * inv);
      const iz = Math.floor((xyz[i * 3 + 2] - zMin) * inv);
      occupied.add((ix * ny + iy) * nz + iz);
    }
    const perCell = n / occupied.size;
    if (perCell < 4) break;
    cellSize *= Math.cbrt(3 / perCell);
  }
  // Keep the grid allocation bounded for degenerate inputs.
  cellSize = Math.max(cellSize, Math.cbrt((dx * dy * dz) / 4e6));

  const inv = 1 / cellSize;
  const nx = Math.floor(dx * inv) + 1;
  const ny = Math.floor(dy * inv) + 1;
  const nz = Math.floor(dz * inv) + 1;
  const cellCount = nx * ny * nz;

  // Counting sort: cell c owns order[start[c] .. start[c + 1]).
  const cx = new Int32Array(n);
  const cy = new Int32Array(n);
  const cz = new Int32Array(n);
  const start = new Int32Array(cellCount + 1);
  for (let i = 0; i < n; i++) {
    cx[i] = Math.min(nx - 1, Math.floor((xyz[i * 3] - xMin) * inv));
    cy[i] = Math.min(ny - 1, Math.floor((xyz[i * 3 + 1] - yMin) * inv));
    cz[i] = Math.min(nz - 1, Math.floor((xyz[i * 3 + 2] - zMin) * inv));
    start[(cx[i] * ny + cy[i]) * nz + cz[i] + 1]++;
  }
  for (let c = 0; c < cellCount; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cellCount);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[(cx[i] * ny + cy[i]) * nz + cz[i]]++] = i;

  const kk = Math.min(k, n - 1);
  const kDist = new Float64Array(kk);
  const kIdx = new Int32Array(kk);
  const maxRing = Math.max(nx, ny, nz);

  for (let i = 0; i < n; i++) {
    const own = values[i];
    if (!Number.isFinite(own)) continue;
    const px = xyz[i * 3];
    const py = xyz[i * 3 + 1];
    const pz = xyz[i * 3 + 2];
    const ix = cx[i];
    const iy = cy[i];
    const iz = cz[i];
    // Distance from the point to the nearest face of its own cell.
    const inset = Math.max(
      0,
      Math.min(
        px - (xMin + ix * cellSize),
        xMin + (ix + 1) * cellSize - px,
        py - (yMin + iy * cellSize),
        yMin + (iy + 1) * cellSize - py,
        pz - (zMin + iz * cellSize),
        zMin + (iz + 1) * cellSize - pz
      )
    );

    let kept = 0;
    let maxD = -Infinity;
    let maxSlot = -1;
    for (let r = 0; r <= maxRing; r++) {
      const x0 = Math.max(0, ix - r);
      const x1 = Math.min(nx - 1, ix + r);
      const y0 = Math.max(0, iy - r);
      const y1 = Math.min(ny - 1, iy + r);
      const z0 = Math.max(0, iz - r);
      const z1 = Math.min(nz - 1, iz + r);
      for (let ox = x0; ox <= x1; ox++) {
        const edgeX = ox === ix - r || ox === ix + r;
        for (let oy = y0; oy <= y1; oy++) {
          const edgeXY = edgeX || oy === iy - r || oy === iy + r;
          for (let oz = z0; oz <= z1; oz++) {
            // Only the shell of ring r; inner cells were scanned already.
            if (!edgeXY && oz !== iz - r && oz !== iz + r) continue;
            const cell = (ox * ny + oy) * nz + oz;
            for (let b = start[cell]; b < start[cell + 1]; b++) {
              const j = order[b];
              if (j === i) continue;
              const ddx = xyz[j * 3] - px;
              const ddy = xyz[j * 3 + 1] - py;
              const ddz = xyz[j * 3 + 2] - pz;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (kept < kk) {
                kDist[kept] = d2;
                kIdx[kept] = j;
                if (d2 > maxD) {
                  maxD = d2;
                  maxSlot = kept;
                }
                kept++;
              } else if (d2 < maxD) {
                kDist[maxSlot] = d2;
                kIdx[maxSlot] = j;
                maxD = -Infinity;
                for (let s = 0; s < kk; s++) {
                  if (kDist[s] > maxD) {
                    maxD = kDist[s];
                    maxSlot = s;
                  }
                }
              }
            }
          }
        }
      }
      // Anything outside rings 0..r is at least this far away.
      const reach = r * cellSize + inset;
      if (kept === kk && maxD <= reach * reach) break;
    }

    let sum = 0;
    let count = 0;
    for (let s = 0; s < kept; s++) {
      const v = values[kIdx[s]];
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count > 0) out[i] = (1 - blend) * own + blend * (sum / count);
  }

  return out;
}
