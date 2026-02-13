import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Sample, ColoringMode, VisualizerOptions, RenderingMode, LabelVisibility, PerformanceMode, SemanticState } from '../types';
import { samples2D, samples4D } from '../data/sampleData';

const initialSemanticState: SemanticState = {
  advancedMode: false,
  selectedFeature: null,
  semanticSliderValue: null,
  projectedPosition: null,
  projectedConfidence: null,
  featureRange: null,
};

interface SampleContextType {
  samples2D: Sample[];
  samples4D: Sample[];
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

export const SampleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visualizerOptions, setVisualizerOptions] = useState<VisualizerOptions>(defaultOptions);
  const [semanticState, setSemanticState] = useState<SemanticState>(initialSemanticState);
  const [featureValues, setFeatureValuesState] = useState<Record<string, number[]>>({});
  const [apiEmbeddingCount, setApiEmbeddingCount] = useState<number | null>(null);
  const setFeatureValues = useCallback((feature: string, values: number[]) => {
    setFeatureValuesState(prev => ({ ...prev, [feature]: values }));
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

  const filterSamples = (samples: Sample[]): Sample[] => {
    if (!searchQuery) return samples;
    
    const query = searchQuery.toLowerCase();
    return samples.filter(sample => 
      sample.treatment.drug.toLowerCase().includes(query) ||
      sample.phenotype.toLowerCase().includes(query) ||
      Object.values(sample.metadata).some(value => 
        String(value).toLowerCase().includes(query)
      )
    );
  };

  const filteredSamples2D = filterSamples(samples2D);
  const filteredSamples4D = filterSamples(samples4D);

  return (
    <SampleContext.Provider
      value={{
        samples2D,
        samples4D,
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
