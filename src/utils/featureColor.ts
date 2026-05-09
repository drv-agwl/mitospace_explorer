/**
 * Feature value → color: plasma colormap with consistent, faithful mapping.
 *
 * The recommended public API is `featureToColorPlasmaAdaptive(v, min, max)`
 * (and its [0,1] variant `plasmaAtT`). Used in three places to keep visuals
 * coherent: per-point cloud colors, the semantic-axis tube/arrows, and the
 * bottom-left FeatureColorBar legend.
 *
 * Older variants (linear / log1p / rank) are kept for backwards compatibility
 * but new callers should use the adaptive function.
 */

// Plasma colormap (matplotlib-style): dark purple → magenta → orange → yellow
const PLASMA_STOPS: { t: number; r: number; g: number; b: number }[] = [
  { t: 0, r: 0.05, g: 0.03, b: 0.53 },
  { t: 0.25, r: 0.28, g: 0.02, b: 0.65 },
  { t: 0.5, r: 0.79, g: 0.11, b: 0.54 },
  { t: 0.75, r: 0.99, g: 0.47, b: 0.22 },
  { t: 1, r: 0.94, g: 0.95, b: 0.13 },
];

/**
 * Default contrast curve. Gamma < 1 spreads mid-low feature values into more
 * distinguishable colors, which is the most common case for v3 features
 * whose distributions are positively skewed or tightly clustered.
 */
export const DEFAULT_PLASMA_GAMMA = 0.7;

/**
 * Default contrast stretch around the midrange.
 * - 1.0 means no additional stretch
 * - > 1.0 increases dynamic range (more color separation)
 * - < 1.0 decreases dynamic range (more subtle)
 */
export const DEFAULT_PLASMA_CONTRAST = 1.25;

/** Trim the plasma extremes so the gradient stays punchy on dark backgrounds. */
const PLASMA_LO = 0.06;
const PLASMA_HI = 0.94;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateStops(
  stops: { t: number; r: number; g: number; b: number }[],
  t: number
): { r: number; g: number; b: number } {
  if (t <= 0) return { r: stops[0].r, g: stops[0].g, b: stops[0].b };
  if (t >= 1) {
    const last = stops[stops.length - 1];
    return { r: last.r, g: last.g, b: last.b };
  }
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].t < t) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const s = (t - a.t) / (b.t - a.t);
  return {
    r: lerp(a.r, b.r, s),
    g: lerp(a.g, b.g, s),
    b: lerp(a.b, b.b, s),
  };
}

function interpolatePlasma(t: number): { r: number; g: number; b: number } {
  return interpolateStops(PLASMA_STOPS, t);
}

/**
 * Normalize value to [0,1] using min/max, then map to plasma RGB.
 */
export function featureToColor(
  value: number,
  min: number,
  max: number
): { r: number; g: number; b: number } {
  const range = max - min;
  const t = range <= 0 ? 0.5 : Math.max(0, Math.min(1, (value - min) / range));
  return interpolatePlasma(t);
}

/**
 * Same as featureToColor but with log1p scaling (for e.g. Fragment Length).
 * Uses log1p(value), log1p(min), log1p(max) for the normalized t.
 */
export function featureToColorLog1p(
  value: number,
  min: number,
  max: number
): { r: number; g: number; b: number } {
  const minLog = Math.log1p(Math.max(0, min));
  const maxLog = Math.log1p(Math.max(0, max));
  const valueLog = Math.log1p(Math.max(0, value));
  const range = maxLog - minLog;
  const t = range <= 0 ? 0.5 : Math.max(0, Math.min(1, (valueLog - minLog) / range));
  return interpolatePlasma(t);
}

/**
 * Same but for nullable value; returns gray if null/NaN.
 */
