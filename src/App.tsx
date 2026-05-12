import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Visualizer4D from './components/Visualizer4D';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import About from './components/About';
import PasswordProtection from './components/PasswordProtection';
import GlobalKeyboardShortcuts from './components/GlobalKeyboardShortcuts';
import MobileBlocker from './components/MobileBlocker';
import ChatPanel from './components/ChatPanel';
import { OnboardingTour, hasCompletedOnboarding, resetOnboarding } from './components/OnboardingTour';
import { SampleProvider } from './context/SampleContext';

function Explorer() {
  const [runTour, setRunTour] = useState(false);

  const handleStartTour = () => {
    resetOnboarding();
    setRunTour(true);
  };

  useEffect(() => {
    if (!hasCompletedOnboarding()) setRunTour(true);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black">
      <Header onStartTour={handleStartTour} showTourButton />
      <OnboardingTour run={runTour} variant="explorer" onComplete={() => setRunTour(false)} />
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
            data-tour="sample-panel"
          >
            <SamplePanel />
          </aside>
        </div>
      </main>

      <ChatPanel />

      <Footer />
    </div>
  );
}

function App() {
  return (
    <PasswordProtection>
      <MobileBlocker>
        <Router>
          <SampleProvider>
            <Routes>
              <Route path="/" element={<Explorer />} />
              <Route path="/about" element={<About />} />
            </Routes>
          </SampleProvider>
        </Router>
      </MobileBlocker>
    </PasswordProtection>
  );
}

export default App;
