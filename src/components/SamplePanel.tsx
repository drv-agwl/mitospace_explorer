import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Microscope,
  Pill,
  Clock,
  Video,
  Play,
  Pause,
  Database,
  Beaker,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  Columns3,
} from 'lucide-react';
import { MAX_COMPARE_CELLS, useSample } from '../context/SampleContext';
import type { Sample } from '../types';
import { conditionLabel, conditionMechanism } from '../constants/conditions';
import { prefersReducedMotion } from '../utils/motion';
import { largePosterForId, usePosterManifest } from '../utils/posterManifest';
import { trackEvent } from '../analytics';

// labelMoa is shown (corrected) as the mechanism under the name; quality and experimentDate are export placeholders.
const HIDDEN_METADATA_KEYS = new Set(['quality', 'labelmoa', 'experimentdate']);

/**
 * A small inline "copy to clipboard" button that swaps to a check-mark for ~1s
 * after a successful copy. Designed to read as a quiet utility, not a CTA.
 */
const CopyChip: React.FC<{ value: string; label?: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Silently ignore — clipboard is best-effort.
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label ?? 'Copy'}
      title={copied ? 'Copied' : label ?? 'Copy'}
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white/55 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.12] transition-colors shrink-0"
    >
      {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
    </button>
  );
};

/** Copies the page URL, which mirrors the selected cell, feature and condition filter. */
const CopyLinkButton: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      trackEvent('copy_link');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is best-effort (permissions / insecure context).
    }
  }, []);
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy a link to this cell, feature and filter"
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-white/75 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
    >
      {copied ? <Check size={12} strokeWidth={2.5} /> : <Link2 size={12} strokeWidth={2} />}
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
};

const PANEL_TOGGLE =
  'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.12] transition-colors';

