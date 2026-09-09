import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { Sample, ColoringMode, VisualizerOptions, RenderingMode, LabelVisibility, PerformanceMode, SemanticState, AxisStyle, DatasetVersion } from '../types';
import { loadSamples4DV3 } from '../data/sampleData';

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

interface SampleContextType {
  samples4D: Sample[];
  /** Active 4D dataset version (UI is v3-only). */
  datasetVersion: DatasetVersion;
  /** True while the v3 point data is being fetched/parsed (never gated on videos). */
  datasetLoading: boolean;
  /** Set when the v3 fetch fails. */
  datasetError: string | null;
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
  filteredSamples4D: Sample[];
  selectedDrugs: Set<string>;
  availableDrugs: string[];
  setSelectedDrugs: (drugs: Set<string>) => void;
  toggleDrugFilter: (drug: string) => void;
  selectAllDrugFilter: () => void;
  clearDrugFilter: () => void;
  retryDatasetLoad: () => void;
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

// Persisted key kept for migration; public UI no longer offers v1 (see `DatasetToggle.tsx`).
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
  const setFeatureValues = useCallback((feature: string, values: number[]) => {
    setFeatureValuesState(prev => ({ ...prev, [feature]: values }));
  }, []);

  const [datasetVersion] = useState<DatasetVersion>('v3');
  const [samples4D, setSamples4D] = useState<Sample[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(true);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);

  useEffect(() => {
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
  }, [loadGeneration]);

  const retryDatasetLoad = useCallback(() => {
    setLoadGeneration((g) => g + 1);
  }, []);

  // Kept for API callers / future toggles; UI is locked to v3.
  const setDatasetVersion = useCallback((_v: DatasetVersion) => {
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
    return Array.from(drugs).sort((a, b) => a.localeCompare(b));
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

  const filteredSamples4D = useMemo(() => filterSamples(samples4D), [filterSamples, samples4D]);

  useEffect(() => {
    if (!selectedSample) return;
    const inFiltered = filteredSamples4D.some(s => s.id === selectedSample.id);
    if (!inFiltered) {
      setSelectedSample(null);
      setSelectedPointIndex(null);
    }
  }, [filteredSamples4D, selectedSample, setSelectedSample, setSelectedPointIndex]);

  return (
    <SampleContext.Provider
      value={{
        samples4D,
        datasetVersion,
        datasetLoading,
        datasetError,
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
        filteredSamples4D,
        selectedDrugs,
        availableDrugs,
        setSelectedDrugs,
        toggleDrugFilter,
        selectAllDrugFilter,
        clearDrugFilter,
        retryDatasetLoad,
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
