import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * App-wide error boundary. Any uncaught render/runtime error in the tree is
 * caught here and shown as a branded recovery screen instead of a blank white
 * page — critical for a stress-tested production launch.
 */
class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface for debugging + any analytics/monitoring hooks.
    console.error('[RootErrorBoundary] Uncaught error:', error, info?.componentStack);
    try {
      // Umami (loaded in index.html) — best-effort custom event, non-blocking.
      (window as unknown as { umami?: { track?: (e: string, d?: unknown) => void } }).umami?.track?.(
        'app_error',
        { message: error?.message?.slice(0, 200) }
      );
    } catch {
      /* ignore */
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleHome = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-black text-white px-6 text-center gap-4">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase text-white/90">MitoSpace</p>
        <div className="flex flex-col items-center gap-2 max-w-md">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-white/60">
            The explorer hit an unexpected error. Reloading usually fixes it. If it keeps
            happening, please let us know.
          </p>
          {this.state.error?.message && (
            <p className="mt-1 text-xs font-mono text-white/35 break-words max-w-full">
              {this.state.error.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={this.handleReload}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/90 transition-colors"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.handleHome}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-white/[0.12] border border-white/[0.22] text-white hover:bg-white/[0.18] transition-colors"
          >
            Back to start
          </button>
        </div>
      </div>
    );
  }
}

export default RootErrorBoundary;
