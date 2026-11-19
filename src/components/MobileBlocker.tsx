import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronRight, Expand, Link2, Share } from 'lucide-react';
import Header from './Header';
import Footer from './Footer';
import ExplorerPreview from './ExplorerPreview';
import MitoSpaceLogo from './MitoSpaceLogo';
import { GitHubIcon, HuggingFaceIcon, PaperIcon, RESEARCH_LINKS } from './ResearchLinks';
import { trackEvent } from '../analytics';

/** Minimum CSS pixel width for the full explorer layout (toolbar + 3D pane). */
const MIN_VIEWPORT_WIDTH_PX = 1024;

const isTooNarrow = () => typeof window !== 'undefined' && window.innerWidth < MIN_VIEWPORT_WIDTH_PX;

/** Why the explorer can't open here: a narrow desktop window, a tablet held upright, or a phone. */
type NarrowReason = 'window' | 'rotate' | 'device';

function narrowReason(): NarrowReason {
  if (window.matchMedia?.('(pointer: fine)').matches) return 'window';
  const longSide = Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return longSide >= MIN_VIEWPORT_WIDTH_PX ? 'rotate' : 'device';
}

const PITCH =
  'MitoSpace Explorer is a browser-based atlas of mitochondrial phenotypes under drug perturbation, built from high-resolution 4D lattice light-sheet microscopy data.';

const MESSAGE: Record<NarrowReason, { title: string; body: string }> = {
  device: {
    title: 'The explorer needs a bigger screen',
    body: `${PITCH} It needs a screen at least 1,024 px wide, so open it on a laptop or desktop.`,
  },
  rotate: {
    title: 'Turn your tablet sideways',
    body: `${PITCH} It needs a screen at least 1,024 px wide, which your tablet has in landscape.`,
  },
  window: {
    title: 'Make this window a little wider',
    body: `${PITCH} It needs at least 1,024 px of width, and opens on its own as soon as there is room.`,
  },
};

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-gray-100 transition-colors';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-medium border border-white/[0.14] bg-white/[0.06] text-white hover:bg-white/[0.1] transition-colors';

/** Native share sheet where available (phones), otherwise copies the link. */
const ShareLinkButton: React.FC<{ className: string }> = ({ className }) => {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const onClick = async () => {
    const url = window.location.href;
    try {
      if (canShare) {
        await navigator.share({ title: 'MitoSpace Explorer', text: 'Interactive atlas of mitochondrial phenotypes', url });
        trackEvent('share_link', { via: 'share_sheet' });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackEvent('share_link', { via: 'copy' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed or clipboard unavailable.
    }
  };
  return (
    <button type="button" onClick={onClick} className={className}>
      {copied ? <Check size={16} /> : canShare ? <Share size={16} /> : <Link2 size={16} />}
      {copied ? 'Link copied' : canShare ? 'Send the link to yourself' : 'Copy the link'}
    </button>
  );
};

/** Full screen only helps when the display itself is wide enough for the explorer. */
const canGoFullScreen = () =>
  typeof document !== 'undefined' &&
  document.fullscreenEnabled &&
  (window.screen?.width ?? 0) >= MIN_VIEWPORT_WIDTH_PX;

/** Full screen widens a narrow desktop window to the whole display, which opens the explorer. */
const FullScreenButton: React.FC = () => {
  return (
    <button
      type="button"
      onClick={() => {
        trackEvent('narrow_fullscreen');
        document.documentElement.requestFullscreen().catch(() => {});
      }}
      className={PRIMARY_BUTTON}
    >
      <Expand size={16} />
      Go full screen
    </button>
  );
};

const MORE_LINKS = [
  { ...RESEARCH_LINKS.paper, Icon: PaperIcon },
  { ...RESEARCH_LINKS.github, Icon: GitHubIcon },
  { ...RESEARCH_LINKS.huggingface, Icon: HuggingFaceIcon },
] as const;

/** What a phone, tablet or narrow window shows instead of the 3D explorer. */
const NarrowScreenLanding: React.FC = () => {
  const [reason] = useState(narrowReason);
  const { title, body } = MESSAGE[reason];
  const cta =
    reason === 'device' ? (
      <ShareLinkButton className={PRIMARY_BUTTON} />
    ) : reason === 'rotate' ? (
      <ShareLinkButton className={SECONDARY_BUTTON} />
    ) : canGoFullScreen() ? (
      <FullScreenButton />
    ) : null;

  useEffect(() => {
    trackEvent('narrow_screen', { reason });
  }, [reason]);

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-grow px-6 pt-10 pb-16 sm:pt-16">
        <div className="mx-auto w-full max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-3 py-1 text-xs text-white/70">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Your window got a little… punctate :(
          </p>
          <h2 className="mt-4 text-[30px] sm:text-4xl font-semibold tracking-tight leading-[1.12]">{title}</h2>
          <p className="mt-4 text-base text-white/70 leading-relaxed">{body}</p>

          {cta && <div className="mt-7 flex flex-wrap gap-3">{cta}</div>}

          <ExplorerPreview priority className="mt-10" />

          <section className="mt-12" aria-labelledby="narrow-more">
            <h3 id="narrow-more" className="text-sm font-semibold text-white">
              In the meantime
            </h3>
            <p className="mt-1 text-sm text-white/60">These all work on this screen.</p>
            <nav
              className="mt-4 overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.03] divide-y divide-white/[0.08]"
              aria-label="Learn more"
            >
              <Link to="/about" className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-colors">
                <span className="flex items-center justify-center w-6 h-6 rounded-md bg-white text-black shrink-0">
                  <MitoSpaceLogo size={14} variant="dark" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-white">About MitoSpace</span>
                  <span className="block text-xs text-white/55">How the atlas was made, and the team behind it</span>
                </span>
                <ChevronRight size={16} className="text-white/40 shrink-0" />
              </Link>
              {MORE_LINKS.map(({ href, label, hint, description, Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-colors"
                >
                  <span className="flex items-center justify-center w-6 h-6 text-white/85 shrink-0">
                    <Icon size={18} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-white">
                      {label} <span className="font-normal text-white/50">· {hint}</span>
                    </span>
                    <span className="block text-xs text-white/55">{description}</span>
                  </span>
                  <ArrowUpRight size={16} className="text-white/40 shrink-0" />
                </a>
              ))}
            </nav>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
};

const MobileBlocker: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Read the width before the first render so a narrow window never mounts the explorer (or its download).
  const [viewportTooNarrow, setViewportTooNarrow] = useState(isTooNarrow);

  useEffect(() => {
    const check = () => setViewportTooNarrow(isTooNarrow());
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!viewportTooNarrow) {
    return <>{children}</>;
  }

  return <NarrowScreenLanding />;
};

export default MobileBlocker;
