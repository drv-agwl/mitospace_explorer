import React, { useEffect, useRef } from 'react';
import { X, Video, Microscope } from 'lucide-react';
import { Sample } from '../types';

/**
 * CellCard — one tile in the comparison gallery: a looping cell movie plus a
 * compact label. Playback is driven by the parent (synchronised across all
 * cards). Clicking the card focuses that cell (highlights its point in 3D and
 * shows its full detail below the grid).
 */

interface CellCardProps {
  sample: Sample;
  active: boolean;
  onFocus: () => void;
  onRemove: () => void;
  /** Register/unregister this card's <video> with the parent for sync control. */
  registerVideo: (el: HTMLVideoElement | null) => void;
  /** The master card drives the shared clock. */
  isMaster: boolean;
  onMasterTime: (time: number) => void;
}

const CellCard: React.FC<CellCardProps> = ({
  sample,
  active,
  onFocus,
  onRemove,
  registerVideo,
  isMaster,
  onMasterTime,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const media = sample.videos?.[0] ?? sample.images?.[0] ?? null;
  const isVideo = Boolean(sample.videos?.[0]);

  useEffect(() => {
    if (!isVideo) return;
    registerVideo(videoRef.current);
    return () => registerVideo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, sample.id]);

  const c = sample.color;
  const dot = c
    ? `rgb(${Math.round((c.r ?? 0) * 255)}, ${Math.round((c.g ?? 0) * 255)}, ${Math.round((c.b ?? 0) * 255)})`
    : 'rgba(255,255,255,0.4)';

  return (
    <div
      onClick={onFocus}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-white/[0.03] transition-all ${
        active
          ? 'border-cyan-300/60 ring-1 ring-cyan-300/40'
          : 'border-white/[0.08] hover:border-white/20'
      }`}
    >
      <div className="relative aspect-square bg-black/40">
        {media ? (
          isVideo ? (
            <video
              ref={(el) => {
                videoRef.current = el;
              }}
              src={media}
              preload="metadata"
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              onTimeUpdate={
                isMaster ? (e) => onMasterTime(e.currentTarget.currentTime) : undefined
              }
            />
          ) : (
            <img src={media} alt={sample.treatment.drug} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/30">
            {isVideo ? <Video size={20} /> : <Microscope size={20} />}
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100"
          title="Remove from comparison"
        >
          <X size={13} strokeWidth={2.5} />
        </button>

        {/* Label overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/20" style={{ backgroundColor: dot }} />
            <span className="truncate text-[12px] font-semibold text-white" title={sample.treatment.drug}>
              {sample.treatment.drug}
            </span>
          </div>
          {(sample.treatment.dose && sample.treatment.dose !== 'N/A') || sample.phenotype ? (
            <p className="mt-0.5 truncate text-[10px] text-white/55">
              {[sample.treatment.dose !== 'N/A' ? sample.treatment.dose : null, sample.phenotype]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default CellCard;
