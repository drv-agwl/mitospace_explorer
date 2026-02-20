import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Video, X, Play, Pause } from 'lucide-react';
import type { Sample } from '../types';
import { getFeatureDisplayLabel } from '../constants/features';

const AXIS_SAMPLE_COUNT = 9;

// Drugs to deprioritize in semantic axis preview (will only use if no alternatives)
const DEPRIORITIZED_DRUGS = ['Oligomycin', 'DNP'];

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
    // First pass: find best match excluding deprioritized drugs and already used indices
    let nearest = -1;
    let best = Infinity;
    
    for (let i = 0; i < limit; i++) {
      if (usedIndices.has(i)) continue;
      const drug = samples[i]?.treatment?.drug || '';
      const isDeprioritized = DEPRIORITIZED_DRUGS.some(d => 
        drug.toLowerCase().includes(d.toLowerCase())
      );
      if (isDeprioritized) continue;
      
      const d = Math.abs(featureValues[i] - target);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    
    // Second pass: if no good match found, allow deprioritized drugs (but still avoid duplicates)
    if (nearest === -1) {
      for (let i = 0; i < limit; i++) {
        if (usedIndices.has(i)) continue;
        const d = Math.abs(featureValues[i] - target);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
    }
    
    // Last resort: allow duplicates if absolutely necessary
    if (nearest === -1) {
      for (let i = 0; i < limit; i++) {
        const d = Math.abs(featureValues[i] - target);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
    }
    
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
  onClose: () => void;
  onSelectSample?: (sample: Sample) => void;
}

const SemanticAxisPreview: React.FC<SemanticAxisPreviewProps> = ({
  featureRange,
  featureValues,
  selectedFeature,
  samples,
  apiEmbeddingCount,
  onClose,
  onSelectSample,
}) => {
  const axisSamples = useMemo(() => {
    const max = apiEmbeddingCount ?? featureValues.length;
    return getAxisSamples(featureRange, featureValues, samples, AXIS_SAMPLE_COUNT, max);
  }, [featureRange, featureValues, samples, apiEmbeddingCount]);

  const [syncVideos, setSyncVideos] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const togglePlayPause = useCallback(() => {
    const next = !isPlaying;
    if (next && syncVideos) {
      const first = videoRefs.current.find((v) => v);
      if (first) {
        const t = first.currentTime;
        videoRefs.current.forEach((v) => {
          if (v && v !== first) v.currentTime = t;
        });
      }
    }
    setIsPlaying(next);
    videoRefs.current.forEach((v) => {
      if (v) next ? v.play() : v.pause();
    });
  }, [isPlaying, syncVideos]);

  const handleTimeUpdate = useCallback((leader: HTMLVideoElement) => {
    if (!syncVideos) return;
    const t = leader.currentTime;
    videoRefs.current.forEach((v) => {
      if (v && v !== leader && Math.abs(v.currentTime - t) > 0.1) {
        v.currentTime = t;
      }
    });
  }, [syncVideos]);

  const handleVideoEnded = useCallback(() => {
    if (syncVideos) {
      setIsPlaying(false);
      videoRefs.current.forEach((v) => {
        if (v) v.currentTime = 0;
      });
    }
  }, [syncVideos]);

  // Use TMRM video (index 1) for membrane potential, otherwise use MitoTracker (index 0)
  const isMembranePotential = selectedFeature === 'TMRM Intensity' || 
                               selectedFeature === 'tmrm_intensity' ||
                               selectedFeature?.toLowerCase().includes('tmrm') ||
                               selectedFeature?.toLowerCase().includes('membrane potential');
  const videoIndex = isMembranePotential ? 1 : 0;
  
  const videoCount = axisSamples.filter((s) => s.sample.videos?.[videoIndex]).length;
  const canSync = videoCount > 1;

  if (axisSamples.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-white/[0.08] bg-black/95 backdrop-blur-sm" data-tour="semantic-axis-preview">
      <div className="flex items-center justify-between px-6 py-3 gap-4">
        <p className="text-xs font-medium text-white/70 uppercase tracking-wider shrink-0">
          Samples along {getFeatureDisplayLabel(selectedFeature)}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {canSync && (
            <label className="flex items-center gap-2 cursor-pointer text-xs text-white/70 hover:text-white">
              <input
                type="checkbox"
                checked={syncVideos}
                onChange={(e) => {
                  const on = e.target.checked;
                  setSyncVideos(on);
                  setIsPlaying(false);
                  videoRefs.current.forEach((v) => {
                    if (v) v.pause();
                  });
                  if (on) {
                    const first = videoRefs.current.find((v) => v);
                    if (first) {
                      const t = first.currentTime;
                      videoRefs.current.forEach((v) => {
                        if (v && v !== first) v.currentTime = t;
                      });
                    }
                  }
                }}
                className="w-3.5 h-3.5 rounded accent-white"
              />
              Sync videos
            </label>
          )}
          {syncVideos && (
            <button
              onClick={togglePlayPause}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium"
              title={isPlaying ? 'Pause all' : 'Play all'}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="px-6 pb-4 flex gap-3 overflow-x-auto">
        {axisSamples.map(({ sample, value }, i) => (
          <button
            key={sample.id + i}
            type="button"
            onClick={() => onSelectSample?.(sample)}
            className="flex-1 min-w-[100px] max-w-[180px] rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] group hover:border-white/20 hover:ring-1 hover:ring-white/20 transition-all text-left focus:outline-none focus:ring-1 focus:ring-white/30"
          >
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
                  autoPlay={!syncVideos}
                  preload="metadata"
                  onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
                  onEnded={handleVideoEnded}
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
            <div className="px-2.5 py-2">
              <p className="text-xs font-medium text-white/90 truncate">{sample.treatment.drug}</p>
              <p className="text-[10px] text-white/50 tabular-nums">{value.toFixed(3)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SemanticAxisPreview;
export { findNearestSampleIndex };
