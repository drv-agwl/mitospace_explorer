import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Video, X, Play, Pause } from 'lucide-react';
import type { Sample } from '../types';

interface DrugConditionStripProps {
  /** Pool of samples to draw one representative per drug from. */
  samples: Sample[];
  /** Called when the user dismisses the strip via the X button. */
  onClose: () => void;
  /** Called when the user clicks a card. */
  onSelectSample?: (sample: Sample) => void;
}

// ---------------------------------------------------------------------------
// Local visual primitives — mirror the toolbar / axis-preview pill language so
// the strip feels native, not bolted-on.
// ---------------------------------------------------------------------------
const PILL_BASE =
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border transition-all duration-150 shrink-0';
const PILL_ACTIVE = 'bg-white/[0.12] border-white/[0.22] text-white';

interface DrugCard {
  drug: string;
  sample: Sample;
}

/**
 * Pick one representative sample per drug. Preference order:
 *   1. Samples that have a usable video (the strip is about visual phenotype).
 *   2. Samples with images (fallback).
 *   3. Anything (last resort).
 * Drugs are sorted alphabetically so the strip has a stable order independent
 * of input data shuffling.
 */
function selectRepresentatives(samples: Sample[]): DrugCard[] {
  const byDrug = new Map<string, Sample>();
  for (const s of samples) {
    const drug = s.treatment?.drug;
    if (!drug) continue;
    const existing = byDrug.get(drug);
    if (!existing) {
      byDrug.set(drug, s);
      continue;
    }
    // Upgrade only if the candidate is strictly "better" media-wise.
    const candidateHasVideo = (s.videos?.length ?? 0) > 0;
    const existingHasVideo = (existing.videos?.length ?? 0) > 0;
    if (candidateHasVideo && !existingHasVideo) {
      byDrug.set(drug, s);
      continue;
    }
    if (candidateHasVideo === existingHasVideo) {
      const candidateHasImage = (s.images?.length ?? 0) > 0;
      const existingHasImage = (existing.images?.length ?? 0) > 0;
      if (candidateHasImage && !existingHasImage) {
        byDrug.set(drug, s);
      }
    }
  }
  return Array.from(byDrug.entries())
    .map(([drug, sample]) => ({ drug, sample }))
    .sort((a, b) => a.drug.localeCompare(b.drug));
}

/** Same visual language as semantic-axis sample cards: 3px top accent from the
 * sample's treatment colour (matches the point cloud when coloured by drug). */
function treatmentAccentCss(sample: Sample): string {
  const { r, g, b } = sample.color;
  const rr = Math.round((r ?? 0) * 255);
  const gg = Math.round((g ?? 0) * 255);
  const bb = Math.round((b ?? 0) * 255);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

const DrugConditionStrip: React.FC<DrugConditionStripProps> = ({
  samples,
  onClose,
  onSelectSample,
}) => {
  const cards = useMemo(() => selectRepresentatives(samples), [samples]);

  const videoIndex = 0;
  const videoCount = cards.filter((c) => c.sample.videos?.[videoIndex]).length;
  const hasVideos = videoCount > 0;

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  // All videos play in lockstep by design (no user toggle). The slider state
  // here only drives the play/pause label.
  const [isPlaying, setIsPlaying] = useState(true);

  const setAllPlaying = useCallback((next: boolean) => {
    setIsPlaying(next);
    videoRefs.current.forEach((v) => {
      if (!v) return;
      if (next) {
        v.play().catch(() => {
          /* autoplay policy / decode race — ignore */
        });
      } else {
        v.pause();
      }
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    const next = !isPlaying;
    if (next) {
      // Align timelines to the first live video before resuming so the
      // strip "snaps back" to a coherent state.
      const leader = videoRefs.current.find((v) => v);
      if (leader) {
        const t = leader.currentTime;
        videoRefs.current.forEach((v) => {
          if (v && v !== leader) v.currentTime = t;
        });
      }
    }
    setAllPlaying(next);
  }, [isPlaying, setAllPlaying]);

  // Continuously re-align peer videos to whichever one fires `timeupdate`.
  // The 0.1s threshold keeps the strip visually locked without thrashing
  // decoders on every frame.
  const handleTimeUpdate = useCallback((leader: HTMLVideoElement) => {
    const t = leader.currentTime;
    videoRefs.current.forEach((v) => {
      if (v && v !== leader && Math.abs(v.currentTime - t) > 0.1) {
        v.currentTime = t;
      }
    });
  }, []);

  // Loop is enabled on every <video>, so this path is rarely hit; kept as a
  // safety net to reset everyone to t=0 if a video does end.
  const handleVideoEnded = useCallback(() => {
    videoRefs.current.forEach((v) => {
      if (v) v.currentTime = 0;
    });
  }, []);

  // Keep the play/pause label honest even when the browser blocks autoplay or
  // a video is paused individually.
  const refreshPlayingState = useCallback(() => {
    const anyPlaying = videoRefs.current.some(
      (v) => v && !v.paused && !v.ended
    );
    setIsPlaying(anyPlaying);
  }, []);

  useEffect(() => {
    if (!hasVideos) return;
    const id = window.setTimeout(refreshPlayingState, 250);
    return () => window.clearTimeout(id);
  }, [hasVideos, refreshPlayingState]);

  // Throttle CPU: only let cards that are scrolled into view actually decode.
  // 26 simultaneous looping videos can otherwise hammer low-end laptops.
  useEffect(() => {
    if (!hasVideos) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) {
            if (isPlaying) v.play().catch(() => {});
          } else {
            v.pause();
          }
        }
      },
      { root: null, threshold: 0.1 }
    );
    videoRefs.current.forEach((v) => {
      if (v) obs.observe(v);
    });
    return () => obs.disconnect();
  }, [hasVideos, isPlaying, cards.length]);

  if (cards.length === 0) return null;

  return (
    <div
      className="shrink-0 border-b border-white/[0.08] bg-black/95 backdrop-blur-sm"
      data-tour="drug-conditions-strip"
    >
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 pt-3 pb-2 gap-4">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-xs font-semibold text-white/85 uppercase tracking-wider truncate">
            Drug conditions
          </p>
          <p className="text-[11px] text-white/40 tabular-nums shrink-0">
            {cards.length} condition{cards.length === 1 ? '' : 's'} · live overview
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasVideos && (
            <button
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause all videos' : 'Play all videos'}
              title={isPlaying ? 'Pause all drug-condition videos' : 'Play all drug-condition videos'}
              className={`${PILL_BASE} ${PILL_ACTIVE}`}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.14] transition-colors"
            title="Hide drug-conditions strip"
            aria-label="Hide drug-conditions strip"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ─── Cards ──────────────────────────────────────────────────────── */}
      <div className="px-6 pb-4 flex gap-2.5 overflow-x-auto">
        {cards.map(({ drug, sample }, i) => (
          <button
            key={drug}
            type="button"
            onClick={() => onSelectSample?.(sample)}
            title={drug}
            className="shrink-0 w-[112px] rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] group hover:border-white/25 hover:ring-1 hover:ring-white/20 transition-all text-left focus:outline-none focus:ring-1 focus:ring-white/30"
          >
            <div
              className="h-[3px] w-full"
              style={{ background: treatmentAccentCss(sample) }}
              aria-hidden="true"
            />
            <div className="aspect-square relative bg-white/[0.04]">
              {sample.videos?.[videoIndex] ? (
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={sample.videos[videoIndex]}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  autoPlay
                  preload="metadata"
                  onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
                  onEnded={handleVideoEnded}
                  onPlay={refreshPlayingState}
                  onPause={refreshPlayingState}
                />
              ) : sample.images?.[0] ? (
                <img
                  src={sample.images[0]}
                  alt={drug}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                  <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center">
                    <Video size={20} className="text-white/30" />
                  </div>
                </div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="text-[11px] font-medium text-white/90 truncate">
                {drug}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default DrugConditionStrip;
