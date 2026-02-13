/**
 * Feature value → color: plasma colormap with optional log1p scaling.
 */

// Plasma colormap (matplotlib-style): dark purple → magenta → orange → yellow
const PLASMA_STOPS: { t: number; r: number; g: number; b: number }[] = [
  { t: 0, r: 0.05, g: 0.03, b: 0.53 },
  { t: 0.25, r: 0.28, g: 0.02, b: 0.65 },
  { t: 0.5, r: 0.79, g: 0.11, b: 0.54 },
  { t: 0.75, r: 0.99, g: 0.47, b: 0.22 },
  { t: 1, r: 0.94, g: 0.95, b: 0.13 },
];

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
