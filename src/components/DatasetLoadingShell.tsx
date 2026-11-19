import React from 'react';
import { BrandMark } from './MitoSpaceLogo';

interface DatasetLoadingShellProps {
  error?: string | null;
  onRetry?: () => void;
  /** Compact variant for Suspense / nested fallbacks */
  compact?: boolean;
}

/**
 * Loading / error shell. The instant HTML app-shell in index.html covers the
 * very first paint, so this is a brief fallback (and the error surface).
 */
const DatasetLoadingShell: React.FC<DatasetLoadingShellProps> = ({
  error,
  onRetry,
  compact = false,
}) => {
  if (compact && !error) {
    return (
      <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-3 bg-black" role="status">
        <div
          className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="text-sm text-white/60">Loading the 3D map…</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center bg-black text-white px-6 text-center ${
        compact ? 'h-full min-h-[240px] gap-4' : 'h-screen gap-6'
      }`}
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <BrandMark />
      {error ? (
        <div className="flex flex-col items-center gap-2 max-w-md">
          <p className="text-lg font-semibold">The atlas didn&apos;t load</p>
          <p className="text-sm text-white/65">Check your connection and try again.</p>
          <p className="text-xs font-mono text-white/45 break-words max-w-full">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 h-10 px-5 rounded-lg text-sm font-semibold bg-white text-black hover:bg-white/90 transition-colors"
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="text-sm text-white/60">Loading the mitochondrial atlas…</p>
        </div>
      )}
    </div>
  );
};

export default DatasetLoadingShell;
