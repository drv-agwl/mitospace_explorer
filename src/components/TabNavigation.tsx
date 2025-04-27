import React from 'react';
import { GridIcon, LayersIcon } from 'lucide-react';

interface TabNavigationProps {
  activeTab: '2d' | '4d';
  setActiveTab: (tab: '2d' | '4d') => void;
}

const TabNavigation: React.FC<TabNavigationProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div>
      <div className="flex space-x-8">
        <button
          onClick={() => setActiveTab('2d')}
          className={`py-3 px-4 font-medium text-sm flex items-center space-x-2 border-b-2 transition duration-200 ${
            activeTab === '2d'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <GridIcon size={18} />
          <span>2D MitoSpace</span>
        </button>
        
        <button
          onClick={() => setActiveTab('4d')}
          className={`py-3 px-4 font-medium text-sm flex items-center space-x-2 border-b-2 transition duration-200 ${
            activeTab === '4d'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <LayersIcon size={18} />
          <span>4D MitoSpace</span>
        </button>
      </div>
    </div>
  );
};

export default TabNavigation;
