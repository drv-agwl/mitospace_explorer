import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, LocateFixed, Pause, Play, Plus, StepBack, StepForward, X } from 'lucide-react';
import { MAX_COMPARE_CELLS, useSample } from '../context/SampleContext';
import type { DatasetVersion, Sample } from '../types';
import { conditionLabel, conditionMechanism } from '../constants/conditions';
import { getFeatureGroups } from '../constants/features';
import { formatFeatureValue, formatPercentile } from '../utils/formatFeature';
import { rgbCss } from '../utils/colorUtils';
import { prefersReducedMotion } from '../utils/motion';
import { largePosterForId, usePosterManifest } from '../utils/posterManifest';
import { getCellFeatures } from '../api/client';
import { MOVIE_FPS, RECORDED_FRAMES, useSyncedMovies, type SyncedMovies } from '../hooks/useSyncedMovies';
import { trackEvent } from '../analytics';

type Measurement = { value: number | null; percentile: number | null };

/** Measurements by dataset row. Only rows not seen yet are requested, so removing a cell costs nothing. */
function useCellMeasurements(rows: number[], version: DatasetVersion, unavailable: boolean) {
  const store = useRef({
    byRow: new Map<number, Map<string, Measurement>>(),
    medians: new Map<string, number | null>(),
  });
  const [, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const missingKey = rows.filter((row) => !store.current.byRow.has(row)).join(',');

  useEffect(() => {
    if (unavailable || !missingKey) return;
    let cancelled = false;
    setFailed(false);
    getCellFeatures(missingKey.split(',').map(Number), version)
      .then((res) => {
        if (cancelled) return;
        res.cells.forEach((row, i) => {
          const byFeature = new Map<string, Measurement>();
          for (const f of res.features) byFeature.set(f.name, { value: f.values[i], percentile: f.percentiles[i] });
          store.current.byRow.set(row, byFeature);
        });
        for (const f of res.features) store.current.medians.set(f.name, f.median);
        setRevision((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [missingKey, version, unavailable, attempt]);

  return {
    loading: !unavailable && !failed && missingKey !== '',
    failed: !unavailable && failed,
    byRow: store.current.byRow,
    medians: store.current.medians,
    retry: () => setAttempt((n) => n + 1),
  };
}

const ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white';
const SMALL_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white';
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const NumberBadge: React.FC<{ n: number }> = ({ n }) => (
  <span className="h-5 min-w-[20px] shrink-0 rounded-full bg-white px-1 text-center text-[11px] font-semibold leading-5 text-black tabular-nums">
    {n}
  </span>
);

const CopyLinkButton: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      trackEvent('copy_link', { where: 'compare' });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is best-effort (permissions / insecure context).
    }
  };
  return (
    <button type="button" onClick={onCopy} title="Copy a link that opens this comparison" className={SMALL_BUTTON}>
      {copied ? <Check size={13} strokeWidth={2.5} /> : <Link2 size={13} />}
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
};

/** Play, pause and step every movie together. */
const Transport: React.FC<{ sync: SyncedMovies }> = ({ sync }) => {
  const [liveFrame, setLiveFrame] = useState(sync.pausedFrame);
  const { playing, currentFrame } = sync;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setLiveFrame(currentFrame());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentFrame]);
  const frame = playing ? liveFrame : sync.pausedFrame;

  return (
    <div
      role="group"
      aria-label="Playback of all movies"
      className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] px-6"
    >
      <button
        type="button"
        onClick={() => sync.showFrame(frame - 1)}
        aria-label="Previous frame"
        title="Previous frame (←)"
        className={ICON_BUTTON}
      >
        <StepBack size={16} />
      </button>
      <button
        type="button"
        onClick={sync.toggle}
        aria-label={playing ? 'Pause all movies' : 'Play all movies'}
        title="Play or pause (Space)"
        className="inline-flex h-9 w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white text-sm font-semibold text-black transition-colors hover:bg-gray-100"
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
        {playing ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        onClick={() => sync.showFrame(frame + 1)}
        aria-label="Next frame"
        title="Next frame (→)"
        className={ICON_BUTTON}
      >
        <StepForward size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={sync.frameCount - 1}
        step={1}
        value={frame}
        onChange={(e) => sync.showFrame(Number(e.target.value))}
        aria-label="Frame"
        aria-valuetext={`Frame ${frame + 1} of ${sync.frameCount}. ${RECORDED_FRAMES} frames recorded on the lattice light-sheet microscope, played back here at ${MOVIE_FPS} frames per second.`}
        className="mx-2 w-full max-w-md cursor-pointer accent-white"
      />
      <span
        className="shrink-0 text-xs leading-tight text-white/65 tabular-nums"
        title={`Recorded as ${RECORDED_FRAMES} frames on the lattice light-sheet microscope. Playback here is ${MOVIE_FPS} frames per second, so this file has more pictures than the ${RECORDED_FRAMES} that were acquired.`}
      >
        <span className="block">Frame {frame + 1} of {sync.frameCount}</span>
        <span className="block text-white/40">
          {RECORDED_FRAMES} LLSM frames, played back at {MOVIE_FPS} fps
        </span>
      </span>
      <p className="ml-auto hidden shrink-0 text-[11px] text-white/40 xl:block">
        All movies show the same frame · Space plays or pauses · ← → step
      </p>
    </div>
  );
};

const CompareMovie: React.FC<{ sample: Sample; sync: SyncedMovies; poster?: string }> = ({
  sample,
  sync,
  poster,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = sample.videos?.[0];
  const label = conditionLabel(sample.treatment.drug);

  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
      {src && !failed ? (
        <video
          key={attempt}
          ref={sync.bind(sample.id)}
          src={src}
          poster={poster}
          muted
          playsInline
          loop
          preload="auto"
          aria-label={`Movie of a ${label} cell`}
          onLoadedMetadata={sync.onLoadedMetadata}
          onCanPlay={() => {
            setLoaded(true);
            sync.onCanPlay(sample.id);
          }}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <p className="text-xs">Movie unavailable</p>
          {src && (
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setLoaded(false);
                setAttempt((n) => n + 1);
              }}
              className={SMALL_BUTTON}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!loaded && !failed && (
        <div
          className="absolute bottom-2 right-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

const ValueCell: React.FC<{ measurement?: Measurement; color: string; loading: boolean }> = ({
  measurement,
  color,
  loading,
}) => {
  if (!measurement) {
    return loading ? (
      <div className="space-y-2 py-1" aria-hidden="true">
        <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.08]" />
        <div className="h-1.5 w-full animate-pulse rounded-full bg-white/[0.06]" />
      </div>
    ) : (
      <p className="text-sm text-white/35">—</p>
    );
  }
  const { value, percentile } = measurement;
  if (value === null || percentile === null) {
    return <p className="text-sm text-white/40">No measurement</p>;
  }
  return (
    <div>
      <p className="text-sm font-medium text-white/90 tabular-nums">{formatFeatureValue(value)}</p>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-white/[0.08]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ width: `${Math.max(2, percentile)}%`, background: color }}
        />
        <div className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px bg-white/40" aria-hidden="true" />
      </div>
      <p className="mt-1 text-[11px] text-white/50 tabular-nums">{formatPercentile(percentile)} percentile</p>
    </div>
  );
};

/** Side-by-side view of the compared cells: frame-locked movies and every measurement. */
const CompareView: React.FC<{ leaving: boolean }> = ({ leaving }) => {
  const {
    compareSamples,
    compareRows,
    compareHidden,
    removeFromCompare,
    setCompareOpen,
    setComparePicking,
    focusOnMap,
    apiRowOrderMismatch,
    datasetVersion,
  } = useSample();
  const posters = usePosterManifest();
  const ids = useMemo(() => compareSamples.map((s) => s.id), [compareSamples]);
  const [autoplay] = useState(() => !prefersReducedMotion());
  const sync = useSyncedMovies(ids, autoplay);
  const measurements = useCellMeasurements(compareRows, datasetVersion, apiRowOrderMismatch);
  const featureGroups = getFeatureGroups(datasetVersion);
  const rootRef = useRef<HTMLElement>(null);
  const close = () => setCompareOpen(false);
  const addCells = () => {
    setCompareOpen(false);
    setComparePicking(true, 'view');
  };

  // While open, the explorer it covers is inert (Tab stays here); on close, focus returns to the opener.
  useEffect(() => {
    const root = rootRef.current;
    if (leaving || !root) return;
    const opener = document.activeElement as HTMLElement | null;
    const covered = Array.from(root.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el !== root && el instanceof HTMLElement
    );
    covered.forEach((el) => (el.inert = true));
    root.focus();
    return () => {
      covered.forEach((el) => (el.inert = false));
      if (opener?.isConnected) opener.focus();
    };
  }, [leaving]);

  const { toggle, showFrame, currentFrame, playing, pausedFrame } = sync;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const onScrubber = target instanceof HTMLInputElement && target.type === 'range';
      if (e.key === 'Escape' && onScrubber) {
        // The global Esc handler ignores inputs.
        e.preventDefault();
        setCompareOpen(false);
      } else if (e.key === ' ' && (onScrubber || !target?.closest?.('button, input, select, textarea, a'))) {
        e.preventDefault();
        toggle();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(target instanceof HTMLInputElement)) {
        e.preventDefault();
        const frame = playing ? currentFrame() : pausedFrame;
        showFrame(frame + (e.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, showFrame, currentFrame, playing, pausedFrame, setCompareOpen]);

  const showOnMap = (sample: Sample) => {
    setCompareOpen(false);
    focusOnMap(sample);
    trackEvent('select_cell', { source: 'compare_view', condition: sample.treatment.drug, cell: sample.id });
  };

  const n = compareSamples.length;
  const columns = `minmax(116px, 180px) repeat(${n}, minmax(128px, 280px))`;
  const colors = compareSamples.map((s) => rgbCss(s.color));
  const rowLabel = 'sticky left-0 z-[5] bg-black pr-3';

  return (
    <section
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
      tabIndex={-1}
      className={`absolute inset-0 z-40 flex flex-col bg-black outline-none transition-opacity duration-150 ${
        leaving ? 'pointer-events-none opacity-0' : 'animate-slide-up'
      }`}
    >
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/[0.08] px-6">
        <div className="min-w-0">
          <h2 id="compare-title" className="text-base font-semibold tracking-tight text-white">
            Compare cells <span className="ml-1 font-normal text-white/45 tabular-nums">{n}</span>
          </h2>
        </div>
        <p className="hidden min-w-0 truncate text-xs text-white/50 lg:block">
          Frame-locked movies, with every measurement ranked among all measured cells
        </p>
        <div className="ml-auto flex items-center gap-2">
          {n < MAX_COMPARE_CELLS && (
            <button
              type="button"
              onClick={addCells}
              title="Back to the map to pick more cells"
              className={SMALL_BUTTON}
            >
              <Plus size={13} />
              Add cells
            </button>
          )}
          <CopyLinkButton />
          <button
            type="button"
            onClick={close}
            aria-label="Close the comparison"
            title="Close (Esc)"
            className={ICON_BUTTON}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <Transport sync={sync} />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {/* Centered while it fits; when it overflows it starts at the left edge, so nothing is cut off. */}
        <div
          className="grid justify-start gap-x-4 px-6 pb-12 [justify-content:safe_center]"
          style={{ gridTemplateColumns: columns }}
        >
          {/* Column heads stay in view while the measurements scroll. */}
          <div className="sticky left-0 top-0 z-20 bg-black" aria-hidden="true" />
          {compareSamples.map((sample, i) => {
            const label = conditionLabel(sample.treatment.drug);
            return (
              <div key={sample.id} className="sticky top-0 z-10 bg-black pb-3 pt-4">
                <div className="h-[3px] rounded-full" style={{ background: colors[i] }} />
                <div className="mt-2.5 flex items-center gap-2">
                  <NumberBadge n={i + 1} />
                  <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={label}>
                    {label}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(sample.id, 'view')}
                    aria-label={`Remove cell ${i + 1} (${label}) from the comparison`}
                    title="Remove from the comparison"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          <div className={`${rowLabel} pb-4 text-xs text-white/45`}>Treatment</div>
          {compareSamples.map((sample, i) => {
            const mechanism = conditionMechanism(sample.treatment.drug);
            const hidden = compareHidden[i];
            return (
              <div key={sample.id} className="min-w-0 pb-4">
                <p className="truncate text-xs text-white/75">
                  {sample.treatment.dose ?? '—'}
                  <span className="mx-1.5 text-white/30">·</span>
                  <span className="font-mono text-white/50">{sample.id}</span>
                </p>
                {mechanism && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/45" title={mechanism}>
                    {mechanism}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => showOnMap(sample)}
                  disabled={hidden}
                  title={hidden ? 'Hidden by the condition filter' : 'Close the comparison and show this cell on the map'}
                  className={`${SMALL_BUTTON} mt-2.5 h-7 px-2.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <LocateFixed size={12} />
                  Show on map
                </button>
              </div>
            );
          })}

          <div className={`${rowLabel} text-xs text-white/45`}>Movie</div>
          {compareSamples.map((sample) => (
            <CompareMovie
              key={sample.id}
              sample={sample}
              sync={sync}
              poster={largePosterForId(posters, sample.id)}
            />
          ))}

          {n === 1 && (
            <div className="col-span-full mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-white/[0.16] px-4 py-3">
              <p className="text-sm text-white/65">Add at least one more cell to compare.</p>
              <button type="button" onClick={addCells} className={SMALL_BUTTON}>
                <Plus size={13} />
                Add cells
              </button>
            </div>
          )}

          <div className="sticky left-0 col-span-full mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-white">Measurements</h3>
            <p className="text-xs text-white/45">
              Percentile: the share of all measured cells with a lower value. The tick on each bar marks the median.
            </p>
          </div>

          {measurements.failed || apiRowOrderMismatch ? (
            <div className="col-span-full mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3">
              <p className="text-sm text-white/65">
                {apiRowOrderMismatch
                  ? 'Measurements are unavailable: the API serves a different version of the dataset.'
                  : 'The measurements could not be loaded.'}
              </p>
              {!apiRowOrderMismatch && (
                <button type="button" onClick={measurements.retry} className={SMALL_BUTTON}>
                  Retry
                </button>
              )}
            </div>
          ) : (
            featureGroups.map((group) => (
              <React.Fragment key={group.category}>
                <p className="sticky left-0 col-span-full pb-2 pt-6 text-[11px] font-semibold uppercase tracking-widest text-white/45">
                  {sentenceCase(group.category)}
                </p>
                {group.features.map((feature) => {
                  const key = feature.apiName ?? feature.id;
                  const median = measurements.medians.get(key);
                  return (
                    <React.Fragment key={key}>
                      <div className={`${rowLabel} border-t border-white/[0.06] py-3`}>
                        <p className="text-sm text-white/85">{feature.label}</p>
                        {median != null && (
                          <p className="mt-0.5 text-[11px] text-white/45 tabular-nums">
                            Median {formatFeatureValue(median)}
                          </p>
                        )}
                      </div>
                      {compareSamples.map((sample, i) => (
                        <div key={sample.id} className="min-w-0 border-t border-white/[0.06] py-3">
                          <ValueCell
                            measurement={measurements.byRow.get(compareRows[i])?.get(key)}
                            color={colors[i]}
                            loading={measurements.loading}
                          />
                        </div>
                      ))}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

export default CompareView;
