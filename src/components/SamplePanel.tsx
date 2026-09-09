import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Microscope,
  Pill,
  Clock,
  Video,
  Play,
  Pause,
  MapPin,
  Database,
  Beaker,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useSample } from '../context/SampleContext';

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

const SamplePanel: React.FC = () => {
  const { selectedSample, visualizerOptions } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  // Autoplay muted inline (like the strip) so Safari reliably paints/plays.
  const [isPlaying, setIsPlaying] = useState(true);
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({});
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

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

  // Reset to playing whenever a new sample is selected so its clip autoplays.
  useEffect(() => {
    setIsPlaying(true);
  }, [selectedSample?.id]);

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

  const getContrastColor = () => {
    if (!sampleColor) return 'text-black';
    const luminance =
      0.299 * (sampleColor.r ?? 0) + 0.587 * (sampleColor.g ?? 0) + 0.114 * (sampleColor.b ?? 0);
    return luminance > 0.5 ? 'text-black' : 'text-white';
  };

  if (!selectedSample) {
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-black/95 border-l border-white/[0.08] backdrop-blur-sm">
        <div className="flex-1 flex flex-col items-center justify-center px-10 text-center">
          <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-5">
            <Microscope size={32} strokeWidth={1.5} className="text-white/30" />
          </div>
          <p className="text-base font-medium text-white/90 mb-2 tracking-tight">
            No sample selected
          </p>
          <p className="text-sm text-white/45 max-w-[260px] leading-relaxed">
            Click any point in the visualization to view sample details, media, and treatment data.
          </p>
        </div>
      </div>
    );
  }

  const { treatment, phenotype, x, y, z, t, videos, images, metadata } = selectedSample;
  const coordsString = `${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`;
  const hasCompoundData = Boolean(treatment.smiles || treatment.pubchem);
  const metadataEntries = Object.entries(metadata ?? {}).filter(
    ([key]) => key.toLowerCase() !== 'quality'
  );
  const hasMetadata = metadataEntries.length > 0;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-black/95 border-l border-white/[0.08] backdrop-blur-sm">
      {/* ── HEADER — left accent + phenotype chip colours match the cloud legend */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.08]">
        <div
          className="rounded-xl border border-white/[0.08] overflow-hidden bg-white/[0.03] flex"
          style={getAccentBorderStyle()}
        >
          <div className="p-4 flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <h3
                className="text-[20px] font-semibold text-white tracking-tight truncate leading-tight"
                title={treatment.drug}
              >
                {treatment.drug}
              </h3>
              {phenotype && (
                <span
                  className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${getContrastColor()}`}
                  style={getColorStyle()}
                  title="Morphological phenotype"
                >
                  {phenotype}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
              {treatment.dose && treatment.dose !== 'N/A' && (
                <span className="inline-flex items-center gap-1.5 text-white/75">
                  <Pill size={12} strokeWidth={2} className="text-white/45" />
                  <span className="font-medium">{treatment.dose}</span>
                </span>
              )}
              {treatment.time && treatment.time !== 'N/A' && (
                <span className="inline-flex items-center gap-1.5 text-white/75">
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

            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
              <MapPin size={11} strokeWidth={2} className="text-white/40 shrink-0" />
              <span className="font-mono tabular-nums">({coordsString})</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY (scrollable) ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
        {/* Media */}
        {(videos || images) && (
          <section>
            <h4 className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-3 flex items-center gap-2">
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
            {videos ? (
              <div className="space-y-3">
                {videos.length >= 1 && (
                  <button onClick={togglePlayPause} className="btn-primary w-full text-sm">
                    {isPlaying ? (
                      <>
                        <Pause size={14} className="mr-2" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play size={14} className="mr-2" />
                        {videos.length > 1 ? 'Play all' : 'Play'}
                      </>
                    )}
                  </button>
                )}
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
                      <div className="relative aspect-video">
                        {videoLoadError[index] ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
                            <Video size={24} className="mb-2" />
                            <p className="text-xs">Video unavailable</p>
                          </div>
                        ) : (
                          <>
                            <video
                              key={`${selectedSample.id}-${index}`}
                              ref={(el) => (videoRefs.current[index] = el)}
                              src={video}
                              preload="metadata"
                              muted
                              playsInline
                              loop
                              autoPlay={isPlaying}
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={() => handleVideoError(index)}
                              onLoadStart={() => handleVideoLoadStart(index)}
                              onCanPlay={() => handleVideoCanPlay(index)}
                              onLoadedData={(e) => {
                                // Safari sometimes needs an explicit play kick.
                                if (isPlaying) void e.currentTarget.play().catch(() => {});
                              }}
                              onTimeUpdate={handleTimeUpdate}
                              onEnded={handleVideoEnded}
                            />
                            {videoLoading[index] && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              </div>
                            )}
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
                    <div className="relative aspect-video">
                      {imageLoadError[index] ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
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
                    <p className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-1">
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
                    <p className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-0.5">
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
                  <span className="text-[10px] font-mono tabular-nums text-white/35 normal-case tracking-normal">
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
