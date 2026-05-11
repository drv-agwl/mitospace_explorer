import React, { useEffect, useState, useRef } from 'react';
import {
  SlidersHorizontal,
  Sparkles,
  LayoutList,
  Filter,
  X,
  Crosshair,
  AlertTriangle,
  FlaskConical,
} from 'lucide-react';
import type { AxisStyle } from '../types';
import { useSample } from '../context/SampleContext';
import { getFeatureStats, getFeatureValues, healthCheck } from '../api/client';
import { findNearestSampleIndex } from './SemanticAxisPreview';
import FeatureSelect from './FeatureSelect';
import {
  getFeatureGroups,
  getFeatureDisplayLabel,
  getInitialSemanticAxisFeature,
} from '../constants/features';
import { formatFeatureValue } from '../utils/formatFeature';
import { buildSampleIdToIndex } from '../utils/sampleIndexMap';

interface VisualizerControlsProps {
  type: '2d' | '4d';
  onSemanticSliderChange?: (pointIndex: number, targetValue: number) => void;
  dark?: boolean;
}

const DEFAULT_FEATURE_RANGE = { min: 1, max: 5 };

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------
// All toolbar controls share the same height / radius / border weight to
// create a calm, consistent rhythm across the bar. Idle / hover / active
// states differ only by background / border opacity, never by size.
const PILL_BASE =
  'inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium border transition-all duration-150 shrink-0';
const PILL_IDLE =
  'bg-white/[0.04] border-white/[0.08] text-white/85 hover:bg-white/[0.07] hover:border-white/[0.14]';
const PILL_ACTIVE =
  'bg-white/[0.12] border-white/[0.22] text-white';
// Stronger treatment reserved for the semantic-axis toggle when ON, so the
// primary mode is always recognizable at a glance.
const PILL_PRIMARY_ACTIVE =
  'bg-white/[0.16] border-white/[0.32] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]';

