import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import MitoSpaceLogo from './MitoSpaceLogo';
import TabNavigation from './TabNavigation';

interface HeaderProps {
  activeTab?: '2d' | '4d';
  setActiveTab?: (tab: '2d' | '4d') => void;
  onStartTour?: () => void;
  showTourButton?: boolean;
}

const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onStartTour, showTourButton }) => {
  const location = useLocation();
  const isAbout = location.pathname === '/about';
  const showTabs = activeTab != null && setActiveTab != null;

  return (
    <header className="bg-black/90 backdrop-blur-md border-b border-white/[0.08] sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-3 group shrink-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white text-black group-hover:bg-gray-100 transition-colors">
              <MitoSpaceLogo size={20} variant="dark" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white tracking-tight">
                MitoSpace Explorer
              </h1>
              <p className="text-xs text-white/45 hidden sm:block tracking-wide">
                Mitochondrial phenotype atlas
              </p>
            </div>
          </Link>

          {showTabs && (
            <div className="flex-1 flex justify-center min-w-0" data-tour="header-tabs">
              <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>
          )}

          <nav className="flex items-center gap-1 shrink-0">
            {showTourButton && onStartTour && (
              <button
                type="button"
                onClick={onStartTour}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
                aria-label="Take tour"
              >
                Take tour
              </button>
            )}
            <Link
              to="/about"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isAbout ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              About
            </Link>
            <a
              href="https://www.schoeneberglab.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Lab
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
