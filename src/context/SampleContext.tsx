import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sample, ColoringMode, VisualizerOptions, RenderingMode, LabelVisibility, PerformanceMode, SemanticState, AxisStyle, DatasetVersion } from '../types';
import { getDatasetRowHash, loadSamples4DV3 } from '../data/sampleData';
import type { ApiHealth } from '../api/client';
import { trackError, trackEvent } from '../analytics';
import { compareConditions } from '../constants/conditions';
import { getFeatureGroups } from '../constants/features';
import { buildSampleIdToIndex } from '../utils/sampleIndexMap';

/** Most cells the comparison lays out side by side. */
export const MAX_COMPARE_CELLS = 6;
/** map = Shift-click, pick = click while picking cells, strip = a strip tile. */
export type CompareSource = 'map' | 'pick' | 'strip' | 'panel' | 'tray' | 'view';

// Persist the user's preferred 3D axis representation across reloads so the
// A/B comparison sticks. Default = 'cursor' (no axis geometry; a smooth
// ball traverses the cloud).
// Key is versioned so that adding a new recommended default migrates users
// off any prior pinned choice. Bump suffix when shipping a new default.
const AXIS_STYLE_STORAGE_KEY = 'mitospace.axisStyle.v4';
const initialAxisStyle: AxisStyle = (() => {
  if (typeof window === 'undefined') return 'cursor';
  const saved = window.localStorage?.getItem(AXIS_STYLE_STORAGE_KEY);
  return saved === 'cursor' ||
    saved === 'cursor-axis' ||
    saved === 'beads' ||
    saved === 'tube' ||
    saved === 'tube-masked' ||
    saved === 'bare'
    ? (saved as AxisStyle)
    : 'cursor';
})();

const initialSemanticState: SemanticState = {
  advancedMode: false,
  selectedFeature: null,
  semanticSliderValue: null,
  projectedPosition: null,
  projectedConfidence: null,
  featureRange: null,
  featureRangeFeature: null,
  axisStyle: initialAxisStyle,
};

interface SampleContextType {
  samples4D: Sample[];
  /** Active 4D dataset version (UI is v3-only). */
  datasetVersion: DatasetVersion;
  /** True while the v3 point data is being fetched/parsed (never gated on videos). */
  datasetLoading: boolean;
  /** Set when the v3 fetch fails. */
  datasetError: string | null;
  /** Start loading the dataset (called by the explorer route; About never downloads it). */
  requestDataset: () => void;
  setDatasetVersion: (v: DatasetVersion) => void;
  selectedSample: Sample | null;
  selectedPointIndex: number | null;
  searchQuery: string;
  visualizerOptions: VisualizerOptions;
  semanticState: SemanticState;
  /** Feature whose plasma is currently painted (holds previous while a switch loads). */
  coloringFeature: string | null;
  /** Feature values by feature name (e.g. "Fragment Length") for coloring; index-aligned with samples. */
  featureValues: Record<string, number[]>;
  /** Max valid embedding index from API (0 to apiEmbeddingCount - 1). */
  apiEmbeddingCount: number | null;
  setApiEmbeddingCount: (n: number | null) => void;
  /** True when the API's rows are not in this dataset's order (feature values would be misaligned). */
  apiRowOrderMismatch: boolean;
  /** Record a health response: point count and row-order check. */
  reportApiHealth: (health: ApiHealth) => void;
  setSelectedSample: (sample: Sample | null) => void;
  setSelectedPointIndex: (index: number | null) => void;
  setSearchQuery: (query: string) => void;
  setColoringMode: (mode: ColoringMode) => void;
  setPointSize: (size: number) => void;
  setBackgroundColor: (color: string) => void;
  setRenderingMode: (mode: RenderingMode) => void;
  setLabelVisibility: (visibility: LabelVisibility) => void;
  setShowAxes: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setHighlightSelected: (highlight: boolean) => void;
  setPerformanceMode: (mode: PerformanceMode) => void;
  setSemanticState: (prev: SemanticState | ((s: SemanticState) => SemanticState)) => void;
  setFeatureValues: (feature: string, values: number[]) => void;
  filteredSamples4D: Sample[];
  selectedDrugs: Set<string>;
  availableDrugs: string[];
  setSelectedDrugs: (drugs: Set<string>) => void;
  toggleDrugFilter: (drug: string) => void;
  selectAllDrugFilter: () => void;
  clearDrugFilter: () => void;
  retryDatasetLoad: () => void;
  /** Cells collected for side-by-side comparison, in the order they were added. */
  compareSamples: Sample[];
  /** Dataset row (the API's feature order) of each compared cell. */
  compareRows: number[];
  /** Per compared cell: true when the condition filter hides it from the map. */
  compareHidden: boolean[];
  compareOpen: boolean;
  /** Adds the cell, or removes it if already there. False when the comparison is full. */
  toggleCompare: (sample: Sample, source: CompareSource) => boolean;
  removeFromCompare: (id: string, source: CompareSource) => void;
  clearCompare: () => void;
  setCompareOpen: (open: boolean) => void;
  /** Picking mode: a plain click on a cell (map or strip) adds it to the comparison. */
  comparePicking: boolean;
  setComparePicking: (on: boolean, source?: 'toolbar' | 'tray' | 'view' | 'key') => void;
  /** Select a cell and bring it into view on the map. */
  focusOnMap: (sample: Sample) => void;
  setMapFocusHandler: (handler: ((sample: Sample) => void) | null) => void;
}

