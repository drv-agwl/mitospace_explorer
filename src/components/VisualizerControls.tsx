import React, { useEffect, useState } from 'react';
import { useSample } from '../context/SampleContext';
import { getFeatureStats, getFeatureValues, healthCheck } from '../api/client';

interface VisualizerControlsProps {
  type: '2d' | '4d';
  onSemanticSliderChange?: (pointIndex: number, targetValue: number) => void;
}

const FEATURE_OPTIONS = [
  { id: 'fragment_length', label: 'Fragment Length', apiName: 'Fragment Length' },
  { id: 'segment_length', label: 'Segment Length', apiName: 'Segment Length' },
];

/** Default range when API is not available (Fragment Length typical range). */
const DEFAULT_FEATURE_RANGE = { min: 1, max: 5 };

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type, onSemanticSliderChange }) => {
  const {
    visualizerOptions,
    setPointSize,
    setColoringMode,
    selectedPointIndex,
    semanticState,
    setSemanticState,
    setFeatureValues,
    setApiEmbeddingCount,
    apiEmbeddingCount,
    featureValues,
    samples4D,
    selectedSample,
  } = useSample();

  const selectedEmbeddingIndex =
    selectedSample && samples4D ? samples4D.findIndex((s) => s.id === selectedSample.id) : -1;
  const isPointOutOfRange =
    apiEmbeddingCount != null &&
    selectedEmbeddingIndex >= 0 &&
    selectedEmbeddingIndex >= apiEmbeddingCount;

  const advancedMode = semanticState.advancedMode;
  const selectedFeature = semanticState.selectedFeature;
  const featureRange = semanticState.featureRange ?? (selectedFeature ? DEFAULT_FEATURE_RANGE : null);
  const sliderValue = semanticState.semanticSliderValue ?? featureRange?.min;
  const showSlider = type === '4d' && advancedMode && selectedFeature && selectedPointIndex != null;
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);

  // Check API health when Advanced Mode is on
  useEffect(() => {
    if (type !== '4d' || !advancedMode) return;
    healthCheck()
      .then((h) => {
        setApiConnected(true);
        setApiEmbeddingCount(h.embedding_count ?? null);
      })
      .catch(() => {
        setApiConnected(false);
        setApiEmbeddingCount(null);
      });
  }, [type, advancedMode, setApiEmbeddingCount]);

  // Load feature values and stats when feature is selected (for coloring and slider range)
  useEffect(() => {
    if (type !== '4d' || !selectedFeature) return;
    getFeatureValues(selectedFeature)
      .then((values) => setFeatureValues(selectedFeature, values))
      .catch(() => {});
    getFeatureStats(selectedFeature)
      .then((stats) =>
        setSemanticState((s) => ({
          ...s,
          featureRange: { min: stats.min, max: stats.max },
        }))
      )
      .catch(() => {});
  }, [type, selectedFeature, setFeatureValues, setSemanticState]);

  // When a point is selected in semantic mode, load feature range and set slider to that point's value
  useEffect(() => {
    if (type !== '4d' || !advancedMode || !selectedFeature || selectedPointIndex == null) return;
    getFeatureStats(selectedFeature)
      .then((stats) => {
        const values = featureValues[selectedFeature];
        const pointValue =
          values && selectedPointIndex < values.length && Number.isFinite(values[selectedPointIndex])
            ? values[selectedPointIndex]
            : null;
        setSemanticState((s) => ({
          ...s,
          featureRange: { min: stats.min, max: stats.max },
          semanticSliderValue: pointValue ?? s.semanticSliderValue ?? stats.min,
        }));
      })
      .catch(() => {});
  }, [type, advancedMode, selectedFeature, selectedPointIndex, setSemanticState, featureValues]);

  const handleSliderChange = (value: number) => {
    setSemanticState((s) => ({ ...s, semanticSliderValue: value }));
    if (selectedPointIndex != null && onSemanticSliderChange) {
      onSemanticSliderChange(selectedPointIndex, value);
    }
  };

  return (
    <div className="flex flex-col space-y-4 bg-slate-50/90 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
      <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">
        Click any point to view sample details.
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="pointSize" className="text-sm font-medium text-slate-700 dark:text-slate-300 w-24 shrink-0">
          Point size
        </label>
        <input
          id="pointSize"
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={visualizerOptions.pointSize}
          onChange={(e) => setPointSize(parseFloat(e.target.value))}
          className="w-32 h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <span className="text-xs text-slate-500 tabular-nums">{visualizerOptions.pointSize.toFixed(1)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">Color</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'treatment'}
              onChange={() => setColoringMode('treatment')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">Drug cluster</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'phenotype'}
              onChange={() => setColoringMode('phenotype')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">Phenotypic</span>
          </label>
        </div>
      </div>

      {type === '4d' && (
        <>
          <div className="border-t border-slate-200 dark:border-slate-600 pt-3 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) =>
                  setSemanticState((s) => ({
                    ...s,
                    advancedMode: e.target.checked,
                    selectedFeature: e.target.checked ? (s.selectedFeature || 'Fragment Length') : null,
                    projectedPosition: null,
                    projectedConfidence: null,
                    semanticSliderValue: null,
                  }))
                }
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Advanced Semantic Mode</span>
            </label>
          </div>

          {advancedMode && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Feature</label>
                <select
                  value={selectedFeature ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setSemanticState((s) => ({
                      ...s,
                      selectedFeature: v,
                      semanticSliderValue: null,
                      projectedPosition: null,
                    projectedConfidence: null,
                      featureRange: null,
                    }));
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select feature</option>
                  {FEATURE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.apiName}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {apiConnected === false && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Start the API server for semantic coloring and axis data (see server/README.md). If you use a different port, set VITE_API_URL in .env.
                  </p>
                )}
              </div>
            </>
          )}

          {advancedMode && selectedFeature && selectedPointIndex == null && (
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
              Click a point in the scatter to show the semantic axis slider.
            </p>
          )}
          {showSlider && featureRange && (
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-600">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
                Semantic axis: {selectedFeature}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Min and max are the <strong>{selectedFeature}</strong> range across all cells. Moving the slider moves the selected point along this axis in UMAP space.
              </p>
              <input
                type="range"
                min={featureRange.min}
                max={featureRange.max}
                step={Math.max(0.001, (featureRange.max - featureRange.min) / 200)}
                value={typeof sliderValue === 'number' ? sliderValue : featureRange.min}
                onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                <span title="Minimum value across dataset">min: {featureRange.min.toFixed(3)}</span>
                <span title="Current value">value: {typeof sliderValue === 'number' ? sliderValue.toFixed(3) : featureRange.min.toFixed(3)}</span>
                <span title="Maximum value across dataset">max: {featureRange.max.toFixed(3)}</span>
              </div>
              {semanticState.projectedConfidence != null && semanticState.projectedConfidence < 1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400" title="Position is extrapolating slightly from the data manifold">
                  Confidence: {Math.round(semanticState.projectedConfidence * 100)}% (near manifold)
                </p>
              )}
              {apiConnected === false && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Start the API server for live projection (see server/README.md).
                </p>
              )}
              {apiConnected === true && isPointOutOfRange && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This point is outside the API range (semantic axis works for first {apiEmbeddingCount?.toLocaleString()} points). Try selecting a point nearer the origin.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VisualizerControls;
