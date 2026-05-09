import type { DatasetVersion } from '../types';

export interface FeatureOption {
  id: string;
  label: string;
  /** Backend identifier sent over the API (also used as a stable key in URLs). */
  apiName: string;
}

export interface FeatureGroup {
  category: string;
  features: FeatureOption[];
}

// ─── v1 (2024) ────────────────────────────────────────────────────────────
// Tied to data/filtered/mitotnt_features.csv columns.
export const FEATURE_GROUPS_V1: FeatureGroup[] = [
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

// ─── v3 (2025) ────────────────────────────────────────────────────────────
// Tied to data/v3_data/features_v3.parquet columns.
// "Motility" in v3 = diffusivity of mitochondrial structures (how much they
// move). The dataset reports it at three structural scales — fragment, segment,
// and node — and we expose all three because they capture different aspects of
// mitochondrial movement.
// Membrane Potential = last timepoint of `tmrm_intensities` (computed in the
// backend as feature `tmrm_last`).
export const FEATURE_GROUPS_V3: FeatureGroup[] = [
  {
    category: 'Mitochondria dynamics',
    features: [
      { id: 'fragment_diffusivity_mean', label: 'Fragment Motility', apiName: 'fragment_diffusivity_mean' },
      { id: 'segment_diffusivity_mean', label: 'Segment Motility', apiName: 'segment_diffusivity_mean' },
      { id: 'node_diffusivity_mean', label: 'Node Motility', apiName: 'node_diffusivity_mean' },
      { id: 'fission_rate_mean', label: 'Fission Rate', apiName: 'fission_rate_mean' },
      { id: 'fusion_rate_mean', label: 'Fusion Rate', apiName: 'fusion_rate_mean' },
    ],
  },
  {
    category: 'Mitochondrial Morphology',
    features: [
      { id: 'fragment_length_mean', label: 'Fragment Length', apiName: 'fragment_length_mean' },
      { id: 'segment_length_mean', label: 'Segment Length', apiName: 'segment_length_mean' },
      { id: 'fragment_diameter_mean', label: 'Fragment Diameter', apiName: 'fragment_diameter_mean' },
      { id: 'fragment_tortuosity_mean', label: 'Tortuosity', apiName: 'fragment_tortuosity_mean' },
    ],
  },
  {
    category: 'Mitochondria function',
    features: [
      { id: 'tmrm_last', label: 'Membrane Potential', apiName: 'tmrm_last' },
    ],
  },
];

export function getFeatureGroups(version: DatasetVersion): FeatureGroup[] {
  return version === 'v3' ? FEATURE_GROUPS_V3 : FEATURE_GROUPS_V1;
}

/**
 * Feature selected the first time the user enables Semantic axis (when nothing was chosen yet).
 */
export function getInitialSemanticAxisFeature(version: DatasetVersion): string | null {
  const groups = getFeatureGroups(version);
  if (version === 'v3') {
    const morph = groups.find((g) => g.category === 'Mitochondrial Morphology');
    const seg = morph?.features.find((f) => f.apiName === 'segment_length_mean');
    if (seg) return seg.apiName;
  }
  return groups[0]?.features[0]?.apiName ?? null;
}

// Backwards-compat default export for any existing imports (defaults to v1).
export const FEATURE_GROUPS: FeatureGroup[] = FEATURE_GROUPS_V1;

/**
 * Resolve a feature's display label by looking through the active version's groups.
 * Falls back to the apiName so we never render a blank.
 */
export function getFeatureDisplayLabel(apiName: string | null, version: DatasetVersion = 'v1'): string {
  if (!apiName) return '';
  const groups = getFeatureGroups(version);
  for (const grp of groups) {
    const opt = grp.features.find((f) => f.apiName === apiName);
    if (opt) return opt.label;
  }
  // Also check the other version, so cross-version state changes still render readable names.
  const other = version === 'v1' ? FEATURE_GROUPS_V3 : FEATURE_GROUPS_V1;
  for (const grp of other) {
    const opt = grp.features.find((f) => f.apiName === apiName);
    if (opt) return opt.label;
  }
  return apiName;
}
