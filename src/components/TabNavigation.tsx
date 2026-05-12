import React from 'react';
import { Grid3X3, Layers } from 'lucide-react';

interface TabNavigationProps {
  activeTab: '2d' | '4d';
  setActiveTab: (tab: '2d' | '4d') => void;
}

const TabNavigation: React.FC<TabNavigationProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]">
      <button
        onClick={() => setActiveTab('4d')}
        className={`flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === '4d'
            ? 'bg-white text-black shadow-sm'
            : 'text-white/60 hover:text-white/90 hover:bg-white/[0.06]'
        }`}
      >
        <Layers size={17} strokeWidth={2} />
        <span>MitoSpace</span>
      </button>
      <button
        onClick={() => setActiveTab('2d')}
        className={`flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          activeTab === '2d'
            ? 'bg-white text-black shadow-sm'
            : 'text-white/60 hover:text-white/90 hover:bg-white/[0.06]'
        }`}
      >
        <Grid3X3 size={17} strokeWidth={2} />
        <span>2D MitoSpace</span>
      </button>
    </div>
  );
};

export default TabNavigation;
