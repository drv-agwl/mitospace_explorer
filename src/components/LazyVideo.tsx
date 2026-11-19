/**
 * Poster-first video facade.
 *
 * Renders a static poster image immediately (so grids look complete instantly),
 * mounts the <video> only when visible, caps concurrent decodes, keeps all
 * looping clips phase-aligned to a shared clock, and fades the video in over
 * the poster once it can play. If the video never loads, the poster stays — the
 * UI never shows an empty/janky cell.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Desktop-only app; clips are 512² @ ~10fps shown at ~112px, so a generous cap
// keeps every visible strip card animating (no frozen/flickering cards) while
// still protecting against decoding the entire 36k dataset at once.
const DEFAULT_MAX_CONCURRENT = 16;

/** Shared registry so multiple strips don't blow past the decode budget. */
const playingVideos = new Set<HTMLVideoElement>();

function tryAcquire(el: HTMLVideoElement, max: number): boolean {
  if (playingVideos.has(el)) return true;
  if (playingVideos.size >= max) return false;
  playingVideos.add(el);
  return true;
}

function release(el: HTMLVideoElement) {
  playingVideos.delete(el);
}

/**
 * Shared clock so clips that start at different times (staggered network loads,
 * scroll-in) still loop in phase. Each clip jumps to the current position in the
 * shared cycle when it starts, so equal-length loops appear synchronized.
 * The epoch is set when the first batch starts (see `startTogether`).
 */
let syncEpoch = 0;
function alignToSyncClock(el: HTMLVideoElement) {
  const d = el.duration;
  if (!syncEpoch || !d || !isFinite(d) || d <= 0) return;
  const phase = ((performance.now() - syncEpoch) / 1000) % d;
  // Only nudge when noticeably off, to avoid reseek jitter.
  if (Math.abs(el.currentTime - phase) > 0.08) {
    try {
      el.currentTime = phase;
    } catch {
      /* ignore seek race */
    }
  }
}

// The first visible clips start together from frame 0, so their frame-0 posters hand over
// without a jump. They start once all of them can play (at most START_GATE_MAX_MS after the
// first is ready); clips that arrive later join the shared clock mid-loop.
const START_GATE_MAX_MS = 900;
const gateQueue = new Map<HTMLVideoElement, () => void>();
const bufferingClips = new Set<HTMLVideoElement>();
let gateTimer: number | null = null;

function openGate() {
  if (syncEpoch) return;
  if (gateTimer != null) window.clearTimeout(gateTimer);
  gateTimer = null;
  syncEpoch = performance.now();
  const starts = Array.from(gateQueue.values());
  gateQueue.clear();
  bufferingClips.clear();
  starts.forEach((fn) => fn());
}

function startTogether(el: HTMLVideoElement, start: () => void) {
  if (syncEpoch) {
    start();
    return;
  }
  bufferingClips.delete(el);
  gateQueue.set(el, start);
  if (bufferingClips.size === 0) openGate();
  else if (gateTimer == null) gateTimer = window.setTimeout(openGate, START_GATE_MAX_MS);
}

function markBuffering(el: HTMLVideoElement) {
  if (!syncEpoch) bufferingClips.add(el);
}

function leaveGate(el: HTMLVideoElement) {
  gateQueue.delete(el);
  bufferingClips.delete(el);
  if (!syncEpoch && gateQueue.size > 0 && bufferingClips.size === 0) openGate();
}

export interface LazyVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  /** Media URL — attached only when the element intersects the viewport. */
  src: string;
  /** Static poster shown instantly behind the video. */
  poster?: string;
  /** When false, visible videos stay paused. */
  shouldPlay?: boolean;
  /** Max concurrently decoding videos across all LazyVideo instances. */
  maxConcurrent?: number;
  /** Clear src when scrolled away to free network/decoder slots. */
  unloadWhenHidden?: boolean;
  /** Hint the poster as high priority (above-the-fold strip). */
  posterPriority?: boolean;
  /** Scroll container to measure visibility against (default: the viewport). */
  rootRef?: React.RefObject<Element>;
  /** Margin around the root within which clips already load and play. */
  rootMargin?: string;
  /** Alt text for the poster image. */
  alt?: string;
}

