import type { Sample } from '../types';

export interface DrugCard {
  drug: string;
  sample: Sample;
}

/**
 * Pick one representative sample per drug for the overview strip.
 * Preference: has video > has image > anything. Sorted by drug name.
 */
export function selectDrugRepresentatives(samples: Sample[]): DrugCard[] {
  const byDrug = new Map<string, Sample>();
  for (const s of samples) {
    const drug = s.treatment?.drug;
    if (!drug) continue;
    const existing = byDrug.get(drug);
    if (!existing) {
      byDrug.set(drug, s);
      continue;
    }
    const candidateHasVideo = (s.videos?.length ?? 0) > 0;
    const existingHasVideo = (existing.videos?.length ?? 0) > 0;
    if (candidateHasVideo && !existingHasVideo) {
      byDrug.set(drug, s);
      continue;
    }
    if (candidateHasVideo === existingHasVideo) {
      const candidateHasImage = (s.images?.length ?? 0) > 0;
      const existingHasImage = (existing.images?.length ?? 0) > 0;
      if (candidateHasImage && !existingHasImage) {
        byDrug.set(drug, s);
      }
    }
  }
  return Array.from(byDrug.entries())
    .map(([drug, sample]) => ({ drug, sample }))
    .sort((a, b) => a.drug.localeCompare(b.drug));
}

export function drugStripVideoUrls(samples: Sample[], videoIndex = 0): string[] {
  const urls: string[] = [];
  for (const { sample } of selectDrugRepresentatives(samples)) {
    const url = sample.videos?.[videoIndex];
    if (url) urls.push(url);
  }
  return urls;
}
