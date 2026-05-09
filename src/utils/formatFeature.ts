/**
 * Pretty-print a feature value with ~3-4 significant digits.
 *
 * Falls back to scientific notation only for very small / very large values
 * so tiny features (e.g. diffusivity ~ 1e-3) don't collapse to "0.000" with
 * a fixed-decimal formatter.
 */
export function formatFeatureValue(v: number): string {
  if (!Number.isFinite(v)) return '\u2014';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000 || abs < 0.001) return v.toExponential(2);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(3);
  if (abs >= 0.1) return v.toFixed(3);
  if (abs >= 0.01) return v.toFixed(4);
  return v.toFixed(5);
}
