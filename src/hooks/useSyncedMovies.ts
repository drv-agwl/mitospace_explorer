import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Every v3 cell movie has 49 frames at 10 frames per second. */
export const MOVIE_FPS = 10;
const DEFAULT_FRAME_COUNT = 49;
/** Start together once every movie can play, or after this long with the ones that can. */
const START_GATE_MS = 2500;
/** A movie further than this from the first one (just under one frame) is moved back into step. */
const MAX_DRIFT_S = 0.08;

export interface SyncedMovies {
  playing: boolean;
  frameCount: number;
  /** The frame every movie shows while paused. */
  pausedFrame: number;
  /** Ref callback for the movie of one cell. */
  bind: (id: string) => (el: HTMLVideoElement | null) => void;
  onCanPlay: (id: string) => void;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  toggle: () => void;
  /** Pause every movie on frame `index` (wraps around both ends). */
  showFrame: (index: number) => void;
  /** The frame the first playable movie shows right now. */
  currentFrame: () => number;
}

const play = (video: HTMLVideoElement) => {
  video.muted = true;
  void video.play().catch(() => {});
};

const frameAt = (time: number, frameCount: number) =>
  Math.min(frameCount - 1, Math.max(0, Math.floor(time * MOVIE_FPS + 1e-3)));

/** Plays several movies frame-locked: one start, one pause, one frame. */
export function useSyncedMovies(ids: readonly string[], autoplay: boolean): SyncedMovies {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const binders = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  const ready = useRef(new Set<string>());
  const started = useRef(false);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [playing, setPlaying] = useState(autoplay);
  const playingRef = useRef(playing);
  const [frameCount, setFrameCount] = useState(DEFAULT_FRAME_COUNT);
  const frameCountRef = useRef(frameCount);
  frameCountRef.current = frameCount;
  const [pausedFrame, setPausedFrame] = useState(0);
  const pausedFrameRef = useRef(pausedFrame);

  const movies = useCallback(
    () =>
      idsRef.current.flatMap((id) => {
        const video = videos.current.get(id);
        return video ? [video] : [];
      }),
    []
  );
  const leader = useCallback(() => movies().find((v) => v.readyState >= 2) ?? null, [movies]);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    for (const video of movies()) {
      if (video.readyState >= 1) video.currentTime = 0;
      if (playingRef.current) play(video);
    }
  }, [movies]);

  useEffect(() => {
    const timer = window.setTimeout(start, START_GATE_MS);
    return () => window.clearTimeout(timer);
  }, [start]);

  const bind = useCallback((id: string) => {
    let binder = binders.current.get(id);
    if (!binder) {
      binder = (el) => {
        if (el) {
          videos.current.set(id, el);
        } else {
          videos.current.delete(id);
          ready.current.delete(id);
        }
      };
      binders.current.set(id, binder);
    }
    return binder;
  }, []);

  const onCanPlay = useCallback(
    (id: string) => {
      if (ready.current.has(id)) return;
      ready.current.add(id);
      if (!started.current) {
        if (idsRef.current.every((x) => ready.current.has(x))) start();
        return;
      }
      // Arrived after the start: step in with the others.
      const video = videos.current.get(id);
      if (!video) return;
      const other = movies().find((v) => v !== video && v.readyState >= 2);
      video.currentTime = other ? other.currentTime : (pausedFrameRef.current + 0.5) / MOVIE_FPS;
      if (playingRef.current) play(video);
    },
    [movies, start]
  );

  const onLoadedMetadata = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = event.currentTarget.duration;
    if (Number.isFinite(duration) && duration > 0) {
      setFrameCount(Math.max(1, Math.round(duration * MOVIE_FPS)));
    }
  }, []);

  const showFrame = useCallback(
    (index: number) => {
      const n = frameCountRef.current;
      const frame = ((Math.round(index) % n) + n) % n;
      playingRef.current = false;
      setPlaying(false);
      // The middle of the frame, so every movie decodes the same one.
      for (const video of movies()) {
        video.pause();
        if (video.readyState >= 1) video.currentTime = (frame + 0.5) / MOVIE_FPS;
      }
      pausedFrameRef.current = frame;
      setPausedFrame(frame);
    },
    [movies]
  );

  const toggle = useCallback(() => {
    if (playingRef.current) {
      const first = leader();
      showFrame(first ? frameAt(first.currentTime, frameCountRef.current) : pausedFrameRef.current);
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    started.current = true;
    for (const video of movies()) play(video);
  }, [leader, movies, showFrame]);

  const currentFrame = useCallback(() => {
    const first = leader();
    return first ? frameAt(first.currentTime, frameCountRef.current) : pausedFrameRef.current;
  }, [leader]);

  // While playing, keep every movie within a frame of the first one (and restart any that stalled).
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const first = leader();
      if (!first) return;
      const duration = first.duration || 0;
      for (const video of movies()) {
        if (video === first || video.readyState < 2 || video.seeking) continue;
        let gap = Math.abs(video.currentTime - first.currentTime);
        if (duration) gap = Math.min(gap, duration - gap);
        if (gap > MAX_DRIFT_S) video.currentTime = first.currentTime;
        if (video.paused) play(video);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, leader, movies]);

  return useMemo(
    () => ({
      playing,
      frameCount,
      pausedFrame,
      bind,
      onCanPlay,
      onLoadedMetadata,
      toggle,
      showFrame,
      currentFrame,
    }),
    [playing, frameCount, pausedFrame, bind, onCanPlay, onLoadedMetadata, toggle, showFrame, currentFrame]
  );
}
