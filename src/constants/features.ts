export interface FeatureOption {
  id: string;
  label: string;
  apiName: string;
}

export interface FeatureGroup {
  category: string;
  features: FeatureOption[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    category: 'Mitochondria dynamics',
    features: [{ id: 'optical_flow_fg', label: 'Motility', apiName: 'Optical Flow (fg)' }],
  },
  {
    category: 'Mitochondrial Morphology',
    features: [{ id: 'segment_length', label: 'Segment Length', apiName: 'Segment Length' }],
  },
  {
    category: 'Mitochondria function',
    features: [{ id: 'tmrm_intensity', label: 'Membrane Potential', apiName: 'TMRM Intensity' }],
  },
];

export function getFeatureDisplayLabel(apiName: string | null): string {
  if (!apiName) return '';
  for (const grp of FEATURE_GROUPS) {
    const opt = grp.features.find((f) => f.apiName === apiName);
    if (opt) return opt.label;
  }
  return apiName;
}