const defaultOptions: VisualizerOptions = {
  coloringMode: 'treatment',
  pointSize: 1.0,
  backgroundColor: '#ffffff',
  renderingMode: 'instanced',
  labelVisibility: 'selected',
  showAxes: true,
  showGrid: false,
  highlightSelected: true,
  performance: 'balanced'
};

const SampleContext = createContext<SampleContextType | null>(null);

// Persisted key kept for migration; the public UI no longer offers v1.
const DATASET_STORAGE_KEY = 'mitospace.datasetVersion';

export const SampleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Normalize stored preference now that only v3 is exposed in the UI.
  useEffect(() => {
    try {
      window.localStorage?.setItem(DATASET_STORAGE_KEY, 'v3');
    } catch {
      // ignore
    }
  }, []);

  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDrugs, setSelectedDrugs] = useState<Set<string>>(new Set());
  const [visualizerOptions, setVisualizerOptions] = useState<VisualizerOptions>(defaultOptions);
  const [semanticState, setSemanticState] = useState<SemanticState>(initialSemanticState);
  // Persist `axisStyle` changes to localStorage so the A/B preference survives
  // reloads (only the field we care about — avoids churning storage on every
  // slider drag).
  useEffect(() => {
    const style = semanticState.axisStyle;
    if (!style) return;
    try {
      window.localStorage?.setItem(AXIS_STYLE_STORAGE_KEY, style);
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }, [semanticState.axisStyle]);
  const [featureValues, setFeatureValuesState] = useState<Record<string, number[]>>({});
  const [apiEmbeddingCount, setApiEmbeddingCount] = useState<number | null>(null);
  const [apiRowOrderMismatch, setApiRowOrderMismatch] = useState(false);
  const reportApiHealth = useCallback((health: ApiHealth) => {
    setApiEmbeddingCount(health.point_count ?? health.embedding_count ?? null);
    const ours = getDatasetRowHash();
    const mismatch = Boolean(health.row_order && ours && health.row_order !== ours);
    setApiRowOrderMismatch(mismatch);
    if (!mismatch) return;
    console.warn('[api] row order differs from this dataset; semantic axis disabled', health.row_order, ours);
    trackEvent('api_dataset_mismatch', { api: health.row_order ?? '', app: ours ?? '' });
    setSemanticState((s) => (s.advancedMode ? { ...s, advancedMode: false, selectedFeature: null } : s));
  }, []);
  const setFeatureValues = useCallback((feature: string, values: number[]) => {
    setFeatureValuesState(prev => ({ ...prev, [feature]: values }));
  }, []);

  const [datasetVersion] = useState<DatasetVersion>('v3');
  const [samples4D, setSamples4D] = useState<Sample[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(true);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [datasetRequested, setDatasetRequested] = useState(false);
  const requestDataset = useCallback(() => setDatasetRequested(true), []);

  useEffect(() => {
    if (!datasetRequested) return;
    let cancelled = false;
    setDatasetLoading(true);
    setDatasetError(null);
    loadSamples4DV3()
      .then((pts) => {
        if (cancelled) return;
        setSamples4D(pts);
        setDatasetError(null);
      })
      .catch((err) => {
        console.error('[dataset] failed to load v3 samples', err);
        trackError('dataset', err);
        if (!cancelled) {
          setDatasetError(err instanceof Error ? err.message : 'Failed to load dataset');
        }
      })
      .finally(() => {
        if (!cancelled) setDatasetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadGeneration, datasetRequested]);

  const retryDatasetLoad = useCallback(() => {
    setLoadGeneration((g) => g + 1);
  }, []);

  // Kept for API callers / future toggles; UI is locked to v3.
  const setDatasetVersion = useCallback(() => {
    try {
      window.localStorage?.setItem(DATASET_STORAGE_KEY, 'v3');
    } catch {
      // ignore
    }
  }, []);

  const setColoringMode = (mode: ColoringMode) => {
    setVisualizerOptions(prev => ({ ...prev, coloringMode: mode }));
  };

  const setPointSize = (size: number) => {
    setVisualizerOptions(prev => ({ ...prev, pointSize: size }));
  };

  const setBackgroundColor = (color: string) => {
    setVisualizerOptions(prev => ({ ...prev, backgroundColor: color }));
  };

  const setRenderingMode = (mode: RenderingMode) => {
    setVisualizerOptions(prev => ({ ...prev, renderingMode: mode }));
  };

  const setLabelVisibility = (visibility: LabelVisibility) => {
    setVisualizerOptions(prev => ({ ...prev, labelVisibility: visibility }));
  };

  const setShowAxes = (show: boolean) => {
    setVisualizerOptions(prev => ({ ...prev, showAxes: show }));
  };

  const setShowGrid = (show: boolean) => {
    setVisualizerOptions(prev => ({ ...prev, showGrid: show }));
  };

  const setHighlightSelected = (highlight: boolean) => {
    setVisualizerOptions(prev => ({ ...prev, highlightSelected: highlight }));
  };

  const setPerformanceMode = (mode: PerformanceMode) => {
    setVisualizerOptions(prev => ({ ...prev, performance: mode }));
  };

  const availableDrugs = useMemo(() => {
    const drugs = new Set<string>();
    samples4D.forEach((s) => drugs.add(s.treatment.drug));
    return Array.from(drugs).sort(compareConditions);
  }, [samples4D]);

  const toggleDrugFilter = useCallback((drug: string) => {
    setSelectedDrugs(prev => {
      const next = new Set(prev);
      if (next.has(drug)) {
        next.delete(drug);
      } else {
        next.add(drug);
      }
      return next;
    });
    trackEvent('filter_conditions', { action: 'toggle', condition: drug });
  }, []);

  const selectAllDrugFilter = useCallback(() => {
    setSelectedDrugs(new Set(availableDrugs));
    trackEvent('filter_conditions', { action: 'all' });
  }, [availableDrugs]);

  const clearDrugFilter = useCallback(() => {
    setSelectedDrugs(new Set());
    setSearchQuery('');
    trackEvent('filter_conditions', { action: 'clear' });
  }, []);

  const filterSamples = useCallback((samples: Sample[]): Sample[] => {
    let result = samples;
    if (selectedDrugs.size > 0) {
      result = result.filter(sample => selectedDrugs.has(sample.treatment.drug));
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(sample =>
        sample.treatment.drug.toLowerCase().includes(query) ||
        sample.phenotype.toLowerCase().includes(query) ||
        Object.values(sample.metadata).some(value =>
          String(value).toLowerCase().includes(query)
        )
      );
    }
    return result;
  }, [selectedDrugs, searchQuery]);

  const filteredSamples4D = useMemo(() => filterSamples(samples4D), [filterSamples, samples4D]);

  // Last feature that had both values + a matching range. While a switch is
  // in-flight we keep painting this so the cloud never drops to drug colors.
  const lastReadyFeatureRef = useRef<string | null>(null);
  const selectedFeatureReady = Boolean(
    semanticState.advancedMode &&
      semanticState.selectedFeature &&
      featureValues[semanticState.selectedFeature]?.length &&
      semanticState.featureRange &&
      semanticState.featureRangeFeature === semanticState.selectedFeature
  );
  if (selectedFeatureReady && semanticState.selectedFeature) {
    lastReadyFeatureRef.current = semanticState.selectedFeature;
  }
  const coloringFeature = (() => {
    if (!semanticState.advancedMode) return null;
    if (selectedFeatureReady) return semanticState.selectedFeature;
    const held = lastReadyFeatureRef.current;
    if (held && featureValues[held]?.length) return held;
    return null;
  })();

  useEffect(() => {
    if (!selectedSample) return;
    if (filteredSamples4D.some((s) => s.id === selectedSample.id)) return;
    // The filter hid the selected cell: show the first cell of the first visible condition instead.
    const firstCondition = Array.from(new Set(filteredSamples4D.map((s) => s.treatment.drug))).sort(
      compareConditions
    )[0];
    setSelectedSample(filteredSamples4D.find((s) => s.treatment.drug === firstCondition) ?? null);
    setSelectedPointIndex(null);
  }, [filteredSamples4D, selectedSample, setSelectedSample, setSelectedPointIndex]);

  const sampleIndexById = useMemo(() => buildSampleIdToIndex(samples4D), [samples4D]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpenState] = useState(false);
  const [comparePicking, setComparePickingState] = useState(false);
  const compareSamples = useMemo(
    () =>
      compareIds.flatMap((id) => {
        const row = sampleIndexById.get(id);
        return row === undefined ? [] : [samples4D[row]];
      }),
    [compareIds, sampleIndexById, samples4D]
  );
  const compareRows = useMemo(
    () => compareSamples.map((s) => sampleIndexById.get(s.id) ?? -1),
    [compareSamples, sampleIndexById]
  );
  const compareHidden = useMemo(() => {
    if (compareSamples.length === 0 || filteredSamples4D.length === samples4D.length) {
      return compareSamples.map(() => false);
    }
    const visible = new Set(filteredSamples4D.map((s) => s.id));
    return compareSamples.map((s) => !visible.has(s.id));
  }, [compareSamples, filteredSamples4D, samples4D.length]);

  const toggleCompare = useCallback(
    (sample: Sample, source: CompareSource) => {
      const present = compareIds.includes(sample.id);
      if (!present && compareIds.length >= MAX_COMPARE_CELLS) return false;
      const next = present ? compareIds.filter((id) => id !== sample.id) : [...compareIds, sample.id];
      setCompareIds(next);
      if (next.length === 0) setCompareOpenState(false);
      trackEvent(present ? 'compare_remove' : 'compare_add', { source, cells: next.length });
      return true;
    },
    [compareIds]
  );

  const removeFromCompare = useCallback(
    (id: string, source: CompareSource) => {
      const next = compareIds.filter((x) => x !== id);
      setCompareIds(next);
      if (next.length === 0) setCompareOpenState(false);
      trackEvent('compare_remove', { source, cells: next.length });
    },
    [compareIds]
  );

  const clearCompare = useCallback(() => {
    setCompareIds([]);
    setCompareOpenState(false);
    trackEvent('compare_clear');
  }, []);

  const setCompareOpen = useCallback(
    (open: boolean) => {
      setCompareOpenState(open);
      if (open) {
        setComparePickingState(false);
        const conditions = new Set(compareSamples.map((s) => s.treatment.drug)).size;
        trackEvent('compare_open', { cells: compareSamples.length, conditions });
      }
    },
    [compareSamples]
  );

  // Keep stable: the map ends picking in an unmount cleanup that depends on it.
  const setComparePicking = useCallback(
    (on: boolean, source: 'toolbar' | 'tray' | 'view' | 'key' = 'toolbar') => {
      setComparePickingState(on);
      if (on) trackEvent('compare_pick', { source });
    },
    []
  );

  // The map registers how to fly to a cell; without it (no map mounted) focusing just selects.
  const mapFocusRef = useRef<((sample: Sample) => void) | null>(null);
  const setMapFocusHandler = useCallback((handler: ((sample: Sample) => void) | null) => {
    mapFocusRef.current = handler;
  }, []);
  const focusOnMap = useCallback((sample: Sample) => {
    if (mapFocusRef.current) mapFocusRef.current(sample);
    else setSelectedSample(sample);
  }, []);

  // Restore a shared view (?cell=…&feature=…&conditions=…) once the dataset is in.
  const urlStateAppliedRef = useRef(false);
  useEffect(() => {
    if (urlStateAppliedRef.current || samples4D.length === 0) return;
    urlStateAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const conditions = (params.get('conditions') ?? '').split(',').filter((c) => availableDrugs.includes(c));
    if (conditions.length) setSelectedDrugs(new Set(conditions));
    const cell = samples4D.find((s) => s.id === params.get('cell'));
    if (cell) setSelectedSample(cell);
    const feature = params.get('feature');
    const knownFeature = getFeatureGroups(datasetVersion).some((g) =>
      g.features.some((f) => f.apiName === feature)
    );
    if (feature && knownFeature) {
      setSemanticState((s) => ({ ...s, advancedMode: true, selectedFeature: feature, axisSamplesVisible: true }));
    }
    // A shared comparison opens straight into the side-by-side view.
    const compare = Array.from(new Set((params.get('compare') ?? '').split(',')))
      .filter((id) => sampleIndexById.has(id))
      .slice(0, MAX_COMPARE_CELLS);
    if (compare.length) {
      setCompareIds(compare);
      setCompareOpenState(compare.length >= 2);
    }
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if ((cell || conditions.length || knownFeature || compare.length) && navigation?.type !== 'reload') {
      trackEvent('open_view_link', {
        cell: cell?.id,
        feature: knownFeature ? (feature ?? undefined) : undefined,
        conditions: conditions.length || undefined,
        compare: compare.length || undefined,
      });
    }
  }, [samples4D, availableDrugs, datasetVersion, sampleIndexById]);

  // Mirror the view into the URL; replaceState keeps history and page-view analytics quiet.
  const location = useLocation();
  useEffect(() => {
    if (!urlStateAppliedRef.current || location.pathname !== '/') return;
    const params = new URLSearchParams(window.location.search);
    const put = (key: string, value: string | null | undefined) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    put('cell', selectedSample?.id);
    put('feature', semanticState.advancedMode ? semanticState.selectedFeature : null);
    put('conditions', Array.from(selectedDrugs).sort(compareConditions).join(','));
    // Only while the comparison is open, so a copied cell link doesn't open a comparison.
    put('compare', compareOpen ? compareSamples.map((s) => s.id).join(',') : null);
    const qs = params.toString().replace(/%2C/gi, ',');
    const next = `${location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [
    location.pathname,
    selectedSample?.id,
    semanticState.advancedMode,
    semanticState.selectedFeature,
    selectedDrugs,
    compareOpen,
    compareSamples,
  ]);

  return (
    <SampleContext.Provider
      value={{
        samples4D,
        datasetVersion,
        datasetLoading,
        datasetError,
        requestDataset,
        setDatasetVersion,
        selectedSample,
        selectedPointIndex,
        searchQuery,
        visualizerOptions,
        semanticState,
        coloringFeature,
        featureValues,
        setSelectedSample,
        setSelectedPointIndex,
        setSearchQuery,
        setColoringMode,
        setPointSize,
        setBackgroundColor,
        setRenderingMode,
        setLabelVisibility,
        setShowAxes,
        setShowGrid,
        setHighlightSelected,
        setPerformanceMode,
        setSemanticState,
        setFeatureValues,
        apiEmbeddingCount,
        setApiEmbeddingCount,
        apiRowOrderMismatch,
        reportApiHealth,
        filteredSamples4D,
        selectedDrugs,
        availableDrugs,
        setSelectedDrugs,
        toggleDrugFilter,
        selectAllDrugFilter,
        clearDrugFilter,
        retryDatasetLoad,
        compareSamples,
        compareRows,
        compareHidden,
        compareOpen,
        toggleCompare,
        removeFromCompare,
        clearCompare,
        setCompareOpen,
        comparePicking,
        setComparePicking,
        focusOnMap,
        setMapFocusHandler,
      }}
    >
      {children}
    </SampleContext.Provider>
  );
};

export const useSample = (): SampleContextType => {
  const context = useContext(SampleContext);
  if (!context) {
    throw new Error('useSample must be used within a SampleProvider');
  }
  return context;
};
