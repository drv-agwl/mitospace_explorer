import React from 'react';
import { Grid3X3, Layers } from 'lucide-react';

interface TabNavigationProps {
  activeTab: '2d' | '4d';
  setActiveTab: (tab: '2d' | '4d') => void;
}

const TabNavigation: React.FC<TabNavigationProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="inline-flex p-1 rounded-xl bg-white/5 border border-white/10">
      <button
        onClick={() => setActiveTab('4d')}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === '4d'
            ? 'bg-white text-black border border-white/20'
            : 'text-white/70 hover:text-white'
        }`}
      >
        <Layers size={18} strokeWidth={2} />
        <span>4D MitoSpace</span>
      </button>
      <button
        onClick={() => setActiveTab('2d')}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === '2d'
            ? 'bg-white text-black border border-white/20'
            : 'text-white/70 hover:text-white'
        }`}
      >
        <Grid3X3 size={18} strokeWidth={2} />
        <span>2D MitoSpace</span>
      </button>
    </div>
  );
};

export default TabNavigation;