// ---------------------------------------------------------------------------

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type, onSemanticSliderChange }) => {
  const {
    visualizerOptions,
    setPointSize,
    selectedPointIndex,
    semanticState,
    setSemanticState,
    setFeatureValues,
    setApiEmbeddingCount,
    apiEmbeddingCount,
    featureValues,
    samples4D,
    filteredSamples4D,
    selectedSample,
    setSelectedSample,
    selectedDrugs,
    availableDrugs,
    toggleDrugFilter,
    selectAllDrugFilter,
    clearDrugFilter,
    datasetVersion,
  } = useSample();
  const featureGroups = getFeatureGroups(datasetVersion);

  const sampleIdToEmbeddingIndex = React.useMemo(
    () => buildSampleIdToIndex(samples4D),
    [samples4D]
  );

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
  const showSlider = type === '4d' && advancedMode && selectedFeature && featureRange != null;
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [featureLoading, setFeatureLoading] = useState(false);

  useEffect(() => {
    if (type !== '4d' || !advancedMode) return;
    setApiConnected(null);
    let cancelled = false;
    const tryHealth = (attempt = 0) => {
      healthCheck(datasetVersion)
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
  }, [type, advancedMode, datasetVersion, setApiEmbeddingCount]);

  useEffect(() => {
    if (type !== '4d' || !selectedFeature) return;
    setFeatureLoading(true);
    Promise.all([
      getFeatureValues(selectedFeature, datasetVersion).then((values) => setFeatureValues(selectedFeature, values)).catch(() => {}),
      getFeatureStats(selectedFeature, datasetVersion)
        .then((stats) => {
          setApiConnected(true);
          setSemanticState((s) => ({
            ...s,
            featureRange: { min: stats.min, max: stats.max },
          }));
        })
        .catch(() => {}),
    ]).finally(() => setFeatureLoading(false));
  }, [type, selectedFeature, datasetVersion, setFeatureValues, setSemanticState]);

  useEffect(() => {
    if (type !== '4d' || !advancedMode || !selectedFeature) return;
    getFeatureStats(selectedFeature, datasetVersion)
      .then((stats) => {
        const values = featureValues[selectedFeature];
        let pointValue: number | null = null;
        if (
          selectedPointIndex != null &&
          selectedPointIndex < filteredSamples4D.length &&
          values
        ) {
          const emb =
            sampleIdToEmbeddingIndex.get(filteredSamples4D[selectedPointIndex].id) ?? -1;
          if (emb >= 0 && emb < values.length && Number.isFinite(values[emb])) {
            pointValue = values[emb];
          }
        }
        const mid = (stats.min + stats.max) / 2;
        setSemanticState((s) => ({
          ...s,
          featureRange: { min: stats.min, max: stats.max },
          semanticSliderValue: pointValue ?? s.semanticSliderValue ?? mid,
        }));
      })
      .catch(() => {});
  }, [
    type,
    advancedMode,
    selectedFeature,
    datasetVersion,
    selectedPointIndex,
    setSemanticState,
    featureValues,
    filteredSamples4D,
    sampleIdToEmbeddingIndex,
  ]);

  const handleSliderChange = (value: number) => {
    setSemanticState((s) => ({ ...s, semanticSliderValue: value }));
    const pointIndex = selectedPointIndex ?? 0;
    if (onSemanticSliderChange) {
      onSemanticSliderChange(pointIndex, value);
    }
  };

  const handleSemanticToggle = () => {
    const next = !advancedMode;
    const defaultFeature = getInitialSemanticAxisFeature(datasetVersion);
    setSemanticState((s) => ({
      ...s,
      advancedMode: next,
      selectedFeature: next ? s.selectedFeature || defaultFeature : null,
      projectedPosition: null,
      projectedConfidence: null,
      semanticSliderValue: null,
      axisSamplesVisible: next ? s.axisSamplesVisible : false,
    }));
  };

  const featureLabel = selectedFeature
    ? getFeatureDisplayLabel(selectedFeature, datasetVersion)
    : null;

  // ─── Axis-style A/B switch ─────────────────────────────────────────────
  // Temporary control (behind a `BETA` chip) for picking the 3D
  // representation of the semantic axis. Persisted via SampleContext
  // (localStorage) so the choice survives reloads. Will be retired once we
  // settle on one representation.
  const axisStyle: AxisStyle = semanticState.axisStyle ?? 'cursor-axis';
  const axisStyleOptions: Array<{ id: AxisStyle; label: string; tip: string }> = [
    {
      id: 'cursor',
      label: 'Cursor',
      tip: 'No axis geometry. A plasma-coloured ball traverses the cloud, riding a hidden density-grounded trajectory so it always stays inside dense regions.',
    },
    {
      id: 'cursor-axis',
      label: 'Cursor + Axis',
      tip: 'Same ball UI, but its waypoints are the cells nearest to the backend\u2019s learnt feature axis. Adjacent waypoints are sorted by feature value, so motion through contiguous regions is noticeably smoother — fewer cluster-to-cluster jumps. (Recommended)',
    },
    {
      id: 'beads',
      label: 'Beads',
      tip: 'Discrete waypoints anchored to cell centroids at evenly spaced quantiles. Connector fades through empty regions.',
    },
    {
      id: 'tube-masked',
      label: 'Faded curve',
      tip: 'Original curve, but its opacity is gated by local cell density — segments that pass through empty UMAP regions fade out.',
    },
    {
      id: 'tube',
      label: 'Curve',
      tip: 'Original Catmull-Rom spline through smoothed bin centroids. Can pass through empty regions.',
    },
    {
      id: 'bare',
      label: 'Minimal',
      tip: 'No path geometry. Two endpoint anchors (low / high) + the point colors do all the talking.',
    },
  ];
  const setAxisStyle = (next: AxisStyle) =>
    setSemanticState((s) => ({ ...s, axisStyle: next }));

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* ─────────────────────── PRIMARY ROW ─────────────────────── */}
      {/* Always visible. Stable layout — adding/removing the semantic axis
          never reflows this row. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left cluster: display + data */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Point size pill */}
          <div
            className={`${PILL_BASE} ${PILL_IDLE}`}
            title="Point size"
          >
            <SlidersHorizontal size={14} className="text-white/55 shrink-0" />
            <input
              id="pointSize"
              aria-label="Point size"
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={visualizerOptions.pointSize}
              onChange={(e) => setPointSize(parseFloat(e.target.value))}
              className="w-24 h-1.5 accent-white"
            />
            <span className="text-[11px] tabular-nums font-mono text-white/55 w-7 text-right">
              {visualizerOptions.pointSize.toFixed(1)}
            </span>
          </div>

          {/* Drug filter pill */}
          <div className="relative" ref={drugFilterRef}>
            <button
              onClick={() => setDrugFilterOpen(!drugFilterOpen)}
              aria-haspopup="listbox"
              aria-expanded={drugFilterOpen}
              className={`${PILL_BASE} ${
                selectedDrugs.size > 0 ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              <Filter size={14} className="text-white/55 shrink-0" />
              <span className="truncate max-w-[160px]">
                {selectedDrugs.size === 0
                  ? 'All conditions'
                  : `${selectedDrugs.size} condition${selectedDrugs.size === 1 ? '' : 's'}`}
              </span>
              {selectedDrugs.size > 0 && (
                <span className="ml-0.5 text-[10px] font-semibold tabular-nums bg-white/15 text-white px-1.5 py-0.5 rounded">
                  {selectedDrugs.size}
                </span>
              )}
            </button>
            {drugFilterOpen && (
              <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[240px] max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.12] bg-black/95 backdrop-blur-md shadow-elevated py-2 scrollbar-thin animate-slide-up origin-top">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
                    Filter by condition
                  </span>
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
                      Clear
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
        </div>

        {/* Right cluster: status + semantic axis (the primary mode switch) */}
        {type === '4d' && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* API status — only when offline. Compact dot+pill, never grows. */}
            {advancedMode && apiConnected === false && (
              <span
                className={`${PILL_BASE} bg-amber-500/10 border-amber-400/30 text-amber-200`}
                title={
                  typeof window !== 'undefined' &&
                  (window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1')
                    ? 'API offline. From the project root run: uvicorn server.main:app --reload --port 8000'
                    : 'API offline. Ensure the backend is deployed and VITE_API_URL is configured.'
                }
              >
                <AlertTriangle size={14} className="shrink-0" />
                <span>API offline</span>
              </span>
            )}

            {/* Semantic axis toggle — primary action */}
            <button
              data-tour="semantic-axis-toggle"
              onClick={handleSemanticToggle}
              role="switch"
              aria-pressed={advancedMode}
              aria-label="Toggle semantic axis mode"
              className={`${PILL_BASE} ${
                advancedMode ? PILL_PRIMARY_ACTIVE : PILL_IDLE
              } group`}
            >
              <Sparkles
                size={14}
                className={`shrink-0 transition-colors ${
                  advancedMode ? 'text-white' : 'text-white/55 group-hover:text-white/75'
                }`}
              />
              <span>Semantic axis</span>
              {advancedMode && featureLabel && (
                <span className="ml-1 px-1.5 py-0.5 text-[11px] font-medium rounded bg-white/15 text-white/85 max-w-[160px] truncate">
                  {featureLabel}
                </span>
              )}
              <span
                className={`ml-1 inline-flex items-center justify-center w-7 h-5 rounded-full text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                  advancedMode
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/60 group-hover:bg-white/15 group-hover:text-white/80'
                }`}
              >
                {advancedMode ? 'On' : 'Off'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ─────────────────────── SECONDARY ROW ─────────────────────── */}
      {/* Only when semantic axis is ON. Animates in. Hairline separator above
          makes it feel like a sub-toolbar without ever shifting the primary
          row's controls. */}
      {type === '4d' && advancedMode && (
        <div
          data-tour="semantic-feature-controls"
          className="flex items-center gap-3 flex-wrap pt-2.5 border-t border-white/[0.06] animate-fade-in"
        >
          {/* Feature picker — the canonical way to choose the semantic axis */}
          <div className="flex items-center shrink-0">
            <FeatureSelect
              groups={featureGroups}
              value={selectedFeature}
              onChange={(apiName) => {
                if (apiName === selectedFeature) return;
                setSemanticState((s) => ({
                  ...s,
                  selectedFeature: apiName,
                  projectedPosition: null,
                  projectedConfidence: null,
                  axisSamplesVisible: false,
                }));
              }}
              disabled={featureLoading}
              placeholder="Select feature"
            />
            {featureLoading && (
              <div
                className="ml-2 w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
                aria-label="Loading feature"
              />
            )}
          </div>

          {/* ─── Axis-style A/B switcher (temporary BETA) ─────────────────
              Segmented control to compare the four 3D representations of
              the semantic axis. The current `Beads` style avoids the
              "curve floating through empty UMAP regions" issue of the
              original `Curve` style. */}
          {selectedFeature && (
            <div
              className="inline-flex items-center gap-1.5 h-9 px-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shrink-0"
              role="radiogroup"
              aria-label="Axis representation style (experimental)"
              title="Pick how the semantic axis is drawn in 3D (experimental)"
            >
              <FlaskConical size={12} className="text-amber-300/80 shrink-0 ml-0.5" />
              <span className="text-[10px] font-semibold tracking-wider uppercase text-amber-300/80 shrink-0">
                Beta
              </span>
              <span className="text-[11px] text-white/45 shrink-0 ml-0.5">Style</span>
              <div className="inline-flex items-center gap-0.5 ml-1">
                {axisStyleOptions.map((opt) => {
                  const active = axisStyle === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAxisStyle(opt.id)}
                      title={opt.tip}
                      className={`px-2 h-6 rounded-md text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-white/15 text-white border border-white/25'
                          : 'text-white/65 hover:text-white hover:bg-white/[0.06] border border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Show / hide samples-along-axis */}
          {selectedFeature && (
            <button
              onClick={() =>
                setSemanticState((s) => ({
                  ...s,
                  axisSamplesVisible: !s.axisSamplesVisible,
                }))
              }
              aria-pressed={semanticState.axisSamplesVisible}
              title={
                semanticState.axisSamplesVisible
                  ? 'Hide samples along axis'
                  : 'Visualize samples along axis'
              }
              className={`${PILL_BASE} ${
                semanticState.axisSamplesVisible ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              <LayoutList size={14} className="shrink-0 text-white/65" />
              <span>
                {semanticState.axisSamplesVisible
                  ? 'Hide samples along axis'
                  : 'Samples along axis'}
              </span>
            </button>
          )}

          {/* Slider region — flex-grows to fill available space */}
          {showSlider && featureRange && (
            <div
              data-tour="semantic-axis-slider"
              className={`flex items-center gap-3 flex-1 min-w-[260px] h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] transition-opacity duration-200 ${
                featureLoading ? 'opacity-40 pointer-events-none' : ''
              }`}
            >
              <span className="text-[11px] tabular-nums font-mono text-white/40 shrink-0">
                {formatFeatureValue(featureRange.min)}
              </span>
              <input
                type="range"
                min={featureRange.min}
                max={featureRange.max}
                step={Math.max((featureRange.max - featureRange.min) / 200, 1e-9)}
                value={typeof sliderValue === 'number' ? sliderValue : featureRange.min}
                onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
                aria-label={`${featureLabel ?? 'Feature'} value`}
                aria-valuetext={formatFeatureValue(
                  typeof sliderValue === 'number' ? sliderValue : featureRange.min
                )}
                className="flex-1 h-1.5 accent-white"
              />
              <span className="text-[11px] tabular-nums font-mono text-white/40 shrink-0">
                {formatFeatureValue(featureRange.max)}
              </span>
              <span className="ml-1 px-2 py-0.5 text-[11px] font-mono tabular-nums rounded bg-white/[0.08] text-white/85 shrink-0">
                {formatFeatureValue(
                  typeof sliderValue === 'number' ? sliderValue : featureRange.min
                )}
              </span>
            </div>
          )}

          {/* Status chips: confidence + out-of-range — small, contextual,
              never break the row layout. */}
          {showSlider && semanticState.projectedConfidence != null && semanticState.projectedConfidence < 1 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] tabular-nums rounded-md bg-amber-500/10 text-amber-300 border border-amber-400/25 shrink-0"
              title="Projection confidence onto the semantic axis"
            >
              Confidence {Math.round(semanticState.projectedConfidence * 100)}%
            </span>
          )}
          {showSlider && apiConnected === true && isPointOutOfRange && (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-amber-500/10 text-amber-300 border border-amber-400/25 shrink-0"
              title={`Selected point is outside the API embedding range (${apiEmbeddingCount?.toLocaleString()} points indexed)`}
            >
              Out of range
            </span>
          )}

          {/* Snap-to-nearest-sample — icon-led, clear copy. Replaces the old
              ambiguous "Render" button. */}
          {showSlider && (
            <button
              onClick={() => {
                const vals = featureValues[selectedFeature!];
                if (!vals || !featureRange) return;
                const target =
                  typeof sliderValue === 'number' ? sliderValue : featureRange.min;
                const maxIdx = apiEmbeddingCount ?? vals.length;
                const idx = findNearestSampleIndex(target, vals, maxIdx);
                const sample = samples4D[idx];
                if (sample) setSelectedSample(sample);
              }}
              title="Open the nearest sample at the current axis value"
              className={`${PILL_BASE} ${PILL_ACTIVE}`}
            >
              <Crosshair size={14} className="shrink-0" />
              <span>Snap to sample</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VisualizerControls;
