import React, { useEffect, useState, useRef } from 'react';
import { SlidersHorizontal, Palette, Sparkles, LayoutList, ImageIcon, Filter, X } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import { getFeatureStats, getFeatureValues, healthCheck } from '../api/client';
import { findNearestSampleIndex } from './SemanticAxisPreview';

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
    setSelectedSample,
    selectedDrugs,
    availableDrugs,
    toggleDrugFilter,
    selectAllDrugFilter,
    clearDrugFilter,
  } = useSample();

  const [drugFilterOpen, setDrugFilterOpen] = useState(false);
  const drugFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drugFilterRef.current && !drugFilterRef.current.contains(e.target as Node)) {
        setDrugFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    let cancelled = false;
    const tryHealth = (attempt = 0) => {
      healthCheck()
        .then((h) => {
          if (!cancelled) {
            setApiConnected(true);
            setApiEmbeddingCount(h.embedding_count ?? null);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 2) {
            setTimeout(() => tryHealth(attempt + 1), 1500);
          } else {
            setApiConnected(false);
            setApiEmbeddingCount(null);
          }
        });
    };
    tryHealth();
    return () => {
      cancelled = true;
    };
  }, [type, advancedMode, setApiEmbeddingCount]);

  useEffect(() => {
    if (type !== '4d' || !selectedFeature) return;
    setFeatureLoading(true);
    Promise.all([
      getFeatureValues(selectedFeature).then((values) => setFeatureValues(selectedFeature, values)).catch(() => {}),
      getFeatureStats(selectedFeature)
        .then((stats) => {
          setApiConnected(true);
          setSemanticState((s) => ({
            ...s,
            featureRange: { min: stats.min, max: stats.max },
          }));
        })
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
  const controlBg = 'bg-white/[0.04]';
  const divider = 'h-4 w-px bg-white/15';

  return (
    <div className="flex flex-wrap items-center justify-evenly gap-x-6 gap-y-3 w-full">
      {/* Point size */}
      <div className={`flex items-center gap-3 px-4 py-2 rounded-lg ${controlBg} border border-white/[0.06]`}>
        <SlidersHorizontal size={16} className="text-white/50 shrink-0" />
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
        <span className={`text-xs tabular-nums font-mono w-8 ${textMutedClass}`}>
          {visualizerOptions.pointSize.toFixed(1)}
        </span>
      </div>

      <div className={divider} />

      {/* Drug filter */}
      <div className="relative" ref={drugFilterRef}>
        <button
          onClick={() => setDrugFilterOpen(!drugFilterOpen)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${controlBg} border border-white/[0.06] ${
            selectedDrugs.size > 0
              ? 'bg-white/10 text-white border-white/20'
              : 'text-white/70 hover:text-white/90 hover:bg-white/[0.06]'
          }`}
        >
          <Filter size={16} className="text-white/50 shrink-0" />
          <span>
            {selectedDrugs.size === 0
              ? 'All conditions'
              : `${selectedDrugs.size} condition${selectedDrugs.size === 1 ? '' : 's'} selected`}
          </span>
        </button>
        {drugFilterOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.12] bg-black/95 shadow-xl py-2 scrollbar-thin">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 mb-2">
              <span className="text-xs font-medium text-white/60 uppercase tracking-wider">Filter by condition</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllDrugFilter}
                  className="text-xs text-white/60 hover:text-white"
                >
                  Select all
                </button>
                <button
                  onClick={clearDrugFilter}
                  className="flex items-center gap-1 text-xs text-white/60 hover:text-white"
                >
                  <X size={12} />
                  Clear all
                </button>
              </div>
            </div>
            <div className="px-2 space-y-0.5">
              {availableDrugs.map((drug) => (
                <label
                  key={drug}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.06]"
                >
                  <input
                    type="checkbox"
                    checked={selectedDrugs.has(drug)}
                    onChange={() => toggleDrugFilter(drug)}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <span className="text-sm text-white/90">{drug}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={divider} />

      {/* Color by */}
      <div className={`flex items-center gap-4 px-4 py-2 rounded-lg ${controlBg} border border-white/[0.06]`}>
        <Palette size={16} className="text-white/50 shrink-0" />
        <span className={`text-sm font-medium shrink-0 ${textClass}`}>Color by</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'treatment'}
              onChange={() => setColoringMode('treatment')}
              className="w-4 h-4 accent-white"
            />
            <span className={`text-sm ${textClass} group-hover:text-white`}>Drug</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="coloringMode"
              checked={visualizerOptions.coloringMode === 'phenotype'}
              onChange={() => setColoringMode('phenotype')}
              className="w-4 h-4 accent-white"
            />
            <span className={`text-sm ${textClass} group-hover:text-white`}>Phenotype</span>
          </label>
        </div>
      </div>

      {type === '4d' && (
        <>
          <div className={divider} />
          <div className={`flex items-center gap-3 px-4 py-2 rounded-lg ${controlBg} border border-white/[0.06]`}>
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
                    axisSamplesVisible: e.target.checked ? s.axisSamplesVisible : false,
                  }))
                }
                className="w-4 h-4 rounded accent-white"
              />
              <Sparkles size={16} className="text-white/50 shrink-0" />
              <span className={`text-sm font-medium ${textClass}`}>Semantic axis</span>
            </label>
          </div>

          {advancedMode && (
            <div className={`flex flex-wrap items-center gap-4 px-4 py-2 rounded-lg ${controlBg} border border-white/[0.06]`}>
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
                      axisSamplesVisible: false,
                    }));
                  }}
                  disabled={featureLoading}
                  className="w-40 text-sm py-1.5 px-3 rounded-md border border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30 focus:border-white/30 transition-colors disabled:opacity-60"
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
                <div className="text-xs text-amber-400 flex flex-col gap-1">
                  <p className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    API offline — semantic mode needs the backend.
                  </p>
                  <p className="text-white/70 pl-4">
                    {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                      ? 'Run from project root: uvicorn server.main:app --reload --port 8000'
                      : 'If this is the deployed site, ensure the backend is deployed (e.g. Render) and VITE_API_URL is set in Netlify, then redeploy.'}
                  </p>
                </div>
              )}
              {selectedFeature && (
                <button
                  onClick={() =>
                    setSemanticState((s) => ({
                      ...s,
                      axisSamplesVisible: !s.axisSamplesVisible,
                    }))
                  }
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    semanticState.axisSamplesVisible
                      ? 'bg-white/15 text-white'
                      : 'bg-white/5 hover:bg-white/10 text-white/80'
                  }`}
                >
                  <LayoutList size={14} />
                  {semanticState.axisSamplesVisible ? 'Hide samples' : 'Visualize samples along axis'}
                </button>
              )}
            </div>
          )}

          {advancedMode && selectedFeature && selectedPointIndex == null && (
            <p className={`text-xs ${textMutedClass} italic`}>Click a point to enable axis slider</p>
          )}
          {showSlider && featureRange && (
            <div className={`flex items-center gap-4 flex-wrap px-4 py-2 rounded-lg ${controlBg} border border-white/[0.06]`}>
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
              <button
                onClick={() => {
                  const vals = featureValues[selectedFeature];
                  if (!vals || !featureRange) return;
                  const target = typeof sliderValue === 'number' ? sliderValue : featureRange.min;
                  const maxIdx = apiEmbeddingCount ?? vals.length;
                  const idx = findNearestSampleIndex(target, vals, maxIdx);
                  const sample = samples4D[idx];
                  if (sample) setSelectedSample(sample);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
                title="Show sample at current axis position"
              >
                <ImageIcon size={14} />
                Render
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VisualizerControls;
