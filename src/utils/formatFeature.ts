/**
 * Pretty-print a feature value with ~3-4 significant digits, always in plain
 * decimals so tiny features (e.g. diffusivity ~ 5e-4) read as 0.000483.
 */
export function formatFeatureValue(v: number): string {
  if (!Number.isFinite(v)) return '\u2014';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000) return Math.round(v).toLocaleString('en-US');
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  if (abs >= 0.1) return v.toFixed(3);
  return v.toPrecision(3);
}

/** 4 -> "4th", 92 -> "92nd" (rounded to a whole percentile). */
export function formatPercentile(p: number): string {
  const n = Math.round(p);
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
