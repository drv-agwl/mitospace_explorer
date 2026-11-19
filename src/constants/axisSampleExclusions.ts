/**
 * Cells that should not anchor the "samples along axis" thumbnail strip when
 * a nearby alternative exists. Only for one-off broken movies: excluding whole
 * conditions would misrepresent which cells sit along the axis.
 *
 * Add stable `Sample.id` values (e.g. from the points JSON).
 */
export const AXIS_STRIP_EXCLUDED_SAMPLE_IDS: ReadonlySet<string> = new Set([
  // Example: 'p12345',
]);

export function isAxisStripExcludedSampleId(sampleId: string): boolean {
  return AXIS_STRIP_EXCLUDED_SAMPLE_IDS.has(sampleId);
}
