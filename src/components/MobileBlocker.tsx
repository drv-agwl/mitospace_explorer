import React, { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import MitoSpaceLogo from './MitoSpaceLogo';

/** Minimum CSS pixel width for the full explorer layout (toolbar + 3D pane). */
const MIN_VIEWPORT_WIDTH_PX = 1024;

/** Squished mito in a mail slot, purely decorative. */
function NarrowViewportMascot({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Side rails = narrow browser */}
      <rect x="12" y="8" width="10" height="114" rx="3" className="fill-white/15" />
      <rect x="198" y="8" width="10" height="114" rx="3" className="fill-white/15" />
      {/* “Cristae” squiggle squeezed in the middle */}
      <ellipse
        cx="110"
        cy="65"
        rx="72"
        ry="28"
        fill="none"
        className="stroke-sky-400/90"
        strokeWidth="2.5"
      />
      <path
        d="M52 65c18-12 36-12 58 0s40 12 58 0"
        fill="none"
        className="stroke-sky-300/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M60 72c14 10 30 10 50 0s36-10 50 0"
        fill="none"
        className="stroke-cyan-500/50"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Dramatic sweat dot */}
      <circle cx="154" cy="38" r="4" className="fill-amber-300/90" />
    </svg>
  );
}

const MobileBlocker: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [viewportTooNarrow, setViewportTooNarrow] = useState(false);

  useEffect(() => {
    const check = () => {
      setViewportTooNarrow(window.innerWidth < MIN_VIEWPORT_WIDTH_PX);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!viewportTooNarrow) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center p-6 overflow-hidden">
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500 rounded-full filter blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full filter blur-3xl animate-pulse"
          style={{ animationDelay: '1s' }}
        />
      </div>

      <div className="relative max-w-md w-full">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 flex items-center justify-center shadow-2xl">
            <MitoSpaceLogo variant="dark" className="w-14 h-14" />
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-[200px] h-[100px] mb-4">
              <NarrowViewportMascot className="w-[200px] h-[100px] text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 leading-snug">
              Your window got a little..... Mitochondrial
            </h1>
            <p className="text-white/65 text-sm leading-relaxed">
              This is not a “no phones” rule. The 3D explorer and side panels need real horizontal
              space. If the browser is narrower than{' '}
              <span className="text-white/90 font-medium tabular-nums">{MIN_VIEWPORT_WIDTH_PX}px</span>,
              we bail before the UI stages a protest.
            </p>
          </div>

          <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-blue-400" strokeWidth={2} aria-hidden />
                </div>
              </div>
              <div>
                <h2 className="text-white font-semibold mb-1">What to do</h2>
                <p className="text-white/55 text-sm leading-relaxed">
                  Widen the window, pop out full screen, or switch to a display that’s at least{' '}
                  {MIN_VIEWPORT_WIDTH_PX}px across. Come back when you’ve got room. We’ll load the same
                  page.
                </p>
              </div>
            </div>
          </div>

          <ul className="space-y-2 text-xs text-white/45 text-left list-none pl-0">
            <li className="flex gap-2">
              <span className="text-sky-400/80 shrink-0" aria-hidden>
                →
              </span>
              <span>3D + side panels refuse the “postage stamp” lifestyle.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-sky-400/80 shrink-0" aria-hidden>
                →
              </span>
              <span>Your thumb is talented; our sliders are needy.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-sky-400/80 shrink-0" aria-hidden>
                →
              </span>
              <span>Bookmark this tab. Widening counts as self care.</span>
            </li>
          </ul>
        </div>

        <p className="text-center mt-8 text-white/35 text-xs">
          Tip: if you’re on a tablet, landscape often clears the bar without summoning IT.
        </p>
      </div>
    </div>
  );
};

export default MobileBlocker;
