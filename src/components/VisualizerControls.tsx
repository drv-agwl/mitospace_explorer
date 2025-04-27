import React from 'react';
import { Microscope } from 'lucide-react';
import { useSample } from '../context/SampleContext';

interface VisualizerControlsProps {
  type: '2d' | '4d';
}

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type }) => {
  const { visualizerOptions, setPointSize, setColoringMode } = useSample();
  
  return (
    <div className="flex flex-col space-y-2 bg-blue-50 p-4 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {/* Title removed to avoid duplication with tab navigation */}
        </div>
        
        <div className="text-xs text-gray-600">
          {type === '2d' ? 
            'Click on any point to view detailed sample information.' : 
            'Click on any point to view detailed sample information.'
          }
        </div>
      </div>
      
      <div className="flex items-center space-x-3">
        <label htmlFor="pointSize" className="text-sm font-medium text-gray-700">
          Point Size:
        </label>
        <input
          id="pointSize"
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={visualizerOptions.pointSize}
          onChange={(e) => setPointSize(parseFloat(e.target.value))}
          className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <span className="text-xs text-gray-600">{visualizerOptions.pointSize.toFixed(1)}</span>
      </div>

      <div className="flex items-center space-x-3">
        <label htmlFor="coloringMode" className="text-sm font-medium text-gray-700">
          Color Mode:
        </label>
        <select
          id="coloringMode"
          value={visualizerOptions.coloringMode}
          onChange={(e) => setColoringMode(e.target.value as 'treatment' | 'phenotype')}
          className="w-48 h-8 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="treatment">Drug Coloring</option>
          <option value="phenotype">Phenotypic Category Coloring</option>
        </select>
      </div>
    </div>
  );
};

export default VisualizerControls;