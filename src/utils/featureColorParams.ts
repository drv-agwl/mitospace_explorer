export interface PlasmaParams {
  gamma: number;
  contrast: number;
}

const paramsCache = new WeakMap<readonly number[] | Float32Array | Float64Array, PlasmaParams>();

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Estimate good per-feature plasma parameters from the feature's distribution.
 *
 * Goals:
 * - Increase dynamic range for tightly-clustered / heavy-tailed features.
 * - Avoid harsh posterization for already-wide / symmetric features.
 * - Keep a single consistent mapping: higher values always mean higher t.
 *
 * Heuristic:
 * - Use robust quantiles (p2/p10/p50/p90/p98).
 * - Measure right-skew via ratio (p90-p50)/(p50-p10).
 * - Measure concentration via (p90-p10)/(p98-p2).
 *
 * Returns parameters in ranges that match what our quick search tends to pick:
 *   gamma in [0.55, 0.95], contrast in [1.15, 1.8]
 */
export function estimatePlasmaParams(
  values: readonly number[] | Float32Array | Float64Array
): PlasmaParams {
  const cached = paramsCache.get(values);
  if (cached) return cached;

  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length < 200) {
    const fallback = { gamma: 0.7, contrast: 1.25 };
    paramsCache.set(values, fallback);
    return fallback;
  }

  finite.sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (finite.length - 1) * p;
    const i0 = Math.floor(idx);
    const i1 = Math.min(finite.length - 1, i0 + 1);
    const t = idx - i0;
    return finite[i0] * (1 - t) + finite[i1] * t;
  };

  const p2 = q(0.02);
  const p10 = q(0.10);
  const p50 = q(0.50);
  const p90 = q(0.90);
  const p98 = q(0.98);

  const left = Math.max(1e-12, p50 - p10);
  const right = Math.max(1e-12, p90 - p50);
  const skewRatio = right / left; // >1 => right-skewed/heavy tail

  const core = Math.max(1e-12, p90 - p10);
  const full = Math.max(1e-12, p98 - p2);
  const concentration = clamp(core / full, 0, 1); // small => mass is tightly concentrated

  // Map skew to gamma: more skew => higher gamma (like the search results for motility).
  // Range roughly: skew 0.7..3.0 -> gamma 0.60..0.95
  const skewNorm = clamp((Math.log(skewRatio) - Math.log(0.7)) / (Math.log(3.0) - Math.log(0.7)), 0, 1);
  const gamma = 0.60 + 0.35 * skewNorm;

  // Map concentration to contrast: more concentrated => higher contrast.
  // concentration 0.15..0.75 -> contrast 1.75..1.20 (inverse)
  const concNorm = clamp((concentration - 0.15) / (0.75 - 0.15), 0, 1);
  const contrast = 1.75 - 0.55 * concNorm;

  const params = { gamma: clamp(gamma, 0.55, 0.95), contrast: clamp(contrast, 1.15, 1.8) };
  paramsCache.set(values, params);
  return params;
}

