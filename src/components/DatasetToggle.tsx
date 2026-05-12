import type { DatasetVersion } from '../types';

/**
 * Former v1 | v3 segmented control copy; the header no longer mounts a dataset switcher.
 * `DatasetVersion` / `setDatasetVersion` and v1 sample paths remain in `SampleContext` and `sampleData`.
 */
export const DATASET_TOGGLE_OPTIONS: Array<{ value: DatasetVersion; label: string; sub: string }> = [
  { value: 'v1', label: 'v1', sub: '2024 · 13K' },
  { value: 'v3', label: 'v3', sub: '2025 · 36K' },
];

/** Intentionally empty — public UI is fixed to v3. */
const DatasetToggle = () => null;

export default DatasetToggle;
