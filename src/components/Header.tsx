import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Header: React.FC = () => {
  const location = useLocation();
  const isAbout = location.pathname === '/about';

  return (
    <header className="bg-black/90 backdrop-blur-md border-b border-white/[0.08] sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white text-black group-hover:bg-gray-200 transition-colors">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
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

          <nav className="flex items-center gap-1">
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
