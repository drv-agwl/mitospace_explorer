import React, { useCallback, useRef, useState } from 'react';
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
import { Sample } from '../types';
import { useSample } from '../context/SampleContext';

/**
 * CellDetail — the full read-out for a single cell (movie, compound, metadata).
 *
 * Extracted from the old SamplePanel so it can be reused both as the standalone
 * single-cell view and as the expanded detail beneath the comparison gallery.
 * It takes the sample as a prop (no longer hard-wired to `selectedSample`),
 * which is what lets the Cells panel show details for any pinned cell.
 */

const CopyChip: React.FC<{ value: string; label?: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // best-effort
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

interface CellDetailProps {
  sample: Sample;
  /** Hide the movie/images block (used when the gallery already shows it). */
  hideMedia?: boolean;
}

const CellDetail: React.FC<CellDetailProps> = ({ sample, hideMedia = false }) => {
  const { visualizerOptions } = useSample();
  const [videoLoadError, setVideoLoadError] = useState<Record<number, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<number, boolean>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({});
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const togglePlayPause = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    videoRefs.current.forEach((v) => {
      if (v) next ? v.play() : v.pause();
    });
  };

  const handleTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const cur = event.currentTarget;
    videoRefs.current.forEach((v) => {
      if (v && v !== cur && Math.abs(v.currentTime - cur.currentTime) > 0.1) {
        v.currentTime = cur.currentTime;
      }
    });
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    videoRefs.current.forEach((v) => {
      if (v) v.currentTime = 0;
    });
  };

  const sampleColor =
    visualizerOptions.coloringMode === 'phenotype'
      ? sample.color_phenotypic ?? sample.color
      : sample.color;

  const colorStyle = sampleColor
    ? { backgroundColor: `rgb(${(sampleColor.r ?? 0) * 255}, ${(sampleColor.g ?? 0) * 255}, ${(sampleColor.b ?? 0) * 255})` }
    : {};
  const accentBorder = sampleColor
    ? {
        borderLeftWidth: 4,
        borderLeftColor: `rgb(${Math.round((sampleColor.r ?? 0) * 255)}, ${Math.round((sampleColor.g ?? 0) * 255)}, ${Math.round((sampleColor.b ?? 0) * 255)})`,
      }
    : {};
  const contrast = sampleColor
    ? 0.299 * (sampleColor.r ?? 0) + 0.587 * (sampleColor.g ?? 0) + 0.114 * (sampleColor.b ?? 0) > 0.5
      ? 'text-black'
      : 'text-white'
    : 'text-black';

  const { treatment, phenotype, x, y, z, t, videos, images, metadata } = sample;
  const coords = `${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`;
  const hasCompound = Boolean(treatment.smiles || treatment.pubchem);
  const metadataEntries = Object.entries(metadata ?? {}).filter(
    ([key]) => key.toLowerCase() !== 'quality',
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-white/[0.08] overflow-hidden bg-white/[0.03] flex" style={accentBorder}>
        <div className="p-4 flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[18px] font-semibold text-white tracking-tight truncate leading-tight" title={treatment.drug}>
              {treatment.drug}
            </h3>
            {phenotype && (
              <span
                className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${contrast}`}
                style={colorStyle}
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
            <span className="font-mono tabular-nums">({coords})</span>
          </div>
        </div>
      </div>

      {/* Media */}
      {!hideMedia && (videos || images) && (
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
                const channelLabel = videos.length > 1 ? channelLabels[index] ?? null : null;
                return (
                  <div key={index} className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.08]" style={accentBorder}>
                    <div className="relative aspect-video">
                      {videoLoadError[index] ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
                          <Video size={24} className="mb-2" />
                          <p className="text-xs">Video unavailable</p>
                        </div>
                      ) : (
                        <>
                          <video
                            ref={(el) => (videoRefs.current[index] = el)}
                            src={video}
                            preload="metadata"
                            loop
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={() => setVideoLoadError((p) => ({ ...p, [index]: true }))}
                            onLoadStart={() => setVideoLoading((p) => ({ ...p, [index]: true }))}
                            onCanPlay={() => setVideoLoading((p) => ({ ...p, [index]: false }))}
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
                      <p className="px-3 py-2 text-[11px] font-medium text-white/55 uppercase tracking-wide">{channelLabel}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {images?.map((image, index) => (
                <div key={index} className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.08]" style={accentBorder}>
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
                          onError={() => setImageLoadError((p) => ({ ...p, [index]: true }))}
                          onLoadStart={() => setImageLoading((p) => ({ ...p, [index]: true }))}
                          onLoad={() => setImageLoading((p) => ({ ...p, [index]: false }))}
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

      {/* Compound */}
      {hasCompound && (
        <section>
          <h4 className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Beaker size={13} strokeWidth={2} className="text-white/50" />
            Compound
          </h4>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/5">
            {treatment.smiles && (
              <div className="p-3.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-1">SMILES</p>
                  <p className="text-[11px] font-mono text-white/85 break-all leading-relaxed">{treatment.smiles}</p>
                </div>
                <CopyChip value={treatment.smiles} label="Copy SMILES" />
              </div>
            )}
            {treatment.pubchem && (
              <div className="p-3.5 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold text-white/45 uppercase tracking-wider mb-0.5">PubChem</p>
                  <p className="text-xs font-mono text-white/75 tabular-nums">CID {treatment.pubchem}</p>
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

      {/* Metadata */}
      {metadataEntries.length > 0 && (
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
              <ChevronDown size={14} strokeWidth={2} className="text-white/45 transition-transform group-open:rotate-180" />
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
  );
};

export default CellDetail;
