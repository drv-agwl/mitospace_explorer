import React from 'react';

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
  return (
    <div
      className={`flex flex-col items-center justify-center bg-black text-white ${
        compact ? 'h-full min-h-[240px] gap-3' : 'h-screen gap-4'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase text-white/90">
          MitoSpace
        </p>
        {error ? (
          <>
            <p className="text-sm text-white/70 max-w-md">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 h-9 px-4 rounded-lg text-sm font-medium bg-white/[0.12] border border-white/[0.22] text-white hover:bg-white/[0.18] transition-colors"
              >
                Retry
              </button>
            )}
          </>
        ) : (
          <>
            <div
              className="mt-1 h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm text-white/55">Loading mitochondrial atlas…</p>
          </>
        )}
      </div>
    </div>
  );
};

export default DatasetLoadingShell;
