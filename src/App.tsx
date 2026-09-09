import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import GlobalKeyboardShortcuts from './components/GlobalKeyboardShortcuts';
import MobileBlocker from './components/MobileBlocker';
import DatasetLoadingShell from './components/DatasetLoadingShell';
import AppShellSkeleton from './components/AppShellSkeleton';
import ExplorationWarmup from './components/ExplorationWarmup';
import RootErrorBoundary from './components/RootErrorBoundary';
import { SampleProvider, useSample } from './context/SampleContext';
import { trackPageView } from './analytics';
// Chat is intentionally hidden from the UI for now — the LLM occasionally
// over-interpreted data and we don't want to ship conclusions we haven't
// vetted. Backend (`/api/chat`, agent, tools, tests) is fully preserved so
// re-enabling is a one-line revert below.
// import ChatPanel from './components/ChatPanel';

const Visualizer4D = lazy(() => import('./components/Visualizer4D'));
const About = lazy(() => import('./components/About'));

function Explorer() {
  const { datasetLoading, datasetError, samples4D, retryDatasetLoad } = useSample();
  const waitingForData = datasetLoading || (samples4D.length === 0 && !datasetError);

  if (datasetError && samples4D.length === 0) {
    return <DatasetLoadingShell error={datasetError} onRetry={retryDatasetLoad} />;
  }

  if (waitingForData) {
    // Seamless continuation of the pre-JS HTML app-shell.
    return <AppShellSkeleton />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black">
      <Header />
      <GlobalKeyboardShortcuts />
      <ExplorationWarmup />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: visualizer (controls + canvas) - no scroll, controls always visible */}
          <section
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
            aria-label="Visualization"
          >
            <Suspense fallback={<DatasetLoadingShell compact />}>
              <Visualizer4D />
            </Suspense>
          </section>

          {/* Right: independently scrollable sample panel */}
          <aside
            className="w-[400px] min-w-[400px] min-h-0 flex flex-col shrink-0 overflow-hidden"
            aria-label="Sample details"
          >
            <SamplePanel />
          </aside>
        </div>
      </main>

      {/* <ChatPanel />  — temporarily hidden, see import comment above */}

      <Footer />
    </div>
  );
}

function RouteTracker() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);

  return null;
}

function App() {
  return (
    <RootErrorBoundary>
      <MobileBlocker>
        <Router>
          <RouteTracker />
          <SampleProvider>
            <Suspense fallback={<AppShellSkeleton />}>
              <Routes>
                <Route path="/" element={<Explorer />} />
                <Route path="/about" element={<About />} />
                {/* Unknown URLs (typos, stale links) → home instead of blank. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </SampleProvider>
        </Router>
      </MobileBlocker>
    </RootErrorBoundary>
  );
}

export default App;
