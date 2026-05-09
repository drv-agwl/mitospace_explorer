/**
 * Spatial distance helpers for the semantic-axis "ribbon fade" effect.
 *
 * Given the cloud points and the trajectory polyline, we precompute each
 * point's distance to the polyline once per (axis, filter) change. The
 * Visualizer then uses these distances to fade off-axis points toward a
 * neutral dim color so the on-axis ribbon (where the feature actually
 * varies) reads as a clear gradient through otherwise high-variance cloud.
 *
 * Distances are computed in raw UMAP coordinates — both inputs must be in
 * the same coordinate system. The Visualizer keeps its trajectoryPoints in
 * raw UMAP space, so this matches.
 */

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Read a 3D point from either {x,y,z} or [x,y,z] form (the trajectory API
 * has been seen returning both shapes).
 */
function readPoint(p: unknown): Point3 {
  if (p == null) return { x: 0, y: 0, z: 0 };
  const obj = p as { x?: unknown; y?: unknown; z?: unknown } | unknown[];
  if (Array.isArray(obj)) {
    return {
      x: typeof obj[0] === 'number' ? (obj[0] as number) : 0,
      y: typeof obj[1] === 'number' ? (obj[1] as number) : 0,
      z: typeof obj[2] === 'number' ? (obj[2] as number) : 0,
    };
  }
  return {
    x: typeof obj.x === 'number' ? obj.x : 0,
    y: typeof obj.y === 'number' ? obj.y : 0,
    z: typeof obj.z === 'number' ? obj.z : 0,
  };
}

/**
 * Compute the closest 3-D distance from each sample to the polyline made of
 * `polyline[0]→polyline[1]→…`. Distances are Euclidean in raw input units.
 *
 * The polyline is internally downsampled to ~32 segments so very dense
 * trajectories don't blow up the inner loop; this preserves accuracy to
 * within ~1 % for typical axes and keeps the cost at ~N × 32 ≈ 1M ops for
 * a 30 k-point cloud, comfortably under one frame.
 */
export function computeDistancesToPolyline(
  samples: readonly { x: number; y: number; z: number }[],
  polyline: readonly unknown[]
): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  if (n === 0 || polyline.length < 2) return out;

  // Downsample polyline to ≤ ~33 vertices (≤ 32 segments).
  const target = 32;
  const step = Math.max(1, Math.ceil((polyline.length - 1) / target));
  const poly: Point3[] = [];
  for (let i = 0; i < polyline.length; i += step) poly.push(readPoint(polyline[i]));
  const last = readPoint(polyline[polyline.length - 1]);
  const tail = poly[poly.length - 1];
  if (tail.x !== last.x || tail.y !== last.y || tail.z !== last.z) poly.push(last);

  const m = poly.length;
  // Pre-extract polyline segment data (avoid object access in hot loop).
  const ax = new Float64Array(m - 1);
  const ay = new Float64Array(m - 1);
  const az = new Float64Array(m - 1);
  const dx = new Float64Array(m - 1);
  const dy = new Float64Array(m - 1);
  const dz = new Float64Array(m - 1);
  const invLenSq = new Float64Array(m - 1);
  for (let j = 0; j < m - 1; j++) {
    const a = poly[j];
    const b = poly[j + 1];
    ax[j] = a.x;
    ay[j] = a.y;
    az[j] = a.z;
    const ddx = b.x - a.x;
    const ddy = b.y - a.y;
    const ddz = b.z - a.z;
    dx[j] = ddx;
    dy[j] = ddy;
    dz[j] = ddz;
    const lenSq = ddx * ddx + ddy * ddy + ddz * ddz;
    invLenSq[j] = lenSq > 0 ? 1 / lenSq : 0;
  }

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const px = s.x;
    const py = s.y;
    const pz = s.z;
    let minD2 = Infinity;
    for (let j = 0; j < m - 1; j++) {
      let t = ((px - ax[j]) * dx[j] + (py - ay[j]) * dy[j] + (pz - az[j]) * dz[j]) * invLenSq[j];
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = ax[j] + t * dx[j];
      const cy = ay[j] + t * dy[j];
      const cz = az[j] + t * dz[j];
      const ex = px - cx;
      const ey = py - cy;
      const ez = pz - cz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < minD2) minD2 = d2;
    }
    out[i] = Math.sqrt(minD2);
  }
  return out;
}

/**
 * Compute fade factors in [0, 1] from a distance array using two robust
 * percentiles:
 *   - within `nearQ` quantile of distances → fade = 1 (full color)
 *   - beyond `farQ`  quantile of distances → fade = 0 (fully dim)
 *   - linear ramp between
 *
 * `nearQ < farQ`. Defaults: 0.30 / 0.80 — about a third of the cloud stays
 * vivid (the on-axis "ribbon"), half fades through the middle, and the
 * outer 20 % goes fully dim.
 */
export function buildFadeFactors(
  distances: Float32Array,
  nearQ: number = 0.3,
  farQ: number = 0.8
): Float32Array {
  const n = distances.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const sorted = Float64Array.from(distances);
  sorted.sort();
  const near = sorted[Math.min(sorted.length - 1, Math.floor(nearQ * (sorted.length - 1)))];
  const far = sorted[Math.min(sorted.length - 1, Math.floor(farQ * (sorted.length - 1)))];
  const span = Math.max(far - near, 1e-9);
  for (let i = 0; i < n; i++) {
    const d = distances[i];
    let f = (far - d) / span;
    if (f > 1) f = 1;
    else if (f < 0) f = 0;
    out[i] = f;
  }
  return out;
}
