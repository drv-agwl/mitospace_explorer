import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Share2, Check } from 'lucide-react';
import MitoSpaceLogo from './MitoSpaceLogo';
import { useSample } from '../context/SampleContext';
import { emitCommand, emitToast } from '../lib/uiCommands';
import { buildShareUrl } from '../lib/shareView';

const Header: React.FC = () => {
  const location = useLocation();
  const isAbout = location.pathname === '/about';
  const {
    samples4D,
    availableDrugs,
    semanticState,
    visualizerOptions,
    selectedDrugs,
    selectedSample,
    comparisonCells,
  } = useSample();
  const showAtlasMeta = !isAbout && samples4D.length > 0;
  const [shared, setShared] = useState(false);

  const onShare = async () => {
    const featureColoring = semanticState.advancedMode && !!semanticState.selectedFeature;
    const url = buildShareUrl({
      feature: featureColoring ? semanticState.selectedFeature : null,
      mode: !featureColoring && visualizerOptions.coloringMode === 'phenotype' ? 'phenotype' : null,
      drugs: Array.from(selectedDrugs),
      sel: selectedSample?.id ?? null,
      cmp: comparisonCells.map((c) => c.sample.id),
    });
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1600);
      emitToast({ text: 'View link copied to clipboard', kind: 'generic' });
    } catch {
      // Fallback: reflect state in the address bar so it can be copied manually.
      window.history.replaceState(null, '', url);
      emitToast({ text: 'View link set in address bar', kind: 'generic' });
    }
  };

  return (
    <header className="bg-black/90 backdrop-blur-md border-b border-white/[0.08] sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
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

            {showAtlasMeta && (
              <div className="hidden md:flex items-center gap-2 pl-3 ml-1 border-l border-white/[0.1]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/60">
                  <span className="font-mono tabular-nums text-white/85">
                    {samples4D.length.toLocaleString()}
                  </span>
                  cells
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/60">
                  <span className="font-mono tabular-nums text-white/85">{availableDrugs.length}</span>
                  conditions
                </span>
              </div>
            )}
          </div>

          <nav className="flex items-center gap-2 shrink-0">
            {!isAbout && (
              <>
                <button
                  onClick={() => emitCommand('focus-ask')}
                  className="group inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] pl-3 pr-2 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
                  title="Ask the atlas (⌘K)"
                >
                  <Sparkles size={14} className="text-cyan-300/80" />
                  Ask
                  <kbd className="ml-0.5 hidden sm:inline-flex items-center gap-0.5 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
                    ⌘K
                  </kbd>
                </button>
                <button
                  onClick={onShare}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
                  title="Copy a link to this exact view"
                >
                  {shared ? <Check size={14} className="text-emerald-400" /> : <Share2 size={14} />}
                  <span className="hidden sm:inline">{shared ? 'Copied' : 'Share'}</span>
                </button>
              </>
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
