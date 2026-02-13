import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import MitoSpaceLogo from './MitoSpaceLogo';

const Footer: React.FC = () => {
  return (
    <footer className="bg-black border-t border-white/[0.08]">
      <div className="max-w-[1920px] mx-auto px-6 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-md bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/60">
              <MitoSpaceLogo size={12} variant="light" />
            </div>
            <span className="text-sm text-white/45">MitoSpace Explorer · Schöneberg Lab</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-white/45">
            <Link to="/about" className="hover:text-white/80 transition-colors">
              About
            </Link>
            <a
              href="https://www.schoeneberglab.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-white/80 transition-colors"
            >
              Contact
              <ExternalLink size={12} className="opacity-70" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
