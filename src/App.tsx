import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TabNavigation from './components/TabNavigation';
import Visualizer2D from './components/Visualizer2D';
import Visualizer4D from './components/Visualizer4D';
import Footer from './components/Footer';
import SamplePanel from './components/SamplePanel';
import About from './components/About';
import { SampleProvider } from './context/SampleContext';

function Explorer() {
  const [activeTab, setActiveTab] = useState<'2d' | '4d'>('2d');

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      
      <main className="flex-grow flex">
        <div className="flex-grow">
          <div className="container mx-auto px-4 py-6">
            <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
            
            <div className="mt-6">
              {activeTab === '2d' ? <Visualizer2D /> : <Visualizer4D />}
            </div>
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
    <Router>
      <SampleProvider>
        <Routes>
          <Route path="/" element={<Explorer />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </SampleProvider>
    </Router>
  );
}

export default App;