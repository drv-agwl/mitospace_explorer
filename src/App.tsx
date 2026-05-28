import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Header';
import Visualizer4D from './components/Visualizer4D';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import About from './components/About';
import GlobalKeyboardShortcuts from './components/GlobalKeyboardShortcuts';
import MobileBlocker from './components/MobileBlocker';
import { SampleProvider } from './context/SampleContext';
import { trackPageView } from './analytics';

// Chat is intentionally hidden from the UI for now — the LLM occasionally
// over-interpreted data and we don't want to ship conclusions we haven't
// vetted. Backend (`/api/chat`, agent, tools, tests) is fully preserved so
// re-enabling is a one-line revert below.
// import ChatPanel from './components/ChatPanel';

function Explorer() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black">
      <Header />
      <GlobalKeyboardShortcuts />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: visualizer (controls + canvas) - no scroll, controls always visible */}
          <section
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
            aria-label="Visualization"
          >
            <Visualizer4D />
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
    trackPageView(location.pathname);
  }, [location]);

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
