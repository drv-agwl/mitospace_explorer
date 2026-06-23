import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { Sample, ColoringMode, VisualizerOptions, RenderingMode, LabelVisibility, PerformanceMode, SemanticState, AxisStyle, DatasetVersion } from '../types';
import { samples2D, samples4D as samples4DV1, loadSamples4DV3 } from '../data/sampleData';
import { parseView, hasViewState } from '../lib/shareView';

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
  axisStyle: initialAxisStyle,
};

/** A cell pinned into the comparison gallery. `index` is its position in
 *  `samples4D` (for 3D highlight / re-focus); null when unknown. */
export interface ComparisonCell {
  sample: Sample;
  index: number | null;
}

/** Max cells that can be compared side-by-side (layout + video perf bound). */
export const MAX_COMPARISON = 6;

interface SampleContextType {
  samples2D: Sample[];
  samples4D: Sample[];
  /** Active 4D dataset version. v1 is bundled; v3 is fetched on first use. */
  datasetVersion: DatasetVersion;
  /** True while v3 is being fetched after a toggle. */
  datasetLoading: boolean;
  setDatasetVersion: (v: DatasetVersion) => void;
  selectedSample: Sample | null;
  selectedPointIndex: number | null;
  searchQuery: string;
  visualizerOptions: VisualizerOptions;
  semanticState: SemanticState;
  /** Feature values by feature name (e.g. "Fragment Length") for coloring; index-aligned with samples. */
  featureValues: Record<string, number[]>;
  /** Max valid embedding index from API (0 to apiEmbeddingCount - 1). */
  apiEmbeddingCount: number | null;
  setApiEmbeddingCount: (n: number | null) => void;
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
  filteredSamples2D: Sample[];
  filteredSamples4D: Sample[];
  selectedDrugs: Set<string>;
  availableDrugs: string[];
  setSelectedDrugs: (drugs: Set<string>) => void;
  toggleDrugFilter: (drug: string) => void;
  selectAllDrugFilter: () => void;
  clearDrugFilter: () => void;
  /** Cells pinned for side-by-side comparison in the Cells panel. */
  comparisonCells: ComparisonCell[];
  addComparisonCell: (sample: Sample, index: number | null) => void;
  removeComparisonCell: (id: string) => void;
  toggleComparisonCell: (sample: Sample, index: number | null) => void;
  clearComparison: () => void;
}

const defaultOptions: VisualizerOptions = {
  coloringMode: 'treatment',
  pointSize: 1.5,
  backgroundColor: '#ffffff', // White background as requested
  renderingMode: 'instanced',
  labelVisibility: 'selected',
  showAxes: true,
  showGrid: false,
  highlightSelected: true,
  performance: 'balanced'
};

const SampleContext = createContext<SampleContextType | null>(null);

