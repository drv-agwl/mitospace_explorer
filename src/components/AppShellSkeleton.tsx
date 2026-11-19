import React from 'react';
import MitoSpaceLogo from './MitoSpaceLogo';

const Bone: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`bg-white/[0.05] border border-white/[0.06] animate-pulse motion-reduce:animate-none ${className}`} />
);

/**
 * React mirror of the instant HTML app-shell in index.html (same sizes as the real header,
 * toolbar, movie strip, panel and footer). Shown after React mounts but before the dataset is
 * ready, so the hand-over from the pre-JS shell to the live UI doesn't move anything.
 */
const AppShellSkeleton: React.FC = () => {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black text-white" aria-hidden="true">
      {/* Header */}
      <div className="h-[69px] shrink-0 border-b border-white/[0.08] flex items-center gap-3 px-6">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white text-black">
          <MitoSpaceLogo size={20} variant="dark" />
        </div>
        <div>
          <p className="text-lg leading-7 font-semibold tracking-tight">MitoSpace Explorer</p>
          <p className="text-xs text-white/60 tracking-wide">Mitochondrial phenotype atlas</p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Toolbar */}
          <div className="h-[57px] shrink-0 border-b border-white/[0.08] flex items-center gap-2 px-6">
            <Bone className="h-9 w-[180px] rounded-lg" />
            <Bone className="h-9 w-[138px] rounded-lg" />
            <div className="flex-1" />
            <Bone className="h-9 w-[180px] rounded-lg" />
          </div>
          {/* Movie strip */}
          <div className="h-[212px] shrink-0 border-b border-white/[0.08] px-6 pt-3 overflow-hidden">
            <div className="h-8 flex items-center justify-between">
              <Bone className="h-3 w-[220px] rounded-md" />
              <Bone className="h-8 w-[180px] rounded-lg" />
            </div>
            <div className="mt-[9px] flex gap-2.5">
              {Array.from({ length: 16 }, (_, i) => (
                <Bone key={i} className="w-[112px] h-[143px] shrink-0 rounded-xl" />
              ))}
            </div>
          </div>
          {/* Canvas */}
          <div
            className="flex-1 min-h-0 flex items-center justify-center"
            style={{
              background:
                'linear-gradient(to bottom, #171717 0%, #1a1a1a 30%, #1a1a1a 70%, #1e1e1e 100%)',
            }}
          >
            <div className="w-9 h-9 rounded-full border-2 border-white/20 border-t-white/80 animate-spin motion-reduce:animate-none" />
          </div>
        </div>
        {/* Panel */}
        <div className="w-[340px] xl:w-[400px] shrink-0 border-l border-white/[0.08] px-6 pt-5 flex flex-col gap-3.5">
          <Bone className="h-[158px] rounded-xl" />
          <Bone className="mt-3 h-3 w-[110px] rounded-md" />
          <Bone className="aspect-square rounded-xl" />
        </div>
      </div>

      {/* Footer */}
      <div className="h-[45px] shrink-0 border-t border-white/[0.08]" />
    </div>
  );
};

export default AppShellSkeleton;
