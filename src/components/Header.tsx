import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import MitoSpaceLogo from './MitoSpaceLogo';
import { HeaderResearchNav } from './ResearchLinks';

const Header: React.FC = () => {
  const location = useLocation();
  const isAbout = location.pathname === '/about';
  // The About page has its own top-level heading; one h1 per page.
  const Brand = isAbout ? 'p' : 'h1';

  return (
    <header className="bg-black/90 backdrop-blur-md border-b border-white/[0.08] sticky top-0 z-50">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-3 group shrink-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white text-black group-hover:bg-gray-100 transition-colors">
              <MitoSpaceLogo size={20} variant="dark" />
            </div>
            <div>
              <Brand className="text-lg font-semibold text-white tracking-tight">
                MitoSpace Explorer
              </Brand>
              <p className="text-xs text-white/60 hidden sm:block tracking-wide">
                Mitochondrial phenotype atlas
              </p>
            </div>
          </Link>

          <nav className="flex items-center gap-1 shrink-0">
            <Link
              to="/about"
              className={`inline-flex items-center h-11 px-4 rounded-xl text-sm font-medium transition-colors ${
                isAbout ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              About
            </Link>
            <a
              href="https://www.schoeneberglab.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1 h-11 px-4 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Lab
              <ExternalLink size={12} className="opacity-70" aria-hidden />
            </a>
            <HeaderResearchNav />
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
