import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TabNavigation from './components/TabNavigation';
import Visualizer2D from './components/Visualizer2D';
import Visualizer4D from './components/Visualizer4D';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import About from './components/About';
import PasswordProtection from './components/PasswordProtection';
import SpaceLanding from './components/SpaceLanding';
import { SampleProvider } from './context/SampleContext';

function Explorer() {
  const [viewMode, setViewMode] = useState<'landing' | 'explorer'>('landing');
  const [activeTab, setActiveTab] = useState<'2d' | '4d'>('4d');

  const handleSelectSpace = (space: '4d' | '2d') => {
    setActiveTab(space);
    setViewMode('explorer');
  };

  if (viewMode === 'landing') {
    return (
      <div className="flex flex-col min-h-screen bg-black">
        <Header />
        <main className="flex-grow">
          <SpaceLanding onSelect={handleSelectSpace} />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-black">
      <Header />

      <main className="flex-grow flex min-h-0">
        <div className="flex-grow flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/50 backdrop-blur-sm">
            <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>

          <div className="flex-grow min-h-0">
            {activeTab === '2d' ? <Visualizer2D /> : <Visualizer4D />}
          </div>
        </div>

        <SamplePanel />
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
