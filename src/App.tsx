import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState } from 'react';
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
import { loadPosterManifest } from './utils/posterManifest';
import { trackPageView } from './analytics';
// Chat is intentionally hidden from the UI for now — the LLM occasionally
// over-interpreted data and we don't want to ship conclusions we haven't
// vetted. Backend (`/api/chat`, agent, tools, tests) is fully preserved so
// re-enabling is a one-line revert below.
// import ChatPanel from './components/ChatPanel';

const Visualizer4D = lazy(() => import('./components/Visualizer4D'));
const About = lazy(() => import('./components/About'));

function Explorer() {
  const { datasetLoading, datasetError, samples4D, retryDatasetLoad, requestDataset } = useSample();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const waitingForData = datasetLoading || (samples4D.length === 0 && !datasetError);

  useEffect(() => {
    requestDataset();
    // Poster/clip manifest is tiny; have it ready before the strip renders.
    void loadPosterManifest();
  }, [requestDataset]);

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
        <div data-fullscreen-root className="flex-1 flex min-h-0 overflow-hidden bg-black">
          {/* Left: visualizer (controls + canvas) - no scroll, controls always visible */}
          <section
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
            aria-label="Visualization"
          >
            <Suspense fallback={<DatasetLoadingShell compact />}>
              <Visualizer4D />
            </Suspense>
          </section>

          {/* Right: independently scrollable sample panel (collapsible to a thin rail) */}
          <aside
            className={`${
              panelCollapsed
                ? 'w-12 min-w-[48px]'
                : 'w-[340px] min-w-[340px] xl:w-[400px] xl:min-w-[400px]'
            } min-h-0 flex flex-col shrink-0 overflow-hidden`}
            aria-label="Cell details"
          >
            <SamplePanel
              collapsed={panelCollapsed}
              onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
            />
          </aside>
        </div>
      </main>

      {/* <ChatPanel />  — temporarily hidden, see import comment above */}

      <Footer />
    </div>
  );
}

/** Suspense fallback: the explorer skeleton on the home route, the page chrome elsewhere. */
function RouteFallback() {
  const { pathname } = useLocation();
  if (pathname === '/') return <AppShellSkeleton />;
  return (
    <div className="min-h-screen bg-black">
      <Header />
    </div>
  );
}

function RouteTracker() {
  const location = useLocation();

  useEffect(() => {
    const about = location.pathname === '/about';
    const title = about ? 'About · MitoSpace Explorer' : 'MitoSpace Explorer';
    const url = `https://mitospace.ai${about ? '/about' : '/'}`;
    document.title = title;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', url);
    // Path only: the query string holds view state (cell, feature), which is not a new page.
    trackPageView(location.pathname, title);
  }, [location.pathname]);

  return null;
}

function App() {
  return (
    <RootErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <RouteTracker />
        <SampleProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Only the 3D explorer needs a wide window; About works on phones. */}
              <Route
                path="/"
                element={
                  <MobileBlocker>
                    <Explorer />
                  </MobileBlocker>
                }
              />
              <Route path="/about" element={<About />} />
              {/* Unknown URLs (typos, stale links) → home instead of blank. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </SampleProvider>
      </Router>
    </RootErrorBoundary>
  );
}

export default App;
