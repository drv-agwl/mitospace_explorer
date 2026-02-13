import React, { useEffect, useState } from 'react';
import { useSample } from '../context/SampleContext';
import { getFeatureStats, getFeatureValues, healthCheck } from '../api/client';

interface VisualizerControlsProps {
  type: '2d' | '4d';
  onSemanticSliderChange?: (pointIndex: number, targetValue: number) => void;
  dark?: boolean;
}

const FEATURE_OPTIONS = [
  { id: 'fragment_length', label: 'Fragment Length', apiName: 'Fragment Length' },
  { id: 'segment_length', label: 'Segment Length', apiName: 'Segment Length' },
];

const DEFAULT_FEATURE_RANGE = { min: 1, max: 5 };

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type, onSemanticSliderChange, dark = true }) => {
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
  const [featureLoading, setFeatureLoading] = useState(false);

  useEffect(() => {
    if (type !== '4d' || !advancedMode) return;
    setApiConnected(null);
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

  useEffect(() => {
    if (type !== '4d' || !selectedFeature) return;
    setFeatureLoading(true);
    Promise.all([
      getFeatureValues(selectedFeature).then((values) => setFeatureValues(selectedFeature, values)).catch(() => {}),
      getFeatureStats(selectedFeature)
        .then((stats) =>
          setSemanticState((s) => ({
            ...s,
            featureRange: { min: stats.min, max: stats.max },
          }))
        )
        .catch(() => {}),
    ]).finally(() => setFeatureLoading(false));
  }, [type, selectedFeature, setFeatureValues, setSemanticState]);

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

  const textClass = 'text-white/90';
  const textMutedClass = 'text-white/50';

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-3">
        <label htmlFor="pointSize" className={`text-sm font-medium shrink-0 ${textClass}`}>
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
          className="w-24 h-1.5 accent-white"
        />
        <span className={`text-xs tabular-nums w-8 ${textMutedClass}`}>
          {visualizerOptions.pointSize.toFixed(1)}
        </span>
      </div>

      <div className="h-4 w-px bg-white/20" />

      <div className="flex items-center gap-4">
        <span className={`text-sm font-medium shrink-0 ${textClass}`}>Color by</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'treatment'}
              onChange={() => setColoringMode('treatment')}
              className="w-4 h-4 accent-white"
            />
            <span className={`text-sm ${textClass}`}>Drug</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'phenotype'}
              onChange={() => setColoringMode('phenotype')}
              className="w-4 h-4 accent-white"
            />
            <span className={`text-sm ${textClass}`}>Phenotype</span>
          </label>
        </div>
      </div>

      {type === '4d' && (
        <>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center gap-3">
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
                className="w-4 h-4 rounded accent-white"
              />
              <span className={`text-sm font-medium ${textClass}`}>Semantic axis</span>
            </label>
          </div>

          {advancedMode && (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className={`text-sm font-medium shrink-0 ${textClass}`}>Feature</label>
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
                  disabled={featureLoading}
                  className="w-40 text-sm py-1.5 px-3 rounded-lg border border-white/20 bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-white/30 focus:border-white/40 transition-colors disabled:opacity-60"
                >
                  <option value="">Select</option>
                  {FEATURE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.apiName} className="bg-black text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
                {featureLoading && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
              </div>
              {apiConnected === false && (
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  API offline — start server for semantic mode
                </p>
              )}
            </div>
          )}

          {advancedMode && selectedFeature && selectedPointIndex == null && (
            <p className={`text-xs ${textMutedClass}`}>Click a point to enable axis slider</p>
          )}
          {showSlider && featureRange && (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-[200px]">
                <span className={`text-xs shrink-0 ${textMutedClass}`}>{featureRange.min.toFixed(3)}</span>
                <input
                  type="range"
                  min={featureRange.min}
                  max={featureRange.max}
                  step={Math.max(0.001, (featureRange.max - featureRange.min) / 200)}
                  value={typeof sliderValue === 'number' ? sliderValue : featureRange.min}
                  onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 accent-white"
                />
                <span className={`text-xs shrink-0 ${textMutedClass}`}>{featureRange.max.toFixed(3)}</span>
              </div>
              <span className={`text-xs tabular-nums ${textMutedClass}`}>
                {selectedFeature}: {(typeof sliderValue === 'number' ? sliderValue : featureRange.min).toFixed(3)}
              </span>
              {semanticState.projectedConfidence != null && semanticState.projectedConfidence < 1 && (
                <span className="text-xs text-amber-400">
                  Confidence: {Math.round(semanticState.projectedConfidence * 100)}%
                </span>
              )}
              {apiConnected === true && isPointOutOfRange && (
                <span className="text-xs text-amber-400">
                  Point outside API range ({apiEmbeddingCount?.toLocaleString()} points)
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VisualizerControls;