export function featureToColorSafe(
  value: number | null | undefined,
  min: number,
  max: number
): { r: number; g: number; b: number } {
  if (value == null || Number.isNaN(value)) {
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  return featureToColor(value, min, max);
}

/**
 * Log1p-scaled plasma; nullable value → gray if null/NaN.
 * Applies a contrast stretch (power curve) to the normalized value so the
 * gradient spans the range more effectively and small value differences are more visible.
 */
export function featureToColorLog1pSafe(
  value: number | null | undefined,
  min: number,
  max: number
): { r: number; g: number; b: number } {
  if (value == null || Number.isNaN(value)) {
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  const minLog = Math.log1p(Math.max(0, min));
  const maxLog = Math.log1p(Math.max(0, max));
  const valueLog = Math.log1p(Math.max(0, value));
  const range = maxLog - minLog;
  const tLinear = range <= 0 ? 0.5 : Math.max(0, Math.min(1, (valueLog - minLog) / range));
  // Contrast stretch: pow(t, 0.8) expands the lower/mid range for better color separation
  const t = Math.pow(tLinear, 0.8);
  return interpolatePlasma(t);
}

// ─── Rank-based (quantile) coloring ─────────────────────────────────────
//
// For features whose values are tightly clustered with heavy tails (e.g.
// diffusivity, tortuosity), linear or log1p mapping wastes most of the color
// spectrum on outliers. Coloring by empirical percentile guarantees the
// colormap uses its full range regardless of distribution shape, revealing
// subtle structure that linear mapping crushes.
//
// We pre-build a sorted array of finite values once per feature, then use
// binary search at render time to find each value's percentile.

const sortedCache = new WeakMap<readonly number[] | Float32Array | Float64Array, Float64Array>();

/**
 * Build (or fetch from cache) a sorted, finite-only Float64Array of the given
 * feature values. The cache key is the array reference, so callers should
 * pass the same array instance on subsequent renders.
 */
export function buildSortedFeatureValues(
  values: readonly number[] | Float32Array | Float64Array
): Float64Array {
  const cached = sortedCache.get(values);
  if (cached) return cached;
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  const sorted = Float64Array.from(finite);
  sorted.sort();
  sortedCache.set(values, sorted);
  return sorted;
}

/**
 * Binary search for the rank percentile of `value` in the sorted array.
 * Returns a number in [0, 1].
 */
function rankPercentile(value: number, sorted: Float64Array): number {
  const n = sorted.length;
  if (n === 0) return 0.5;
  if (value <= sorted[0]) return 0;
  if (value >= sorted[n - 1]) return 1;
  // Lower-bound binary search: index of first element >= value
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  // Linear interpolation between equal-ranked neighbors for smooth coloring.
  const left = lo > 0 ? sorted[lo - 1] : sorted[lo];
  const right = sorted[lo];
  const span = right - left || 1;
  const interp = (value - left) / span;
  return (lo - 1 + interp) / (n - 1);
}

/**
 * Plasma color from the empirical percentile of `value` within the sorted
 * distribution `sorted` (which must be precomputed by buildSortedFeatureValues).
 *
 * This is the recommended coloring for v3 features whose distributions are
 * heavy-tailed or tightly clustered (diffusivity, tortuosity, etc.).
 *
 * Returns gray for null / NaN values.
 */
export function featureToColorByRank(
  value: number | null | undefined,
  sorted: Float64Array
): { r: number; g: number; b: number } {
  if (value == null || !Number.isFinite(value)) {
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  const t = rankPercentile(value, sorted);
  return interpolatePlasma(t);
}

// ─── Adaptive plasma (recommended) ──────────────────────────────────────

/**
 * Plasma color for a normalized t in [0, 1], with the gamma curve and
 * trimmed colormap range applied.
 *
 * Use this for elements that are already parameterized by [0, 1] (e.g. a
 * trajectory tube vertex's distance along the curve, or legend stops).
 */
export function plasmaAtT(
  t: number,
  gamma: number = DEFAULT_PLASMA_GAMMA,
  contrast: number = DEFAULT_PLASMA_CONTRAST
): {
  r: number;
  g: number;
  b: number;
} {
  const tClamped = Math.max(0, Math.min(1, t));
  const tCurved = Math.pow(tClamped, gamma);
  // Contrast stretch around 0.5 (linear gain, clamped), then trim and map.
  const tStretched = Math.max(0, Math.min(1, 0.5 + (tCurved - 0.5) * contrast));
  return interpolatePlasma(PLASMA_LO + tStretched * (PLASMA_HI - PLASMA_LO));
}

/**
 * Plasma color for a value within [min, max], with gamma stretch and trimmed
 * colormap range. This is the canonical mapping; per-point cloud colors,
 * trajectory tube colors, and the legend stops all use it so the visual
 * story is consistent across the whole UI.
 *
 * Returns gray for null / NaN / non-finite inputs.
 */
export function featureToColorPlasmaAdaptive(
  value: number | null | undefined,
  min: number,
  max: number,
  gamma: number = DEFAULT_PLASMA_GAMMA,
  contrast: number = DEFAULT_PLASMA_CONTRAST
): { r: number; g: number; b: number } {
  if (value == null || !Number.isFinite(value)) return { r: 0.5, g: 0.5, b: 0.5 };
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return plasmaAtT(0.5, gamma, contrast);
  const tLinear = (value - min) / range;
  return plasmaAtT(tLinear, gamma, contrast);
}

/**
 * Build a CSS `linear-gradient(...)` string that matches `plasmaAtT` exactly,
 * sampled at `nStops` evenly spaced positions. Used by the FeatureColorBar
 * legend so the bar visually matches the cloud / tube colors.
 */
export function plasmaGradientCss(
  nStops: number = 11,
  gamma: number = DEFAULT_PLASMA_GAMMA,
  contrast: number = DEFAULT_PLASMA_CONTRAST,
  direction: 'to right' | 'to top' = 'to right'
): string {
  const parts: string[] = [];
  for (let i = 0; i < nStops; i++) {
    const t = i / (nStops - 1);
    const c = plasmaAtT(t, gamma, contrast);
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    parts.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}
