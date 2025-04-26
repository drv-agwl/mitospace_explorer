import React from 'react';
import { Microscope } from 'lucide-react';
import { useSample } from '../context/SampleContext';

interface VisualizerControlsProps {
  type: '2d' | '4d';
}

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type }) => {
  const { visualizerOptions, setPointSize } = useSample();
  
  return (
    <div className="flex flex-col space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Microscope size={18} className="text-blue-600" />
          <h3 className="text-lg font-semibold">{type === '2d' ? '2D MitoSpace' : '4D MitoSpace'}</h3>
        </div>
        
        <div className="text-xs text-gray-600">
          {type === '2d' ? 
            'Click on any point to view detailed sample information.' : 
            'Use the time slider to explore temporal changes.'
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
    </div>
  );
};

export default VisualizerControls;