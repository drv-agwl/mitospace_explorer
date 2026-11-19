import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  SlidersHorizontal,
  Sparkles,
  LayoutList,
  Filter,
  X,
  Crosshair,
  AlertTriangle,
  Columns3,
} from 'lucide-react';
import { MAX_COMPARE_CELLS, useSample } from '../context/SampleContext';
import { getFeatureStats, getFeatureValues, healthCheck } from '../api/client';
import { findNearestSampleIndex } from './SemanticAxisPreview';
import FeatureSelect from './FeatureSelect';
import SmoothHeight from './SmoothHeight';
import {
  getFeatureGroups,
  getFeatureDisplayLabel,
  getInitialSemanticAxisFeature,
} from '../constants/features';
import { formatFeatureValue, formatPercentile } from '../utils/formatFeature';
import { plasmaGradientCss } from '../utils/featureColor';
import { estimatePlasmaParams } from '../utils/featureColorParams';
import { conditionLabel } from '../constants/conditions';
import { trackError, trackEvent } from '../analytics';

interface VisualizerControlsProps {
  type: '2d' | '4d';
  onSemanticSliderChange?: (pointIndex: number, targetValue: number) => void;
  dark?: boolean;
}

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

const VisualizerControls: React.FC<VisualizerControlsProps> = ({
  type,
  onSemanticSliderChange,
}) => {
  const {
    visualizerOptions,
    setPointSize,
    selectedPointIndex,
    semanticState,
    coloringFeature,
    setSemanticState,
    setFeatureValues,
    setApiEmbeddingCount,
    reportApiHealth,
    apiRowOrderMismatch,
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
    datasetVersion,
    compareSamples,
    comparePicking,
    setComparePicking,
  } = useSample();
  const featureGroups = getFeatureGroups(datasetVersion);
  const compareCount = compareSamples.length;

  const [drugFilterOpen, setDrugFilterOpen] = useState(false);
  const drugFilterRef = useRef<HTMLDivElement>(null);
  const drugFilterButtonRef = useRef<HTMLButtonElement>(null);

  // Legend colour per condition, as drawn on the map and in the strip.
  const drugColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const s of samples4D) {
      if (colors.has(s.treatment.drug)) continue;
      const { r = 0, g = 0, b = 0 } = s.color ?? {};
      colors.set(s.treatment.drug, `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`);
    }
    return colors;
  }, [samples4D]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drugFilterRef.current && !drugFilterRef.current.contains(e.target as Node)) {
        setDrugFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Esc closes the menu only; without this it would fall through to the global "deselect cell".
  useEffect(() => {
    if (!drugFilterOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setDrugFilterOpen(false);
      drugFilterButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [drugFilterOpen]);

  const selectedEmbeddingIndex =
    selectedSample && samples4D ? samples4D.findIndex((s) => s.id === selectedSample.id) : -1;
  const isPointOutOfRange =
    apiEmbeddingCount != null &&
    selectedEmbeddingIndex >= 0 &&
    selectedEmbeddingIndex >= apiEmbeddingCount;

  const advancedMode = semanticState.advancedMode;
  const selectedFeature = semanticState.selectedFeature;
  const featureRange = semanticState.featureRange;
  const featureLoadFailed = Boolean(semanticState.featureLoadFailed);
  const sliderValue = semanticState.semanticSliderValue ?? featureRange?.min;
  const showSlider =
    type === '4d' && advancedMode && selectedFeature && featureRange != null && !featureLoadFailed;
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [featureAttempt, setFeatureAttempt] = useState(0);

  useEffect(() => {
    if (type !== '4d' || !advancedMode) return;
    setApiConnected(null);
    let cancelled = false;
    const tryHealth = (attempt = 0) => {
      healthCheck(datasetVersion)
        .then((h) => {
          if (!cancelled) {
            setApiConnected(true);
            reportApiHealth(h);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (attempt < 2) {
            setTimeout(() => tryHealth(attempt + 1), 1500);
          } else {
            setApiConnected(false);
            setApiEmbeddingCount(null);
            trackError('api_health', err);
          }
        });
    };
    tryHealth();
    return () => {
      cancelled = true;
    };
  }, [type, advancedMode, datasetVersion, setApiEmbeddingCount, reportApiHealth]);

  useEffect(() => {
    if (type !== '4d' || !selectedFeature) return;
    const feature = selectedFeature;
    let cancelled = false;
    setFeatureLoading(true);
    setSemanticState((s) => (s.featureLoadFailed ? { ...s, featureLoadFailed: false } : s));
    Promise.all([
      getFeatureValues(feature, datasetVersion),
      getFeatureStats(feature, datasetVersion),
    ])
      .then(([values, stats]) => {
        if (cancelled) return;
        setFeatureValues(feature, values);
        setApiConnected(true);
        setSemanticState((s) => {
          if (s.selectedFeature !== feature) return s;
          return {
            ...s,
            featureRange: {
              min: stats.min,
              max: stats.max,
              lowPercentile: stats.lowPercentile,
              highPercentile: stats.highPercentile,
            },
            featureRangeFeature: feature,
          };
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setApiConnected(false);
        trackError('feature_values', err);
        setSemanticState((s) =>
          s.selectedFeature === feature ? { ...s, featureLoadFailed: true } : s
        );
      })
      .finally(() => {
        if (!cancelled) setFeatureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, selectedFeature, datasetVersion, featureAttempt, setFeatureValues, setSemanticState]);

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
    trackEvent('semantic_axis', { on: next });
    setSemanticState((s) => ({
      ...s,
      advancedMode: next,
      selectedFeature: next ? s.selectedFeature || defaultFeature : null,
      projectedPosition: null,
      projectedConfidence: null,
      semanticSliderValue: null,
      // First-class behaviour: enabling the semantic axis immediately
      // reveals the "samples along axis" strip so users see the
      // representative cells alongside the 3D ball. The strip remains
      // closable via the toolbar pill.
      axisSamplesVisible: next ? true : false,
    }));
  };

  const featureLabel = selectedFeature
    ? getFeatureDisplayLabel(selectedFeature, datasetVersion)
    : null;

  // Axis-style A/B switcher retired from the toolbar — we shipped
  // `cursor` as canonical. Type `AxisStyle`, the persisted state field, and
  // the rendering branches in Visualizer4D all remain so the picker can be
  // revived behind a flag without re-implementation.

  // Per-feature plasma calibration so the slider's track gradient matches
  // the cloud's colouring exactly. Re-uses the same estimator that
  // FeatureColorBar / SemanticAxisPreview do.
  const plasmaParams = React.useMemo(() => {
    const fname = coloringFeature ?? selectedFeature;
    if (!fname) return null;
    const fv = featureValues[fname];
    if (!fv || fv.length === 0) return null;
    return estimatePlasmaParams(fv);
  }, [coloringFeature, selectedFeature, featureValues]);

  const plasmaGradient = React.useMemo(
    () => plasmaGradientCss(17, plasmaParams?.gamma, plasmaParams?.contrast, 'to right'),
    [plasmaParams]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="w-full flex flex-col">
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
              className="w-16 xl:w-24 h-1.5 accent-white"
            />
            <span className="text-[11px] tabular-nums font-mono text-white/55 w-7 text-right">
              {visualizerOptions.pointSize.toFixed(1)}
            </span>
          </div>

          {/* Drug filter pill */}
          <div className="relative" ref={drugFilterRef}>
            <button
              ref={drugFilterButtonRef}
              onClick={() => setDrugFilterOpen(!drugFilterOpen)}
              aria-haspopup="true"
              aria-expanded={drugFilterOpen}
              aria-controls="condition-filter-menu"
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
              <div
                id="condition-filter-menu"
                role="group"
                aria-label="Filter by condition"
                className="absolute top-full left-0 mt-1.5 z-50 w-[300px] max-h-[min(420px,70vh)] overflow-y-auto rounded-xl border border-white/[0.12] bg-black/95 backdrop-blur-md shadow-elevated py-2 scrollbar-thin animate-slide-up origin-top"
              >
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 mb-2 whitespace-nowrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
                    Filter by condition
                  </span>
                  <div className="flex items-center gap-3">
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
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.06]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDrugs.has(drug)}
                        onChange={() => toggleDrugFilter(drug)}
                        className="w-4 h-4 rounded accent-white"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: drugColors.get(drug) }}
                        aria-hidden="true"
                      />
                      <span className="text-sm text-white/90">{conditionLabel(drug)}</span>
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
                    : 'The feature service is not responding, so semantic-axis coloring is unavailable. You can still browse and select cells.'
                }
              >
                <AlertTriangle size={14} className="shrink-0" />
                <span>API offline</span>
              </span>
            )}

            {/* Compare cells: picking mode, where clicking cells adds them to the comparison. */}
            <button
              type="button"
              onClick={() => setComparePicking(!comparePicking, 'toolbar')}
              aria-pressed={comparePicking}
              title={
                comparePicking
                  ? 'Stop picking cells (Esc)'
                  : `Pick up to ${MAX_COMPARE_CELLS} cells and compare their movies and measurements side by side (C). Shift-clicking a dot also adds it.`
              }
              className={`${PILL_BASE} ${comparePicking ? PILL_PRIMARY_ACTIVE : PILL_IDLE} group`}
            >
              <Columns3
                size={14}
                className={`shrink-0 transition-colors ${
                  comparePicking ? 'text-white' : 'text-white/55 group-hover:text-white/75'
                }`}
              />
              <span>
                Compare<span className="sr-only xl:not-sr-only"> cells</span>
              </span>
              {compareCount > 0 && (
                <span className="ml-0.5 text-[10px] font-semibold tabular-nums bg-white/15 text-white px-1.5 py-0.5 rounded">
                  {compareCount}
                </span>
              )}
            </button>

            {/* Semantic axis toggle — primary action */}
            <button
              onClick={handleSemanticToggle}
              role="switch"
              aria-checked={advancedMode}
              aria-label="Semantic axis"
              disabled={apiRowOrderMismatch}
              title={
                apiRowOrderMismatch
                  ? "The feature service's data doesn't match this page's dataset, so feature colors would be wrong. Reload the page; if this persists, the site is mid-update."
                  : 'Color the map by a measured mitochondrial feature and browse cells from low to high'
              }
              className={`${PILL_BASE} ${
                advancedMode ? PILL_PRIMARY_ACTIVE : PILL_IDLE
              } group disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Sparkles
                size={14}
                className={`shrink-0 transition-colors ${
                  advancedMode ? 'text-white' : 'text-white/55 group-hover:text-white/75'
                }`}
              />
              <span>Semantic axis</span>
              {advancedMode && featureLabel && (
                <span className="ml-1 px-1.5 py-0.5 text-[11px] font-medium rounded bg-white/15 text-white/85 max-w-[160px] truncate hidden xl:inline">
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
      {/* Only when semantic axis is ON. Grows in and fades in. Hairline separator above
          makes it feel like a sub-toolbar without ever shifting the primary
          row's controls. */}
      <SmoothHeight>
      {type === '4d' && advancedMode && (
        <div className="mt-2.5 flex items-center gap-3 flex-wrap pt-2.5 border-t border-white/[0.06] animate-fade-in">
          {/* Feature picker — the canonical way to choose the semantic axis */}
          <div className="flex items-center shrink-0">
            <FeatureSelect
              groups={featureGroups}
              value={selectedFeature}
              onChange={(apiName) => {
                if (apiName === selectedFeature) return;
                trackEvent('select_feature', { feature: apiName ?? '' });
                setSemanticState((s) => ({
                  ...s,
                  selectedFeature: apiName,
                  projectedPosition: null,
                  projectedConfidence: null,
                  // Same default as turning semantic axis on: show the strip for the new feature.
                  axisSamplesVisible: true,
                }));
              }}
              loading={featureLoading}
              placeholder="Select feature"
            />
          </div>

          {/* Axis-style segmented control is intentionally hidden. We
              shipped the `cursor` style as canonical; the underlying A/B
              code (axisStyleOptions, setAxisStyle, AxisStyle type, all
              Three.js style branches in Visualizer4D) is retained so we
              can revive the picker behind a developer flag without
              re-implementation. */}

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
                  ? 'Hide cells along the axis'
                  : 'Show cells ordered from low to high'
              }
              className={`${PILL_BASE} ${
                semanticState.axisSamplesVisible ? PILL_ACTIVE : PILL_IDLE
              }`}
            >
              <LayoutList size={14} className="shrink-0 text-white/65" />
              <span>
                {semanticState.axisSamplesVisible
                  ? 'Hide cells along axis'
                  : 'Cells along axis'}
              </span>
            </button>
          )}

          {selectedFeature && featureLoadFailed && (
            <div
              className="flex items-center gap-2.5 flex-1 min-w-[280px] h-9 text-[12px] text-amber-200/90"
              role="alert"
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span className="truncate">
                Couldn&apos;t load {featureLabel} values. Browsing cells still works.
              </span>
              <button
                type="button"
                onClick={() => setFeatureAttempt((n) => n + 1)}
                className="inline-flex items-center h-7 px-2.5 rounded-md text-xs font-medium text-white bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.12] transition-colors shrink-0"
              >
                Retry
              </button>
            </div>
          )}
          {selectedFeature && !featureLoadFailed && !featureRange && (
            <div className="flex items-center gap-3 flex-1 min-w-[280px] h-9" aria-busy="true">
              <div className="flex-1 h-1.5 rounded-full bg-white/10" />
              <span className="text-[11px] text-white/55 shrink-0">Loading {featureLabel}…</span>
            </div>
          )}

          {/* Plasma slider — the track is the feature's exact plasma gradient,
              so dragging the thumb is also reading off the colour legend.
              Replaces the older neutral slider + separate FeatureColorBar
              overlay. */}
          {showSlider && featureRange && (
            <div
              className={`flex items-center gap-3 flex-1 min-w-[280px] h-9 transition-opacity duration-200 ${
                featureLoading ? 'opacity-40 pointer-events-none' : ''
              }`}
            >
              <span
                className="shrink-0 w-16 flex flex-col items-end gap-0.5 leading-none"
                title={
                  featureRange.lowPercentile != null
                    ? `Slider starts at the ${formatPercentile(featureRange.lowPercentile)} percentile of measured cells; lower values exist.`
                    : 'Low'
                }
              >
                <span className="text-[11px] tabular-nums font-mono text-white/55">
                  {formatFeatureValue(featureRange.min)}
                </span>
                {featureRange.lowPercentile != null && (
                  <span className="text-[10px] text-white/60">
                    {formatPercentile(featureRange.lowPercentile)} pctl
                  </span>
                )}
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
                className="plasma-slider flex-1"
                style={{ backgroundImage: plasmaGradient }}
              />
              <span
                className="shrink-0 w-16 flex flex-col items-start gap-0.5 leading-none"
                title={
                  featureRange.highPercentile != null
                    ? `Slider ends at the ${formatPercentile(featureRange.highPercentile)} percentile of measured cells; higher values exist.`
                    : 'High'
                }
              >
                <span className="text-[11px] tabular-nums font-mono text-white/55">
                  {formatFeatureValue(featureRange.max)}
                </span>
                {featureRange.highPercentile != null && (
                  <span className="text-[10px] text-white/60">
                    {formatPercentile(featureRange.highPercentile)} pctl
                  </span>
                )}
              </span>
              <span
                className="px-2 h-7 inline-flex items-center text-[11px] font-mono tabular-nums rounded-md bg-white/[0.08] border border-white/[0.10] text-white shrink-0 min-w-[64px] justify-center"
                title="Current value"
              >
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
              title="Open the cell whose value is closest to the slider"
              className={`${PILL_BASE} ${PILL_ACTIVE}`}
            >
              <Crosshair size={14} className="shrink-0" />
              <span>Open nearest cell</span>
            </button>
          )}
        </div>
      )}
      </SmoothHeight>
    </div>
  );
};

export default VisualizerControls;
