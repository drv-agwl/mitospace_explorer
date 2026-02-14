import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Visualizer2D from './components/Visualizer2D';
import Visualizer4D from './components/Visualizer4D';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import About from './components/About';
import PasswordProtection from './components/PasswordProtection';
import SpaceLanding from './components/SpaceLanding';
import GlobalKeyboardShortcuts from './components/GlobalKeyboardShortcuts';
import { OnboardingTour, hasCompletedOnboarding, resetOnboarding } from './components/OnboardingTour';
import { SampleProvider } from './context/SampleContext';

function Explorer() {
  const [viewMode, setViewMode] = useState<'landing' | 'explorer'>('landing');
  const [activeTab, setActiveTab] = useState<'2d' | '4d'>('4d');
  const [runTour, setRunTour] = useState(false);

  const handleSelectSpace = (space: '4d' | '2d') => {
    setActiveTab(space);
    setViewMode('explorer');
  };

  const handleStartTour = () => {
    resetOnboarding();
    setRunTour(true);
  };

  useEffect(() => {
    if (!hasCompletedOnboarding()) setRunTour(true);
  }, [viewMode]);

  if (viewMode === 'landing') {
    return (
      <div className="flex flex-col min-h-screen bg-black">
        <Header onStartTour={handleStartTour} showTourButton />
        <OnboardingTour run={runTour} variant="landing" onComplete={() => setRunTour(false)} />
        <main className="flex-grow">
          <SpaceLanding onSelect={handleSelectSpace} />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} onStartTour={handleStartTour} showTourButton />
      <OnboardingTour run={runTour} variant="explorer" onComplete={() => setRunTour(false)} />
      <GlobalKeyboardShortcuts />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: visualizer (controls + canvas) - no scroll, controls always visible */}
          <section
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
            aria-label="Visualization"
          >
            {activeTab === '2d' ? <Visualizer2D /> : <Visualizer4D />}
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

      <Footer />
    </div>
  );
}

function App() {
  return (
    <PasswordProtection>
      <Router>
        <SampleProvider>
          <Routes>
            <Route path="/" element={<Explorer />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </SampleProvider>
      </Router>
    </PasswordProtection>
  );
}

export default App;
