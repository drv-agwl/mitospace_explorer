import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Video, X, Play, Pause } from 'lucide-react';
import type { Sample, DatasetVersion } from '../types';
import { getFeatureDisplayLabel } from '../constants/features';
import { formatFeatureValue } from '../utils/formatFeature';
import { featureToColorPlasmaAdaptive } from '../utils/featureColor';
import { estimatePlasmaParams } from '../utils/featureColorParams';
import {
  isAxisStripExcludedDrug,
  isAxisStripExcludedSampleId,
} from '../constants/axisSampleExclusions';

// Baseline number of axis samples — used until the strip's width is measured
// and on small viewports. The adaptive count below grows past this on wider
// displays so the cards always fill the available width.
const MIN_AXIS_SAMPLES = 9;
// Cap to keep drug labels legible and the strip from feeling like a wall of
// thumbnails on ultrawide / 4K displays.
const MAX_AXIS_SAMPLES = 17;
// Target horizontal budget per card (incl. its share of the gap). The strip
// tries to fit as many cards as possible at this density before the cap.
const AXIS_TARGET_CARD_PX = 160;

// Drugs to deprioritize in semantic axis preview (will only use if no alternatives)
const DEPRIORITIZED_DRUGS = ['Oligomycin', 'DNP'];

function isSoftDeprioritizedDrug(drug: string): boolean {
  return DEPRIORITIZED_DRUGS.some((d) => drug.toLowerCase().includes(d.toLowerCase()));
}

function isHardAxisStripExcluded(samples: Sample[], i: number): boolean {
  const s = samples[i];
  if (!s) return true;
  if (isAxisStripExcludedSampleId(s.id)) return true;
  const drug = s.treatment?.drug || '';
  return isAxisStripExcludedDrug(drug);
}

function findNearestSampleIndex(
  targetValue: number,
  featureValues: number[],
  maxIndex: number
): number {
  let nearest = 0;
  let best = Infinity;
  const limit = Math.min(featureValues.length, maxIndex);
  for (let i = 0; i < limit; i++) {
    const d = Math.abs(featureValues[i] - targetValue);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  return nearest;
}

function indicesByIncreasingDistance(
  target: number,
  featureValues: number[],
  limit: number,
  usedIndices: Set<number>
): number[] {
  const scored: { i: number; d: number }[] = [];
  for (let i = 0; i < limit; i++) {
    if (usedIndices.has(i)) continue;
    const v = featureValues[i];
    if (!Number.isFinite(v)) continue;
    scored.push({ i, d: Math.abs(v - target) });
  }
  scored.sort((a, b) => (a.d === b.d ? a.i - b.i : a.d - b.d));
  return scored.map((x) => x.i);
}

function pickUnusedIndexForTarget(
  target: number,
  featureValues: number[],
  samples: Sample[],
  limit: number,
  usedIndices: Set<number>
): number {
  const ranked = indicesByIncreasingDistance(target, featureValues, limit, usedIndices);

  const tryPick = (predicate: (i: number) => boolean): number => {
    for (const i of ranked) {
      if (predicate(i)) return i;
    }
    return -1;
  };

  // Prefer: not hard-excluded, not soft-deprioritized
  let pick = tryPick(
    (i) => !isHardAxisStripExcluded(samples, i) && !isSoftDeprioritizedDrug(samples[i]?.treatment?.drug || '')
  );
  if (pick >= 0) return pick;

  // Then: not hard-excluded (allows oligomycin / DNP when they are closest)
  pick = tryPick((i) => !isHardAxisStripExcluded(samples, i));
  if (pick >= 0) return pick;

  // Then: any unused index by distance
  pick = tryPick(() => true);
  if (pick >= 0) return pick;

  // Last resort: allow re-using an index (duplicate thumbnail)
  let best = Infinity;
  let nearest = -1;
  for (let i = 0; i < limit; i++) {
    const v = featureValues[i];
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(v - target);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  return nearest >= 0 ? nearest : 0;
}

function getAxisSamples(
  featureRange: { min: number; max: number },
  featureValues: number[],
  samples: Sample[],
  count: number,
  maxIndex: number
): Array<{ sample: Sample; index: number; value: number }> {
  const range = featureRange.max - featureRange.min;
  const targets = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? featureRange.max : featureRange.min + (range * i) / (count - 1)
  );
  const limit = Math.min(featureValues.length, samples.length, maxIndex);
  if (limit === 0) return [];

  const usedIndices = new Set<number>();

  return targets.map((target) => {
    const nearest = pickUnusedIndexForTarget(target, featureValues, samples, limit, usedIndices);
    usedIndices.add(nearest);

    return {
      sample: samples[nearest],
      index: nearest,
      value: featureValues[nearest] ?? target,
    };
  });
}

interface SemanticAxisPreviewProps {
  featureRange: { min: number; max: number };
  featureValues: number[];
  selectedFeature: string;
  samples: Sample[];
  apiEmbeddingCount: number | null;
  datasetVersion: DatasetVersion;
  onClose: () => void;
  onSelectSample?: (sample: Sample) => void;
}

// ---------------------------------------------------------------------------
// Local visual primitives — match the toolbar's pill language.
// ---------------------------------------------------------------------------
const PILL_BASE =
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border transition-all duration-150 shrink-0';
const PILL_ACTIVE =
  'bg-white/[0.12] border-white/[0.22] text-white';

function rgb01ToCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

const SemanticAxisPreview: React.FC<SemanticAxisPreviewProps> = ({
  featureRange,
  featureValues,
  selectedFeature,
  samples,
  apiEmbeddingCount,
  datasetVersion,
  onClose,
  onSelectSample,
}) => {
  // Measure the cards container so we can grow the sample count to fill
  // wider displays. Without this, the strip caps each card at 180px and
  // leaves a wedge of empty space on ultrawide / 4K screens.
  const cardsRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setContainerWidth(el.clientWidth);
      return;
    }
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        // contentRect.width excludes the element's own padding, which is
        // what we want when reasoning about card space.
        setContainerWidth(e.contentRect.width);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const targetSampleCount = useMemo(() => {
    if (containerWidth <= 0) return MIN_AXIS_SAMPLES;
    // contentRect already excludes our `px-6`, so don't subtract again.
    const avail = Math.max(containerWidth, 200);
    const ideal = Math.round(avail / AXIS_TARGET_CARD_PX);
    return Math.max(MIN_AXIS_SAMPLES, Math.min(MAX_AXIS_SAMPLES, ideal));
  }, [containerWidth]);

  const axisSamples = useMemo(() => {
    const max = apiEmbeddingCount ?? featureValues.length;
    return getAxisSamples(featureRange, featureValues, samples, targetSampleCount, max);
  }, [featureRange, featureValues, samples, apiEmbeddingCount, targetSampleCount]);

  // Plasma parameters and per-sample colors (kept in lockstep with the canvas /
  // legend so cards visually align with the 3D scene's coloring).
  const plasmaParams = useMemo(() => estimatePlasmaParams(featureValues), [featureValues]);

  const sampleColorsCss = useMemo(
    () =>
      axisSamples.map(({ value }) =>
        rgb01ToCss(
          featureToColorPlasmaAdaptive(
            value,
            featureRange.min,
            featureRange.max,
            plasmaParams.gamma,
            plasmaParams.contrast
          )
        )
      ),
    [axisSamples, featureRange, plasmaParams]
  );

  // Use TMRM video (index 1) for membrane potential, otherwise use MitoTracker (index 0).
  // In v3 each sample has only one video, so we always fall back to index 0.
  const isMembranePotential =
    selectedFeature === 'TMRM Intensity' ||
    selectedFeature === 'tmrm_intensity' ||
    selectedFeature === 'tmrm_last' ||
    selectedFeature?.toLowerCase().includes('tmrm') ||
    selectedFeature?.toLowerCase().includes('membrane potential');
  const hasTMRMVideo = axisSamples.some((s) => (s.sample.videos?.length ?? 0) > 1);
  const videoIndex = isMembranePotential && hasTMRMVideo ? 1 : 0;

  const videoCount = axisSamples.filter((s) => s.sample.videos?.[videoIndex]).length;
  const hasVideos = videoCount > 0;

  // All videos play in lockstep by design. No user toggle.
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const setAllPlaying = useCallback((next: boolean) => {
    setIsPlaying(next);
    videoRefs.current.forEach((v) => {
      if (!v) return;
      if (next) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    const next = !isPlaying;
    if (next) {
      // Align timelines to the first live video before resuming so the
      // strip is coherent.
      const first = videoRefs.current.find((v) => v);
      if (first) {
        const t = first.currentTime;
        videoRefs.current.forEach((v) => {
          if (v && v !== first) v.currentTime = t;
        });
      }
    }
    setAllPlaying(next);
  }, [isPlaying, setAllPlaying]);

  const handleTimeUpdate = useCallback((leader: HTMLVideoElement) => {
    const t = leader.currentTime;
    videoRefs.current.forEach((v) => {
      if (v && v !== leader && Math.abs(v.currentTime - t) > 0.1) {
        v.currentTime = t;
      }
    });
  }, []);

  const handleVideoEnded = useCallback(() => {
    videoRefs.current.forEach((v) => {
      if (v) v.currentTime = 0;
    });
  }, []);

  // Keep the button label honest if the browser blocks autoplay or any video
  // is paused/played individually.
  const refreshPlayingState = useCallback(() => {
    const anyPlaying = videoRefs.current.some((v) => v && !v.paused && !v.ended);
    setIsPlaying(anyPlaying);
  }, []);

  // If the autoplay attribute on initial mount didn't actually start playback
  // (e.g. some browsers gate autoplay), reflect the real state after a tick.
  useEffect(() => {
    if (!hasVideos) return;
    const id = window.setTimeout(refreshPlayingState, 250);
    return () => window.clearTimeout(id);
  }, [hasVideos, refreshPlayingState]);

  if (axisSamples.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-white/[0.08] bg-black/95 backdrop-blur-sm">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 pt-3 pb-2 gap-4">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-xs font-semibold text-white/85 uppercase tracking-wider truncate">
            Samples along {getFeatureDisplayLabel(selectedFeature, datasetVersion)}
          </p>
          <p className="text-[11px] text-white/40 tabular-nums shrink-0">
            {axisSamples.length} samples · low → high
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasVideos && (
            <button
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause all videos' : 'Play all videos'}
              title={isPlaying ? 'Pause all (videos along axis)' : 'Play all (videos along axis)'}
              className={`${PILL_BASE} ${PILL_ACTIVE}`}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.14] transition-colors"
            title="Close"
            aria-label="Close samples-along-axis panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Plasma gradient ramp removed: the toolbar's plasma-coloured slider
          already serves as the canonical color legend, so duplicating the
          ramp here added visual noise without information. The per-card
          3px plasma accent (below) still ties each card to its value. */}

      {/* ─── Cards ──────────────────────────────────────────────────────── */}
      <div ref={cardsRef} className="px-6 pb-4 flex gap-3 overflow-x-auto">
        {axisSamples.map(({ sample, value }, i) => (
          <button
            key={sample.id + i}
            type="button"
            onClick={() => onSelectSample?.(sample)}
            title={`${sample.treatment.drug} · ${formatFeatureValue(value)}`}
            className="flex-1 min-w-[110px] max-w-[180px] rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] group hover:border-white/25 hover:ring-1 hover:ring-white/20 transition-all text-left focus:outline-none focus:ring-1 focus:ring-white/30"
          >
            {/* Plasma color accent — links the card to its gradient position. */}
            <div
              className="h-[3px] w-full"
              style={{ background: sampleColorsCss[i] }}
              aria-hidden="true"
            />
            <div className="aspect-video relative bg-white/[0.04]">
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
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                  <div className="w-12 h-12 rounded-lg bg-white/[0.06] flex items-center justify-center">
                    <Video size={24} className="text-white/30" />
                  </div>
                </div>
              )}
            </div>
            <div className="px-2.5 py-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-white/90 truncate min-w-0">
                {sample.treatment.drug}
              </p>
              <span
                className="text-[10px] font-mono tabular-nums text-white/65 shrink-0 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.06]"
                title={`${getFeatureDisplayLabel(selectedFeature, datasetVersion)} value`}
              >
                {formatFeatureValue(value)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SemanticAxisPreview;
export { findNearestSampleIndex };
