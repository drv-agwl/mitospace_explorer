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
 */
let syncEpoch = 0;
function ensureEpoch(): number {
  if (!syncEpoch) syncEpoch = performance.now();
  return syncEpoch;
}
function alignToSyncClock(el: HTMLVideoElement) {
  const d = el.duration;
  if (!d || !isFinite(d) || d <= 0) return;
  const phase = ((performance.now() - ensureEpoch()) / 1000) % d;
  // Only nudge when noticeably off, to avoid reseek jitter.
  if (Math.abs(el.currentTime - phase) > 0.08) {
    try {
      el.currentTime = phase;
    } catch {
      /* ignore seek race */
    }
  }
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
    alt = '',
    className,
    muted = true,
    loop = true,
    playsInline = true,
    onPlay,
    onPause,
    onEnded,
    ...rest
  },
  forwardedRef
) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | undefined>(undefined);
  const [videoReady, setVideoReady] = useState(false);
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

    if (wantPlay) {
      if (!tryAcquire(el, maxConcurrent)) {
        el.pause();
        return;
      }
      alignToSyncClock(el);
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => alignToSyncClock(el)).catch(() => release(el));
      }
    } else {
      el.pause();
      release(el);
    }
  }, [maxConcurrent]);

  // Attach src on intersection; (re)start or pause playback on visibility change.
  useEffect(() => {
    const el = localRef.current;
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
            setActiveSrc(undefined);
            setVideoReady(false);
            el.removeAttribute('src');
            el.load();
          } else {
            el.pause();
            release(el);
          }
        }
      },
      { root: null, threshold: 0.1, rootMargin: '150px' }
    );

    obs.observe(el);
    return () => {
      obs.disconnect();
      release(el);
    };
  }, [src, unloadWhenHidden, sync]);

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
        preload="none"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          videoReady || !poster ? 'opacity-100' : 'opacity-0'
        }`}
        onLoadedMetadata={() => alignToSyncClock(localRef.current!)}
        onCanPlay={() => {
          setVideoReady(true);
          sync();
        }}
        onPlaying={(e) => {
          setVideoReady(true);
          alignToSyncClock(e.currentTarget);
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
