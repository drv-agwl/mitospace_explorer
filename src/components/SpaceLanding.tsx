import React from 'react';
import { Layers, Grid3X3 } from 'lucide-react';

interface SpaceLandingProps {
  onSelect: (space: '4d' | '2d') => void;
}

const SpaceLanding: React.FC<SpaceLandingProps> = ({ onSelect }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        <button
          type="button"
          onClick={() => onSelect('4d')}
          className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 bg-white p-12 shadow-sm hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100/50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <div className="rounded-xl bg-blue-100/80 p-6 mb-6 group-hover:bg-blue-200/80 transition-colors">
            <Layers className="w-16 h-16 text-blue-600" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">4D MitoSpace</h2>
          <p className="text-sm text-slate-500 text-center max-w-[240px]">
            Interactive 3D UMAP embedding with drug clusters, phenotype overlay, and semantic axis exploration.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onSelect('2d')}
          className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 bg-white p-12 shadow-sm hover:border-slate-400 hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 opacity-90"
        >
          <div className="rounded-xl bg-slate-100 p-6 mb-6 group-hover:bg-slate-200 transition-colors">
            <Grid3X3 className="w-16 h-16 text-slate-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">2D MitoSpace</h2>
          <p className="text-sm text-slate-500 text-center max-w-[240px]">
            Coming soon. 2D embedding view will be available here.
          </p>
        </button>
      </div>
    </div>
  );
};

export default SpaceLanding;
