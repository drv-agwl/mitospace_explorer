/**
 * Cells that should not anchor the "samples along axis" thumbnail strip when
 * a nearby alternative exists (same eligibility tiers as deprioritized drugs).
 *
 * Add stable `Sample.id` values (e.g. from the points JSON) for one-off bad
 * videos at axis endpoints.
 */
export const AXIS_STRIP_EXCLUDED_SAMPLE_IDS: ReadonlySet<string> = new Set([
  // Example: 'p12345',
]);

/** Case-insensitive substring match on `treatment.drug`. */
export const AXIS_STRIP_EXCLUDED_DRUG_SUBSTRINGS: readonly string[] = [
  'mitomycin',
  'mitomycinc',
];

export function isAxisStripExcludedSampleId(sampleId: string): boolean {
  return AXIS_STRIP_EXCLUDED_SAMPLE_IDS.has(sampleId);
}

export function isAxisStripExcludedDrug(drug: string): boolean {
  const d = drug.toLowerCase();
  return AXIS_STRIP_EXCLUDED_DRUG_SUBSTRINGS.some((s) => d.includes(s.toLowerCase()));
}
