import type { Sample } from '../types';
import { smoothFeatureValuesKnn } from './featureSmooth';
import { buildSmoothCursorPath, type CursorPath } from './axisCursorPath';

/** Per-feature axis data for the visible cells (shared by the dataset worker and its main-thread fallback). */
export interface FeatureAxis {
  /** Smoothed feature value per visible cell, in display order (NaN = no measurement). */
  smoothed: Float32Array;
  cursorPath: CursorPath | null;
}

export function computeFeatureAxis(
  xyz: Float32Array,
  points: readonly Pick<Sample, 'x' | 'y' | 'z'>[],
  values: Float32Array,
  indices: Int32Array | null,
  range: { min: number; max: number }
): FeatureAxis {
  let subXyz = xyz;
  let subValues = values;
  if (indices) {
    subXyz = new Float32Array(indices.length * 3);
    subValues = new Float32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const e = indices[i];
      subXyz[i * 3] = xyz[e * 3];
      subXyz[i * 3 + 1] = xyz[e * 3 + 1];
      subXyz[i * 3 + 2] = xyz[e * 3 + 2];
      subValues[i] = values[e];
    }
  }
  const visible = indices ? Array.from(indices, (e) => points[e]) : points;
  return {
    smoothed: smoothFeatureValuesKnn(subXyz, subValues),
    cursorPath: buildSmoothCursorPath(visible, values, (i) => (indices ? indices[i] : i), range, 200, 64),
  };
}
