import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Video, ChevronUp, Play, Pause } from 'lucide-react';
import type { Sample } from '../types';
import { selectDrugRepresentatives } from '../utils/drugStripSamples';
import { usePosterManifest } from '../utils/posterManifest';
import { conditionLabel } from '../constants/conditions';
import { prefersReducedMotion } from '../utils/motion';
import LazyVideo from './LazyVideo';

interface DrugConditionStripProps {
  /** Pool of samples to draw one representative per drug from. */
  samples: Sample[];
  /** false = one-row rail of condition chips; true = one movie per condition. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Called when the user clicks a card or chip. */
  onSelectSample?: (sample: Sample, event: React.MouseEvent) => void;
  /** Hold every movie (e.g. while the comparison covers the strip). */
  paused?: boolean;
  /** Each compared cell's number in the comparison. */
  compareNumbers?: ReadonlyMap<string, number>;
  /** Picking cells to compare: a click adds the cell instead of opening it. */
  picking?: boolean;
}

const PILL_BASE =
  'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border transition-all duration-150 shrink-0';
const PILL_ACTIVE = 'bg-white/[0.12] border-white/[0.22] text-white';
const PILL_IDLE =
  'bg-white/[0.04] border-white/[0.08] text-white/85 hover:bg-white/[0.08] hover:border-white/[0.14]';

