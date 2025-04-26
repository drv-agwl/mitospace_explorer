import React from 'react';
import { Palette } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import { ColoringMode } from '../types';
import { HexColorPicker } from 'react-colorful';

interface VisualizerControlsProps {
  type: '2d' | '4d';
}

const VisualizerControls: React.FC<VisualizerControlsProps> = ({ type }) => {
  const { 
    visualizerOptions, 
    setColoringMode, 
    setPointSize,
    setBackgroundColor
  } = useSample();
  
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  
  const handleColoringModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setColoringMode(e.target.value as ColoringMode);
  };
  
  const handlePointSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPointSize(Number(e.target.value));
  };
  
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex flex-wrap gap-4">
        {/* Coloring Mode */}
        <div className="flex items-center space-x-2">
          <select
            value={visualizerOptions.coloringMode}
            onChange={handleColoringModeChange}
            className="bg-white border border-gray-300 text-gray-700 rounded-md py-2 pl-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="treatment">Color by Treatment</option>
            <option value="phenotype">Color by Broad Phenotypes</option>
          </select>
        </div>
        
        {/* Point Size */}
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-700">Point Size:</span>
          <input
            type="range"
            min="1"
            max="20"
            value={visualizerOptions.pointSize}
            onChange={handlePointSizeChange}
            className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-gray-700 w-6 text-center">{visualizerOptions.pointSize}</span>
        </div>
        
        {/* Color Picker Toggle */}
        <div className="relative">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex items-center space-x-1 bg-white border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Palette size={16} />
            <span>Background</span>
            <div 
              className="w-4 h-4 rounded-full ml-1" 
              style={{ backgroundColor: visualizerOptions.backgroundColor }}
            ></div>
          </button>
          
          {showColorPicker && (
            <div className="absolute right-0 mt-2 z-10 bg-white p-2 rounded-md shadow-lg">
              <HexColorPicker 
                color={visualizerOptions.backgroundColor} 
                onChange={setBackgroundColor} 
              />
              <div className="mt-2 flex justify-between">
                <input
                  type="text"
                  value={visualizerOptions.backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="flex-grow border border-gray-300 rounded-md px-2 py-1 text-sm mr-2"
                />
                <button 
                  onClick={() => setShowColorPicker(false)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="text-sm text-gray-500">
        {type === '2d' ? 'Click on any point to view sample details' : 'Adjust time slider below to explore temporal changes'}
      </div>
    </div>
  );
};

export default VisualizerControls;