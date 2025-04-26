import { Sample } from '../types';
import points2dData from './points2d.json';
import points4dData from './points4d.json';

interface PointsData {
  points: Sample[];
}

// Load samples from JSON files with default empty arrays
export const samples2D: Sample[] = (points2dData as PointsData)?.points || [];
export const samples4D: Sample[] = (points4dData as PointsData)?.points || [];

// Group samples by time for 4D visualization
export const groupSamplesByTime = (samples: Sample[]): Record<number, Sample[]> => {
  return samples.reduce((acc, sample) => {
    const time = sample.t || 0;
    if (!acc[time]) {
      acc[time] = [];
    }
    acc[time].push(sample);
    return acc;
  }, {} as Record<number, Sample[]>);
};

export const timepoints4D = Array.from(
  new Set(samples4D.map(sample => sample.t || 0))
).sort((a, b) => a - b);