/** Adds the open cell to the comparison (the same as Shift-clicking it on the map), or takes it out. */
const CompareToggle: React.FC<{ sample: Sample }> = ({ sample }) => {
  const { compareSamples, toggleCompare } = useSample();
  const inComparison = compareSamples.some((s) => s.id === sample.id);
  const full = !inComparison && compareSamples.length >= MAX_COMPARE_CELLS;
  return (
    <button
      type="button"
      onClick={() => toggleCompare(sample, 'panel')}
      disabled={full}
      aria-pressed={inComparison}
      title={
        full
          ? `Up to ${MAX_COMPARE_CELLS} cells can be compared`
          : inComparison
            ? 'Take this cell out of the comparison'
            : 'Add this cell to the comparison (or Shift-click it on the map)'
      }
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        inComparison
          ? 'bg-white/[0.12] border-white/[0.22] text-white'
          : 'text-white/75 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08]'
      }`}
    >
      {inComparison ? <Check size={12} strokeWidth={2.5} /> : <Columns3 size={12} strokeWidth={2} />}
      {inComparison ? 'In comparison' : 'Compare'}
    </button>
  );
};

interface SamplePanelProps {
  /** Show only a thin rail so the atlas gets the width. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const SamplePanel: React.FC<SamplePanelProps> = ({ collapsed = false, onToggleCollapsed }) => {
  const { selectedSample, visualizerOptions, compareOpen } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  // Autoplay muted inline (like the strip) so Safari reliably paints/plays.
  const [isPlaying, setIsPlaying] = useState(() => !prefersReducedMotion());
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({});
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const [videoAttempt, setVideoAttempt] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const posters = usePosterManifest();

  // Media state is per slot, so drop it when another cell is shown (one failure must not stick).
  const [mediaStateFor, setMediaStateFor] = useState<string | null>(selectedSample?.id ?? null);
  if ((selectedSample?.id ?? null) !== mediaStateFor) {
    setMediaStateFor(selectedSample?.id ?? null);
    setVideoLoadError({});
    setVideoLoading({});
    setImageLoadError({});
    setImageLoading({});
  }

  const retryVideo = (index: number) => {
    setVideoLoadError((prev) => ({ ...prev, [index]: false }));
    setVideoAttempt((n) => n + 1);
  };

  const handleVideoError = (index: number) => {
    setVideoLoadError((prev) => ({ ...prev, [index]: true }));
    setVideoLoading((prev) => ({ ...prev, [index]: false }));
  };

  const handleVideoLoadStart = (index: number) => {
    setVideoLoading((prev) => ({ ...prev, [index]: true }));
  };

  const handleVideoCanPlay = (index: number) => {
    setVideoLoading((prev) => ({ ...prev, [index]: false }));
  };

  const handleVideoPlaying = (index: number) => {
    // 'playing' is the most reliable "it's actually running" signal on Safari.
    setVideoLoading((prev) => ({ ...prev, [index]: false }));
  };

  const togglePlayPause = () => {
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);
    videoRefs.current.forEach((video) => {
      if (video) {
        if (newPlayingState) {
          // Safari rejects the play() promise if not muted / no gesture — keep
          // muted and swallow the rejection so one failure doesn't throw.
          video.muted = true;
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    });
  };

  // Drive playback explicitly on sample change. Safari's `autoPlay` attribute is
  // unreliable when `src` is assigned via a React re-render (it loads metadata
  // and stalls), so we call muted play() after the elements commit — the same
  // path the manual pause→play uses. Retry briefly to cover slow first buffers.
  useEffect(() => {
    if (!selectedSample) return;
    const autoplay = !prefersReducedMotion();
    setIsPlaying(autoplay);
    if (!autoplay) return;

    let cancelled = false;
    let attempts = 0;

    const kick = () => {
      if (cancelled) return;
      let allPlaying = true;
      videoRefs.current.forEach((v) => {
        if (!v) return;
        v.muted = true;
        if (v.paused) {
          allPlaying = false;
          void v.play().catch(() => {});
        }
      });
      attempts += 1;
      // A few spaced retries handle Safari's "not ready yet" first frames.
      if (!allPlaying && attempts < 5) {
        timer = window.setTimeout(kick, 350);
      }
    };

    let timer = window.setTimeout(kick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedSample?.id]);

  // The comparison covers this panel: hold its movie, and resume afterwards if it was playing.
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (!video) return;
      if (compareOpen) {
        video.pause();
      } else if (isPlaying) {
        video.muted = true;
        void video.play().catch(() => {});
      }
    });
  }, [compareOpen, isPlaying]);

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentVideo = event.currentTarget;
    videoRefs.current.forEach((video) => {
      // Only sync a channel that's actually seekable — setting currentTime on a
      // not-yet-ready video throws / stalls on Safari.
      if (
        video &&
        video !== currentVideo &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - currentVideo.currentTime) > 0.15
      ) {
        try {
          video.currentTime = currentVideo.currentTime;
        } catch {
          /* ignore seek race */
        }
      }
    });
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    videoRefs.current.forEach((video) => {
      if (video) video.currentTime = 0;
    });
  };

  const handleImageError = (index: number) => {
    setImageLoadError((prev) => ({ ...prev, [index]: true }));
    setImageLoading((prev) => ({ ...prev, [index]: false }));
  };

  const handleImageLoadStart = (index: number) => {
    setImageLoading((prev) => ({ ...prev, [index]: true }));
  };

  const handleImageLoad = (index: number) => {
    setImageLoading((prev) => ({ ...prev, [index]: false }));
  };

  /** Active legend colour: treatment RGB in treatment mode, phenotype RGB (or
   *  treatment fallback) in phenotype mode — matches the point cloud. */
  const sampleColor = (() => {
    if (!selectedSample) return null;
    if (visualizerOptions.coloringMode === 'phenotype') {
      return selectedSample.color_phenotypic ?? selectedSample.color;
    }
    return selectedSample.color;
  })();

  const getColorStyle = () => {
    if (!sampleColor) return {};
    const r = (sampleColor.r ?? 0) * 255;
    const g = (sampleColor.g ?? 0) * 255;
    const b = (sampleColor.b ?? 0) * 255;
    return { backgroundColor: `rgb(${r}, ${g}, ${b})` };
  };

  const getAccentBorderStyle = () => {
    if (!sampleColor) return {};
    const r = Math.round((sampleColor.r ?? 0) * 255);
    const g = Math.round((sampleColor.g ?? 0) * 255);
    const b = Math.round((sampleColor.b ?? 0) * 255);
    return { borderLeftWidth: 4, borderLeftColor: `rgb(${r}, ${g}, ${b})` };
  };

  if (collapsed) {
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col items-center gap-3 py-4 bg-black/95 border-l border-white/[0.08]">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Show cell details"
          aria-label="Show cell details"
          aria-expanded={false}
          className={PANEL_TOGGLE}
        >
          <PanelRightOpen size={16} />
        </button>
        {selectedSample && (
          <span
            className="w-2.5 h-2.5 rounded-full border border-white/20"
            style={getColorStyle()}
            title={conditionLabel(selectedSample.treatment.drug)}
          />
        )}
      </div>
    );
  }

  const collapseButton = onToggleCollapsed && (
    <button
      type="button"
      onClick={onToggleCollapsed}
      title="Hide cell details"
      aria-label="Hide cell details"
      aria-expanded
      className={PANEL_TOGGLE}
    >
      <PanelRightClose size={16} />
    </button>
  );

  if (!selectedSample) {
    return (
      <div className="relative flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-black/95 border-l border-white/[0.08] backdrop-blur-sm">
        <div className="absolute top-3 right-3">{collapseButton}</div>
        <div className="flex-1 flex flex-col items-center justify-center px-10 text-center">
          <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-5">
            <Microscope size={32} strokeWidth={1.5} className="text-white/30" />
          </div>
          <p className="text-base font-medium text-white/90 mb-2 tracking-tight">
            No cell selected
          </p>
          <p className="text-sm text-white/60 max-w-[260px] leading-relaxed">
            Click a dot on the map, or a movie in the strip, to see that cell&apos;s movie and treatment.
          </p>
        </div>
      </div>
    );
  }

  const { treatment, t, videos, images, metadata } = selectedSample;
  const hasCompoundData = Boolean(treatment.smiles || treatment.pubchem);
  const label = conditionLabel(treatment.drug);
  const mechanism = conditionMechanism(treatment.drug);
  // Representative cells have a still of this movie's first frame: shown until it plays.
  const videoPoster = largePosterForId(posters, selectedSample.id);
  const metadataEntries = Object.entries(metadata ?? {}).filter(
    ([key]) => !HIDDEN_METADATA_KEYS.has(key.toLowerCase())
  );
  const hasMetadata = metadataEntries.length > 0;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-black/95 border-l border-white/[0.08] backdrop-blur-sm">
      {/* ── HEADER — left accent + colour dot match the cloud legend */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.08]">
        <div
          className="rounded-xl border border-white/[0.08] overflow-hidden bg-white/[0.03] flex"
          style={getAccentBorderStyle()}
        >
          <div className="p-4 flex-1 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="shrink-0 w-3 h-3 rounded-full border border-white/20"
                style={getColorStyle()}
                aria-hidden="true"
              />
              <h3
                className="flex-1 min-w-0 text-[20px] font-semibold text-white tracking-tight truncate leading-tight"
                title={label}
              >
                {label}
              </h3>
              {collapseButton}
            </div>
            {mechanism && (
              <p className="mt-1.5 text-[12px] text-white/65 leading-snug" title="Mechanism class">
                {mechanism}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
              {treatment.dose && treatment.dose !== 'N/A' && (
                <span className="inline-flex items-center gap-1.5 text-white/75" title="Dose">
                  <Pill size={12} strokeWidth={2} className="text-white/45" />
                  <span className="font-medium">{treatment.dose}</span>
                </span>
              )}
              {treatment.time && treatment.time !== 'N/A' && (
                <span className="inline-flex items-center gap-1.5 text-white/75" title="Treatment time">
                  <Clock size={12} strokeWidth={2} className="text-white/45" />
                  <span className="font-medium">{treatment.time}</span>
                </span>
              )}
              {t !== undefined && (
                <span className="inline-flex items-center gap-1.5 text-white/55" title="Frame index">
                  <span className="font-mono tabular-nums">T{t}</span>
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyLinkButton />
              <CompareToggle sample={selectedSample} />
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY (scrollable) ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
        {/* Media */}
        {(videos || images) && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-[11px] font-semibold text-white/50 uppercase tracking-widest flex items-center gap-2">
                {videos ? (
                  <>
                    <Video size={13} strokeWidth={2} className="text-white/50" />
                    Cell movie
                  </>
                ) : (
                  <>
                    <Microscope size={13} strokeWidth={2} className="text-white/50" />
                    Images
                  </>
                )}
              </h4>
              {videos && videos.length >= 1 && (
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pause movie' : 'Play movie'}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-white/80 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
              )}
            </div>
            {videos ? (
              <div className="space-y-3">
                {videos.map((video, index) => {
                  const channelLabels = ['MitoTracker Green', 'TMRM'];
                  const channelLabel =
                    videos.length > 1 ? (channelLabels[index] ?? null) : null;
                  return (
                    <div
                      key={index}
                      className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.08]"
                      style={getAccentBorderStyle()}
                    >
                      <div className="relative aspect-square">
                        {videoLoadError[index] ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
                            <Video size={24} />
                            <p className="text-xs">Video unavailable</p>
                            <button
                              type="button"
                              onClick={() => retryVideo(index)}
                              className="h-7 px-3 rounded-md text-[11px] font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.10] transition-colors"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <>
                            <video
                              key={`${selectedSample.id}-${index}-${videoAttempt}`}
                              ref={(el) => (videoRefs.current[index] = el)}
                              src={video}
                              poster={index === 0 ? videoPoster : undefined}
                              preload="auto"
                              muted
                              playsInline
                              loop
                              onClick={togglePlayPause}
                              className="absolute inset-0 w-full h-full object-cover cursor-pointer"
                              onError={() => handleVideoError(index)}
                              onLoadStart={() => handleVideoLoadStart(index)}
                              onCanPlay={() => handleVideoCanPlay(index)}
                              onPlaying={() => handleVideoPlaying(index)}
                              onLoadedData={(e) => {
                                // Safari kick: start as soon as the first frame is ready.
                                if (isPlaying && e.currentTarget.paused) {
                                  e.currentTarget.muted = true;
                                  void e.currentTarget.play().catch(() => {});
                                }
                              }}
                              onTimeUpdate={handleTimeUpdate}
                              onEnded={handleVideoEnded}
                            />
                            {videoLoading[index] &&
                              (index === 0 && videoPoster ? (
                                <div className="absolute bottom-2 right-2 w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                </div>
                              ))}
                          </>
                        )}
                      </div>
                      {channelLabel && (
                        <p className="px-3 py-2 text-[11px] font-medium text-white/55 uppercase tracking-wide">
                          {channelLabel}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {images?.map((image, index) => (
                  <div
                    key={index}
                    className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.08]"
                    style={getAccentBorderStyle()}
                  >
                    <div className="relative aspect-square">
                      {imageLoadError[index] ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60">
                          <Microscope size={24} className="mb-2" />
                          <p className="text-xs">Image unavailable</p>
                        </div>
                      ) : (
                        <>
                          <img
                            src={image}
                            alt={`Sample ${index + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={() => handleImageError(index)}
                            onLoadStart={() => handleImageLoadStart(index)}
                            onLoad={() => handleImageLoad(index)}
                          />
                          {imageLoading[index] && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Compound — only when there is something to show. SMILES is its own
            row with a copy button; PubChem is an inline link. */}
        {hasCompoundData && (
          <section>
            <h4 className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Beaker size={13} strokeWidth={2} className="text-white/50" />
              Compound
            </h4>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/5">
              {treatment.smiles && (
                <div className="p-3.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-white/60 uppercase tracking-wider mb-1">
                      SMILES
                    </p>
                    <p className="text-[11px] font-mono text-white/85 break-all leading-relaxed">
                      {treatment.smiles}
                    </p>
                  </div>
                  <CopyChip value={treatment.smiles} label="Copy SMILES" />
                </div>
              )}
              {treatment.pubchem && (
                <div className="p-3.5 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold text-white/60 uppercase tracking-wider mb-0.5">
                      PubChem
                    </p>
                    <p className="text-xs font-mono text-white/75 tabular-nums">
                      CID {treatment.pubchem}
                    </p>
                  </div>
                  <a
                    href={`https://pubchem.ncbi.nlm.nih.gov/compound/${treatment.pubchem}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.10] hover:border-white/[0.18] transition-colors"
                  >
                    Open <ExternalLink size={11} strokeWidth={2} />
                  </a>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Metadata — power-user data. Collapsed by default to keep the
            primary read on the cell-movie + compound. */}
        {hasMetadata && (
          <section>
            <details className="group rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
              <summary className="list-none flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-white/[0.03]">
                <span className="text-[11px] font-semibold text-white/55 uppercase tracking-widest flex items-center gap-2">
                  <Database size={13} strokeWidth={2} className="text-white/50" />
                  Metadata
                  <span className="text-[10px] font-mono tabular-nums text-white/60 normal-case tracking-normal">
                    {metadataEntries.length}
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className="text-white/45 transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="border-t border-white/[0.06]">
                <table className="w-full text-sm">
                  <tbody>
                    {metadataEntries.map(([key, value]) => (
                      <tr key={key} className="border-b border-white/5 last:border-0">
                        <td className="py-2.5 px-4 font-medium text-white/50 capitalize align-top whitespace-nowrap">
                          {key.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2.5 px-4 text-white/90 break-all">{String(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}
      </div>
    </div>
  );
};

export default SamplePanel;
