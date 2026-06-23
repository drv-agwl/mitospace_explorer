import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Header';
import Visualizer4D from './components/Visualizer4D';
import About from './components/About';
import GlobalKeyboardShortcuts from './components/GlobalKeyboardShortcuts';
import MobileBlocker from './components/MobileBlocker';
import { SampleProvider } from './context/SampleContext';
import { AgentProvider } from './context/AgentContext';
import RightDock from './components/RightDock';
import Toaster from './components/Toaster';
import { trackPageView } from './analytics';

/**
 * Explorer shell: a single full-bleed workspace.
 *   [ TopBar                                   ]
 *   [ Atlas (3D, hero)        | Right dock      ]
 *
 * The dock is a resizable/collapsible rail with two tabs (Ask / Cell). The
 * agent lives there with its input anchored to the column bottom, so it never
 * overlaps the canvas — replacing the old floating bar + standalone panel.
 */
function Explorer() {
  return (
    <AgentProvider>
      <div className="h-screen flex flex-col overflow-hidden bg-black">
        <Header />
        <GlobalKeyboardShortcuts />

        <main className="flex-1 flex min-h-0 overflow-hidden">
          <section
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
            aria-label="Visualization"
          >
            <Visualizer4D />
          </section>

          <RightDock />
        </main>
        <Toaster />
      </div>
    </AgentProvider>
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
    <MobileBlocker>
      <Router>
        <RouteTracker />
        <SampleProvider>
          <Routes>
            <Route path="/" element={<Explorer />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </SampleProvider>
      </Router>
    </MobileBlocker>
  );
}

export default App;
