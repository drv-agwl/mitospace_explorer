import React from 'react';
import { Microscope } from 'lucide-react';
import { useSample } from '../context/SampleContext';

interface VisualizerControlsProps {
  type: '2d' | '4d';
}

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type }) => {
  const { visualizerOptions, setPointSize, setColoringMode } = useSample();
  
  return (
    <div className="flex flex-col space-y-3 bg-blue-50 p-4 rounded-lg">
      <div className="flex items-center">
        <div className="text-xs text-gray-600 font-medium">
          Click on any point to view detailed sample information.
        </div>
      </div>
      
      <div className="flex items-center space-x-3">
        <label htmlFor="pointSize" className="text-sm font-medium text-gray-700 w-24">
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

      <div className="flex items-center">
        <label className="text-sm font-medium text-gray-700 w-24">
          Color Mode:
        </label>
        <div className="flex space-x-4">
          <div className="flex items-center">
            <input
              id="treatment"
              type="radio"
              name="coloringMode"
              value="treatment"
              checked={visualizerOptions.coloringMode === 'treatment'}
              onChange={() => setColoringMode('treatment')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="treatment" className="ml-2 text-sm text-gray-700">
              Drug
            </label>
          </div>
          <div className="flex items-center">
            <input
              id="phenotype"
              type="radio"
              name="coloringMode"
              value="phenotype"
              checked={visualizerOptions.coloringMode === 'phenotype'}
              onChange={() => setColoringMode('phenotype')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="phenotype" className="ml-2 text-sm text-gray-700">
              Phenotype
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisualizerControls;