import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { Sample, ColoringMode, VisualizerOptions, RenderingMode, LabelVisibility, PerformanceMode, SemanticState, AxisStyle, DatasetVersion } from '../types';
import { samples2D, samples4D as samples4DV1, loadSamples4DV3 } from '../data/sampleData';

// Persist the user's preferred 3D axis representation across reloads so the
// A/B comparison sticks. Default = 'cursor' (no axis geometry; a smooth
// ball traverses the cloud).
// Key is versioned so that adding a new recommended default migrates users
// off any prior pinned choice. Bump suffix when shipping a new default.
const AXIS_STYLE_STORAGE_KEY = 'mitospace.axisStyle.v3';
const initialAxisStyle: AxisStyle = (() => {
  if (typeof window === 'undefined') return 'cursor-axis';
  const saved = window.localStorage?.getItem(AXIS_STYLE_STORAGE_KEY);
  return saved === 'cursor' ||
    saved === 'cursor-axis' ||
    saved === 'beads' ||
    saved === 'tube' ||
    saved === 'tube-masked' ||
    saved === 'bare'
    ? (saved as AxisStyle)
    : 'cursor-axis';
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
}

const defaultOptions: VisualizerOptions = {
  coloringMode: 'treatment',
  pointSize: 1.5,
  backgroundColor: '#ffffff', // White background as requested
  renderingMode: 'instanced',
  labelVisibility: 'selected',
  showAxes: true,
  showGrid: true,
  highlightSelected: true,
  performance: 'balanced'
};

const SampleContext = createContext<SampleContextType | null>(null);

// Persist user's last choice across reloads
const DATASET_STORAGE_KEY = 'mitospace.datasetVersion';
const initialDatasetVersion: DatasetVersion = (() => {
  if (typeof window === 'undefined') return 'v3';
  const saved = window.localStorage?.getItem(DATASET_STORAGE_KEY);
  return saved === 'v1' || saved === 'v3' ? (saved as DatasetVersion) : 'v3';
})();

export const SampleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDrugs, setSelectedDrugs] = useState<Set<string>>(new Set());
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

  const availableDrugs = useMemo(() => {
    const drugs = new Set<string>();
    samples2D.forEach(s => drugs.add(s.treatment.drug));
    samples4D.forEach(s => drugs.add(s.treatment.drug));
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