function treatmentAccentCss(sample: Sample): string {
  const { r, g, b } = sample.color;
  const rr = Math.round((r ?? 0) * 255);
  const gg = Math.round((g ?? 0) * 255);
  const bb = Math.round((b ?? 0) * 255);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

/** Let a plain mouse wheel scroll a horizontal row. */
function scrollSideways(e: React.WheelEvent<HTMLDivElement>) {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
}

const EDGE_FADE_PX = 40;

function tileTitle(label: string, picking: boolean, inComparison: boolean, otherwise: string): string {
  if (!picking) return otherwise;
  return inComparison ? `Remove this ${label} cell from the comparison` : `Add this ${label} cell to the comparison`;
}

const DrugConditionStrip: React.FC<DrugConditionStripProps> = ({
  samples,
  expanded,
  onToggleExpanded,
  onSelectSample,
  paused = false,
  compareNumbers,
  picking = false,
}) => {
  const cards = useMemo(() => selectDrugRepresentatives(samples), [samples]);
  const posters = usePosterManifest();

  const videoIndex = 0;
  const videoCount = cards.filter((c) => c.sample.videos?.[videoIndex]).length;
  const hasVideos = videoCount > 0;

  const [isPlaying, setIsPlaying] = useState(() => !prefersReducedMotion());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fade whichever edge has more cards beyond it.
  const [edges, setEdges] = useState({ start: true, end: true });
  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateEdges, expanded, cards.length]);
  const edgeMask = `linear-gradient(to right, ${edges.start ? 'black' : 'transparent'} 0, black ${EDGE_FADE_PX}px, black calc(100% - ${EDGE_FADE_PX}px), ${edges.end ? 'black' : 'transparent'} 100%)`;

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  if (cards.length === 0) return null;

  if (!expanded) {
    return (
      <div className="shrink-0 h-11 border-b border-white/[0.08] bg-black/95 flex items-center gap-3 px-6 animate-fade-in-soft">
        <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wider shrink-0">
          Conditions
          <span className="ml-1.5 tabular-nums text-white/60">{cards.length}</span>
        </p>
        <div
          className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]"
          onWheel={scrollSideways}
        >
          {cards.map(({ drug, sample }) => {
            const n = compareNumbers?.get(sample.id);
            return (
              <button
                key={drug}
                type="button"
                onClick={(e) => onSelectSample?.(sample, e)}
                title={tileTitle(conditionLabel(drug), picking, n !== undefined, `Show a ${conditionLabel(drug)} cell`)}
                className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium text-white/80 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: treatmentAccentCss(sample) }}
                  aria-hidden="true"
                />
                {conditionLabel(drug)}
                {n !== undefined && (
                  <>
                    <span
                      className="h-4 min-w-[16px] rounded-full bg-white px-1 text-center text-[10px] font-semibold leading-4 text-black tabular-nums"
                      aria-hidden="true"
                    >
                      {n}
                    </span>
                    <span className="sr-only">, cell {n} in the comparison</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {hasVideos && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={false}
            title="Show one representative movie per condition"
            className={`${PILL_BASE} ${PILL_IDLE}`}
          >
            <Video size={12} />
            <span>Show movies</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-white/[0.08] bg-black/95 backdrop-blur-sm animate-fade-in-soft">
      <div className="flex items-center justify-between px-6 pt-3 pb-2 gap-4">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-xs font-semibold text-white/85 uppercase tracking-wider truncate">
            Drug conditions
          </p>
          <p className="text-[11px] text-white/60 tabular-nums shrink-0">
            {cards.length} condition{cards.length === 1 ? '' : 's'} · one representative cell each
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
            onClick={onToggleExpanded}
            aria-expanded
            className={`${PILL_BASE} ${PILL_IDLE}`}
            title="Collapse to the condition list"
          >
            <ChevronUp size={12} />
            <span>Hide movies</span>
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={updateEdges}
        onWheel={scrollSideways}
        className="px-6 pb-4 flex gap-2.5 overflow-x-auto scrollbar-thin"
        style={{ maskImage: edgeMask, WebkitMaskImage: edgeMask }}
      >
        {cards.map(({ drug, sample }) => {
          const n = compareNumbers?.get(sample.id);
          return (
            <button
              key={drug}
              type="button"
              onClick={(e) => onSelectSample?.(sample, e)}
              title={tileTitle(conditionLabel(drug), picking, n !== undefined, conditionLabel(drug))}
              className={`shrink-0 w-[112px] rounded-xl overflow-hidden border bg-white/[0.03] group hover:ring-1 hover:ring-white/20 transition-all text-left focus:outline-none focus:ring-1 focus:ring-white/30 ${
                n !== undefined ? 'border-white/60' : 'border-white/[0.08] hover:border-white/25'
              }`}
            >
              <div
                className="h-[3px] w-full"
                style={{ background: treatmentAccentCss(sample) }}
                aria-hidden="true"
              />
              <div className="aspect-square relative bg-white/[0.04]">
                {sample.videos?.[videoIndex] ? (
                  // Wait for the manifest so the tile never starts the 1.3 MB original instead of its clip.
                  posters && (
                    <LazyVideo
                      src={posters.clipById?.[String(sample.id)] ?? sample.videos[videoIndex]}
                      poster={posters.byDrug[drug] ?? posters.byId[String(sample.id)]}
                      posterPriority
                      alt={conditionLabel(drug)}
                      shouldPlay={isPlaying && !paused}
                      unloadWhenHidden={false}
                      // Tiles about three cards past either edge are already playing in phase when scrolled in.
                      rootRef={scrollRef}
                      rootMargin="0px 360px"
                      className="w-full h-full pointer-events-none"
                    />
                  )
                ) : sample.images?.[0] ? (
                  <img
                    src={sample.images[0]}
                    alt={conditionLabel(drug)}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                    <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center">
                      <Video size={20} className="text-white/30" />
                    </div>
                  </div>
                )}
                {n !== undefined && (
                  <span
                    className="absolute left-1.5 top-1.5 h-5 min-w-[20px] rounded-full bg-white px-1 text-center text-[11px] font-semibold leading-5 text-black shadow-elevated tabular-nums"
                    aria-hidden="true"
                  >
                    {n}
                  </span>
                )}
              </div>
              <div className="px-2 py-1.5 flex items-center gap-1 min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: treatmentAccentCss(sample) }}
                  aria-hidden="true"
                />
                <p className="text-[11px] font-medium text-white/90 truncate">{conditionLabel(drug)}</p>
                {n !== undefined && <span className="sr-only">, cell {n} in the comparison</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DrugConditionStrip;