const LazyVideo = React.forwardRef<HTMLVideoElement, LazyVideoProps>(function LazyVideo(
  {
    src,
    poster,
    shouldPlay = true,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    unloadWhenHidden = true,
    posterPriority = false,
    rootRef,
    rootMargin = '150px',
    alt = '',
    className,
    muted = true,
    loop = true,
    playsInline = true,
    onPlay,
    onPause,
    onEnded,
    onLoadedData,
    ...rest
  },
  forwardedRef
) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | undefined>(undefined);
  const [videoReady, setVideoReady] = useState(false);
  // First frame decoded: without a poster the video fades in from here instead of popping.
  const [hasFrame, setHasFrame] = useState(false);
  // Enough data buffered to start without stalling.
  const canPlayRef = useRef(false);
  const visibleRef = useRef(false);
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  const setRefs = (el: HTMLVideoElement | null) => {
    localRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  /** Reconcile playback with current visibility / shouldPlay / src state. */
  const sync = useCallback(() => {
    const el = localRef.current;
    if (!el) return;
    const hasSrc = !!el.getAttribute('src');
    const wantPlay = visibleRef.current && shouldPlayRef.current && hasSrc;

    if (!wantPlay) {
      leaveGate(el);
      el.pause();
      release(el);
      return;
    }
    // onCanPlay calls sync again once the clip can start smoothly.
    if (!canPlayRef.current) {
      markBuffering(el);
      return;
    }
    startTogether(el, () => {
      if (!el.isConnected || !visibleRef.current || !shouldPlayRef.current) return;
      if (!tryAcquire(el, maxConcurrent)) {
        el.pause();
        return;
      }
      // Align only before starting: re-seeking a playing clip shows as a jump.
      alignToSyncClock(el);
      el.play().catch(() => release(el));
    });
  }, [maxConcurrent]);

  // Attach src on intersection; (re)start or pause playback on visibility change.
  useEffect(() => {
    const el = localRef.current;
    canPlayRef.current = false;
    if (!el || typeof IntersectionObserver === 'undefined') {
      visibleRef.current = true;
      setActiveSrc(src);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visibleRef.current = e.isIntersecting;
          if (e.isIntersecting) {
            setActiveSrc(src);
            // src may already be attached (unloadWhenHidden=false) — re-sync so
            // scrolling a card out and back resumes playback in phase.
            sync();
          } else if (unloadWhenHidden) {
            el.pause();
            release(el);
            leaveGate(el);
            canPlayRef.current = false;
            setActiveSrc(undefined);
            setVideoReady(false);
            setHasFrame(false);
            el.removeAttribute('src');
            el.load();
          } else {
            el.pause();
            release(el);
            leaveGate(el);
          }
        }
      },
      { root: rootRef?.current ?? null, threshold: 0.1, rootMargin }
    );

    obs.observe(el);
    return () => {
      obs.disconnect();
      leaveGate(el);
      release(el);
    };
  }, [src, unloadWhenHidden, sync, rootRef, rootMargin]);

  // React to play/pause intent and src attachment.
  useEffect(() => {
    sync();
  }, [activeSrc, shouldPlay, sync]);

  useEffect(() => {
    return () => {
      const el = localRef.current;
      if (el) release(el);
    };
  }, []);

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      {poster && (
        <img
          src={poster}
          alt={alt}
          decoding="async"
          {...(posterPriority ? { fetchpriority: 'high' as const } : { loading: 'lazy' as const })}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            videoReady ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
      <video
        ref={setRefs}
        src={activeSrc}
        muted={muted}
        loop={loop}
        playsInline={playsInline}
        // src is only attached when visible, so buffer right away for a quick, smooth start.
        preload={activeSrc ? 'auto' : 'none'}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          videoReady || (!poster && hasFrame) ? 'opacity-100' : 'opacity-0'
        }`}
        onLoadedData={(e) => {
          setHasFrame(true);
          onLoadedData?.(e);
        }}
        onLoadedMetadata={() => alignToSyncClock(localRef.current!)}
        onCanPlay={() => {
          canPlayRef.current = true;
          sync();
        }}
        onPlaying={() => {
          // Fade in only once frames are moving; until then the frame-0 poster stays.
          setVideoReady(true);
        }}
        onPlay={(e) => {
          tryAcquire(e.currentTarget, maxConcurrent);
          onPlay?.(e);
        }}
        onPause={(e) => {
          release(e.currentTarget);
          onPause?.(e);
        }}
        onEnded={(e) => {
          release(e.currentTarget);
          onEnded?.(e);
        }}
        {...rest}
      />
    </div>
  );
});

export default LazyVideo;
