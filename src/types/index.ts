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
  color_phenotypic: {
    r: number;
    g: number;
    b: number;
  };
  treatment: {
    drug: string;
    dose: string;
    time: string;
  };
  images?: string[]; // Optional for 2D samples
  videos?: string[]; // Optional for 4D samples
  metadata: Record<string, string | number>;
}

export interface VisualizerProps {
  samples: Sample[];
  onSampleSelect: (sample: Sample) => void;
}

export type ColoringMode = 'treatment' | 'phenotype';

export interface VisualizerOptions {
  coloringMode: ColoringMode;
  pointSize: number;
  backgroundColor: string;
}