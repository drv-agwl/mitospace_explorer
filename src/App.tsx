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
      <div className="flex flex-col min-h-screen bg-white">
        <Header />
        <main className="flex-grow">
          <SpaceLanding onSelect={handleSelectSpace} />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <Header />
      
      <main className="flex-grow flex h-full justify-start">
        <div className="flex-grow flex flex-col max-w-[calc(100%-500px)]">
          <div className="bg-white border-b border-gray-200">
            <div className="container mx-auto px-4 py-2 text-left">
              <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>
          </div>
          
          <div className="flex-grow h-full">
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