// Persisted key kept for migration; public UI no longer offers v1 (see `DatasetToggle.tsx`).
const DATASET_STORAGE_KEY = 'mitospace.datasetVersion';
const initialDatasetVersion: DatasetVersion = 'v3';

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
  const [comparisonCells, setComparisonCells] = useState<ComparisonCell[]>([]);
  const [visualizerOptions, setVisualizerOptions] = useState<VisualizerOptions>(() => ({
    ...defaultOptions,
    pointSize: initialDatasetVersion === 'v3' ? 1.0 : 1.5,
  }));
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
  const setFeatureValues = useCallback((feature: string, values: number[]) => {
    setFeatureValuesState(prev => ({ ...prev, [feature]: values }));
  }, []);

  // Dataset version + 4D samples (v1 is bundled; v3 fetched on demand)
  const [datasetVersion, setDatasetVersionState] = useState<DatasetVersion>(initialDatasetVersion);
  const [samples4DV3, setSamples4DV3] = useState<Sample[] | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);

  useEffect(() => {
    if (datasetVersion !== 'v3') return;
    if (samples4DV3) return;
    let cancelled = false;
    setDatasetLoading(true);
    loadSamples4DV3()
      .then((pts) => {
        if (!cancelled) setSamples4DV3(pts);
      })
      .catch((err) => {
        console.error('[dataset] failed to load v3 samples', err);
      })
      .finally(() => {
        if (!cancelled) setDatasetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetVersion, samples4DV3]);

  const setDatasetVersion = useCallback((v: DatasetVersion) => {
    setDatasetVersionState(v);
    try {
      window.localStorage?.setItem(DATASET_STORAGE_KEY, v);
    } catch {
      // ignore
    }
    // Per-dataset defaults (camera is handled in Visualizer4D)
    setVisualizerOptions((prev) => ({
      ...prev,
      pointSize: v === 'v3' ? 1.0 : 1.5,
    }));
    // When switching datasets, drop point-specific state (indices won't align)
    setSelectedSample(null);
    setSelectedPointIndex(null);
    setComparisonCells([]);
    setSemanticState((prev) => ({
      ...initialSemanticState,
      // Preserve the user's chosen axis-style across dataset switches.
      axisStyle: prev.axisStyle ?? initialSemanticState.axisStyle,
    }));
    setFeatureValuesState({});
    setApiEmbeddingCount(null);
  }, []);

  const samples4D: Sample[] = datasetVersion === 'v3' ? (samples4DV3 ?? []) : samples4DV1;
  
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

  // ── Comparison gallery (multi-cell) ─────────────────────────────────────
  const addComparisonCell = useCallback((sample: Sample, index: number | null) => {
    setComparisonCells((prev) => {
      if (prev.some((c) => c.sample.id === sample.id)) return prev;
      const next = [...prev, { sample, index }];
      // Cap the set; evict oldest first (FIFO) so recent adds stay visible.
      return next.length > MAX_COMPARISON ? next.slice(next.length - MAX_COMPARISON) : next;
    });
  }, []);

  const removeComparisonCell = useCallback((id: string) => {
    setComparisonCells((prev) => prev.filter((c) => c.sample.id !== id));
  }, []);

  const toggleComparisonCell = useCallback((sample: Sample, index: number | null) => {
    setComparisonCells((prev) => {
      if (prev.some((c) => c.sample.id === sample.id)) {
        return prev.filter((c) => c.sample.id !== sample.id);
      }
      const next = [...prev, { sample, index }];
      return next.length > MAX_COMPARISON ? next.slice(next.length - MAX_COMPARISON) : next;
    });
  }, []);

  const clearComparison = useCallback(() => setComparisonCells([]), []);

  const availableDrugs = useMemo(() => {
    const drugs = new Set<string>();
    // v3 4D points can use different drug slugs than the bundled v1 `points2d.json`;
    // older v3 exports used a typo slug for Latrunculin B (`lantrunculinb`), now
    // normalized to `latrunculinb` in data + backend.
    // Merging both into one filter list produced two checkboxes for the same
    // compound; picking the v1-only slug hid every v3 point. Only list drugs
    // present in the active dataset's 4D samples when on v3.
    if (datasetVersion === 'v3') {
      samples4D.forEach((s) => drugs.add(s.treatment.drug));
    } else {
      samples2D.forEach((s) => drugs.add(s.treatment.drug));
      samples4D.forEach((s) => drugs.add(s.treatment.drug));
    }
    return Array.from(drugs).sort((a, b) => a.localeCompare(b));
  }, [datasetVersion, samples4D]);

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
  }, []);

  const selectAllDrugFilter = useCallback(() => {
    setSelectedDrugs(new Set(availableDrugs));
  }, [availableDrugs]);

  const clearDrugFilter = useCallback(() => {
    setSelectedDrugs(new Set());
    setSearchQuery('');
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

  const filteredSamples2D = useMemo(() => filterSamples(samples2D), [filterSamples]);
  const filteredSamples4D = useMemo(() => filterSamples(samples4D), [filterSamples, samples4D]);

  useEffect(() => {
    if (!selectedSample) return;
    const inFiltered =
      filteredSamples2D.some(s => s.id === selectedSample.id) ||
      filteredSamples4D.some(s => s.id === selectedSample.id);
    if (!inFiltered) {
      setSelectedSample(null);
      setSelectedPointIndex(null);
    }
  }, [filteredSamples2D, filteredSamples4D, selectedSample, setSelectedSample, setSelectedPointIndex]);

  // Restore a shared view (?color=…&drug=…&sel=…&cmp=…) once samples are ready.
  const viewAppliedRef = useRef(false);
  useEffect(() => {
    if (viewAppliedRef.current || samples4D.length === 0) return;
    const view = parseView(window.location.search);
    viewAppliedRef.current = true;
    if (!hasViewState(view)) return;
    try {
      if (view.feature) {
        setSemanticState((s) => ({
          ...s,
          advancedMode: true,
          selectedFeature: view.feature as string,
          semanticSliderValue: null,
          projectedPosition: null,
          projectedConfidence: null,
          axisSamplesVisible: false,
        }));
      } else if (view.mode === 'phenotype') {
        setColoringMode('phenotype');
      }
      if (view.drugs && view.drugs.length) {
        const wanted = new Set(view.drugs.map((d) => d.toLowerCase()));
        const matched = samples4D
          .filter((s) => wanted.has(s.treatment.drug.toLowerCase()))
          .map((s) => s.treatment.drug);
        if (matched.length) setSelectedDrugs(new Set(matched));
      }
      view.cmp?.forEach((id) => {
        const idx = samples4D.findIndex((s) => s.id === id);
        if (idx >= 0) addComparisonCell(samples4D[idx], idx);
      });
      if (view.sel) {
        const idx = samples4D.findIndex((s) => s.id === view.sel);
        if (idx >= 0) {
          setSelectedSample(samples4D[idx]);
          setSelectedPointIndex(idx);
        }
      }
    } catch (e) {
      console.error('[share] failed to apply view', e);
    }
  }, [samples4D, addComparisonCell, setSelectedDrugs, setSelectedSample, setSelectedPointIndex, setSemanticState]);

  return (
    <SampleContext.Provider
      value={{
        samples2D,
        samples4D,
        datasetVersion,
        datasetLoading,
        setDatasetVersion,
        selectedSample,
        selectedPointIndex,
        searchQuery,
        visualizerOptions,
        semanticState,
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
        filteredSamples2D,
        filteredSamples4D,
        selectedDrugs,
        availableDrugs,
        setSelectedDrugs,
        toggleDrugFilter,
        selectAllDrugFilter,
        clearDrugFilter,
        comparisonCells,
        addComparisonCell,
        removeComparisonCell,
        toggleComparisonCell,
        clearComparison,
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
