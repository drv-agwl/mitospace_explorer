export interface Sample {
  id: string;
  x: number;
  y: number;
  z: number;
  t?: number; // Time dimension for 4D
  phenotype: string;
  color: {
    r: number;
    g: number;
    b: number;
  };
  // Optional: only present in v1 dataset. v3 dropped per-phenotype color.
  color_phenotypic?: {
    r: number;
    g?: number;
    b: number;
  };
  treatment: {
    drug: string;
    dose: string;
    time: string;
    smiles?: string;
    pubchem?: string;
  };
  images?: string[]; // Optional for 2D samples
  videos?: string[]; // Optional for 4D samples
  metadata: Record<string, string | number>;
}

/**
 * Dataset version. v1 = 2024 LLSM (~13K pts, mtg+tmrm videos),
 * v3 = 2025 expanded set (~36K pts, single mtg video, MOA labels).
 */
export type DatasetVersion = 'v1' | 'v3';

export interface VisualizerProps {
  samples: Sample[];
  onSampleSelect: (sample: Sample) => void;
}

export type ColoringMode = 'treatment' | 'phenotype';
export type RenderingMode = 'points' | 'instanced';

/**
 * How the semantic axis is drawn in 3D space. Temporary A/B switch while we
 * pick the best representation. Default is `cursor`: no path geometry at
 * all — only a smoothly-moving plasma-coloured ball traverses the cloud,
 * driven by a hidden density-grounded trajectory.
 */
export type AxisStyle =
  | 'cursor'
  | 'cursor-axis'
  | 'beads'
  | 'tube-masked'
  | 'tube'
  | 'bare';

export interface SemanticState {
  advancedMode: boolean;
  selectedFeature: string | null;
  semanticSliderValue: number | null;
  projectedPosition: { x: number; y: number; z: number } | null;
  /** 1 = on manifold, <1 when extrapolating (for confidence indicator) */
  projectedConfidence: number | null;
  featureRange: { min: number; max: number } | null;
  /** Feature name that `featureRange` was computed for (avoids cross-feature flashes). */
  featureRangeFeature?: string | null;
  /** Show 5 samples uniformly spread along the axis */
  axisSamplesVisible?: boolean;
  /** Active 3D representation of the semantic axis. */
  axisStyle?: AxisStyle;
}

export interface FeatureOption {
  id: string;
  label: string;
  columnName: string;
  weightsPath: string;
  biasPath: string;
}
export type LabelVisibility = 'none' | 'selected' | 'all';

export interface VisualizerOptions {
  coloringMode: ColoringMode;
  pointSize: number;
  backgroundColor: string;
  renderingMode?: RenderingMode;
  labelVisibility?: LabelVisibility;
  showAxes?: boolean;
  showGrid?: boolean;
  highlightSelected?: boolean;
  performance?: PerformanceMode;
}

export type PerformanceMode = 'quality' | 'balanced' | 'performance';