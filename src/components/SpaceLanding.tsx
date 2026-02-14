import React from 'react';
import { Layers, Grid3X3, ArrowRight } from 'lucide-react';

interface SpaceLandingProps {
  onSelect: (space: '4d' | '2d') => void;
}

const SpaceLanding: React.FC<SpaceLandingProps> = ({ onSelect }) => {
  return (
    <div className="min-h-[calc(100vh-180px)] flex flex-col items-center justify-center px-6 py-16">
      <div className="text-center max-w-2xl mx-auto mb-16" data-tour="landing-title">
        <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-4">
          Choose your exploration space
        </h2>
        <p className="text-white/60 text-lg">
          Select a space to visualize mitochondrial phenotypes from LLSM or confocal microscopy data.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
        <button
          type="button"
          onClick={() => onSelect('4d')}
          data-tour="card-4d"
          className="group relative flex flex-col items-start p-8 rounded-2xl bg-white/[0.04] border border-white/[0.08]
                     hover:bg-white/[0.06] hover:border-white/[0.12]
                     transition-all duration-300 text-left focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-black"
        >
          <div className="flex items-center justify-between w-full mb-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-white/10 text-white group-hover:bg-white/20 transition-colors">
              <Layers className="w-7 h-7" strokeWidth={2} />
            </div>
            <ArrowRight className="w-5 h-5 text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">4D MitoSpace</h3>
          <p className="text-white/60 text-sm leading-relaxed flex-1">
            AI applied to 4D cell movies from high-resolution LLSM data. Explore drug clusters, phenotypic overlays, and semantic axis navigation.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white/10 text-white/80">
              LLSM
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white/10 text-white/80">
              4D AI
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSelect('2d')}
          data-tour="card-2d"
          className="group relative flex flex-col items-start p-8 rounded-2xl bg-white/[0.04] border border-white/[0.08]
                     hover:bg-white/[0.06] hover:border-white/[0.12]
                     transition-all duration-300 text-left focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-black
                     opacity-90 hover:opacity-100"
        >
          <div className="flex items-center justify-between w-full mb-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-white/10 text-white/80 group-hover:bg-white/20 transition-colors">
              <Grid3X3 className="w-7 h-7" strokeWidth={2} />
            </div>
            <ArrowRight className="w-5 h-5 text-white/40 group-hover:text-white/60 group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">2D MitoSpace</h3>
          <p className="text-white/60 text-sm leading-relaxed flex-1">
            AI applied to 2D cells from confocal microscopy. Semantic axis coming soon.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white/10 text-white/80">
              Confocal
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white/10 text-white/80">
              2D AI
            </span>
          </div>
        </button>
      </div>
    </div>
  );
};

export default SpaceLanding;
