/** Map sample id → index in the full `samples4D` / API feature array. */
export function buildSampleIdToIndex(samples: readonly { id: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < samples.length; i++) {
    m.set(samples[i].id, i);
  }
  return m;
}
