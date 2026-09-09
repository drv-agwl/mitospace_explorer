import React from 'react';

/**
 * React mirror of the instant HTML app-shell in index.html. Shown after React
 * mounts but before the dataset is ready, so the transition from the pre-JS
 * shell to the live UI is seamless (no spinner void, no layout jump).
 */
const AppShellSkeleton: React.FC = () => {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black text-white" aria-hidden="true">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-white/[0.08] flex items-center px-6 gap-3">
        <span className="text-[13px] font-bold tracking-[0.2em] uppercase text-white/90">
          MitoSpace
        </span>
        <div className="h-3 w-32 rounded-md bg-white/[0.06] animate-pulse" />
      </div>

      {/* Toolbar */}
      <div className="h-[49px] shrink-0 border-b border-white/[0.08] flex items-center gap-2.5 px-6">
        <div className="h-8 w-24 rounded-lg bg-white/[0.06] animate-pulse" />
        <div className="h-8 w-28 rounded-lg bg-white/[0.06] animate-pulse" />
        <div className="h-8 w-20 rounded-lg bg-white/[0.06] animate-pulse" />
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        <div
          className="flex-1 min-w-0 flex items-center justify-center"
          style={{
            background:
              'linear-gradient(to bottom, #171717 0%, #1a1a1a 30%, #1a1a1a 70%, #1e1e1e 100%)',
          }}
        >
          <div className="w-9 h-9 rounded-full border-2 border-white/20 border-t-white/80 animate-spin motion-reduce:animate-none" />
        </div>
        <div className="w-[400px] shrink-0 border-l border-white/[0.08] p-6 flex flex-col gap-3.5">
          <div className="h-48 rounded-xl bg-white/[0.05] animate-pulse" />
          <div className="h-3 w-[70%] rounded-md bg-white/[0.06] animate-pulse" />
          <div className="h-3 w-[90%] rounded-md bg-white/[0.06] animate-pulse" />
          <div className="h-3 w-[55%] rounded-md bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    </div>
  );
};

export default AppShellSkeleton;
