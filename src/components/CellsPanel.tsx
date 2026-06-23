import React, { useCallback, useRef, useState } from 'react';
import { Microscope, Play, Pause, Plus, Trash2, GitCompare, Sparkles } from 'lucide-react';
import { useSample, MAX_COMPARISON } from '../context/SampleContext';
import { Sample } from '../types';
import CellDetail from './CellDetail';
import CellCard from './CellCard';

/**
 * CellsPanel — the comparison-aware cell workspace (the "Cells" dock tab).
 *
 * Three states:
 *   • empty   — nothing selected/pinned
 *   • single  — one cell (focused click or a single pinned cell): full detail
 *   • gallery — ≥2 pinned cells: a synced movie grid + detail for the active one
 *
 * Cells enter the comparison set via the "Add to comparison" button or the
 * agent (open_cell). The focused cell (from a 3D click) is highlighted in the
 * atlas; clicking a card re-focuses that cell.
 */

const CellsPanel: React.FC = () => {
  const {
    selectedSample,
    selectedPointIndex,
    comparisonCells,
    addComparisonCell,
    removeComparisonCell,
    clearComparison,
    setSelectedSample,
    setSelectedPointIndex,
    samples4D,
  } = useSample();

  const pinned = comparisonCells;
  const pinnedHas = (id: string) => pinned.some((c) => c.sample.id === id);
  const focused = selectedSample;
  const focusedIsPinned = focused ? pinnedHas(focused.id) : false;
  const gallery = pinned.length >= 2;
  const anyVideo = pinned.some((c) => (c.sample.videos?.length ?? 0) > 0);

  // ── Synchronised playback across gallery cards ───────────────────────────
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);

  const registerVideo = useCallback(
    (id: string) => (el: HTMLVideoElement | null) => {
      if (el) videosRef.current.set(id, el);
      else videosRef.current.delete(id);
    },
    [],
  );

  const playAll = useCallback(() => {
    setIsPlaying(true);
    videosRef.current.forEach((v) => void v.play().catch(() => {}));
  }, []);
  const pauseAll = useCallback(() => {
    setIsPlaying(false);
    videosRef.current.forEach((v) => v.pause());
  }, []);

  const onMasterTime = useCallback((time: number) => {
    videosRef.current.forEach((v) => {
      if (Math.abs(v.currentTime - time) > 0.18) v.currentTime = time;
    });
  }, []);

  const focusSample = useCallback(
    (sample: Sample, index: number | null) => {
      const idx = index ?? samples4D.findIndex((s) => s.id === sample.id);
      setSelectedSample(sample);
      setSelectedPointIndex(idx >= 0 ? idx : null);
    },
    [samples4D, setSelectedSample, setSelectedPointIndex],
  );

  const addFocused = useCallback(() => {
    if (focused) addComparisonCell(focused, selectedPointIndex);
  }, [focused, selectedPointIndex, addComparisonCell]);

  // ── EMPTY ────────────────────────────────────────────────────────────────
  if (pinned.length === 0 && !focused) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.04]">
          <GitCompare size={30} strokeWidth={1.5} className="text-white/30" />
        </div>
        <p className="mb-2 text-base font-medium tracking-tight text-white/90">No cells selected</p>
        <p className="max-w-[260px] text-sm leading-relaxed text-white/45">
          Click any point to inspect a cell, then <span className="text-white/70">add it to comparison</span> to
          view several cells side by side. Or ask the agent to open cells for you.
        </p>
      </div>
    );
  }

  // The cell whose full detail is shown beneath the gallery / in single mode.
  const activeSample: Sample | null = gallery
    ? focusedIsPinned
      ? focused
      : pinned[0].sample
    : pinned[0]?.sample ?? focused;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar (only once something is pinned) */}
      {pinned.length >= 1 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/70">
            <GitCompare size={13} className="text-cyan-300/70" />
            Comparing {pinned.length}
            <span className="font-normal text-white/35">/ {MAX_COMPARISON}</span>
          </span>
          <div className="flex items-center gap-1.5">
            {anyVideo && (
              <button
                onClick={isPlaying ? pauseAll : playAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.1]"
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                {isPlaying ? 'Pause' : 'Play all'}
              </button>
            )}
            <button
              onClick={clearComparison}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/80"
              title="Clear comparison"
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
        {/* Current selection banner — focused cell not yet in the set */}
        {focused && !focusedIsPinned && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-cyan-300/25 bg-cyan-400/[0.07] p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200/70">Current selection</p>
              <p className="truncate text-[13px] font-semibold text-white" title={focused.treatment.drug}>
                {focused.treatment.drug}
              </p>
            </div>
            <button
              onClick={addFocused}
              disabled={pinned.length >= MAX_COMPARISON}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
              title={pinned.length >= MAX_COMPARISON ? `Limit ${MAX_COMPARISON} cells` : 'Add to comparison'}
            >
              <Plus size={13} strokeWidth={2.5} /> Compare
            </button>
          </div>
        )}

        {/* GALLERY — synced movie grid */}
        {gallery && (
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            {pinned.map((c, i) => (
              <CellCard
                key={c.sample.id}
                sample={c.sample}
                active={focused?.id === c.sample.id}
                onFocus={() => focusSample(c.sample, c.index)}
                onRemove={() => removeComparisonCell(c.sample.id)}
                registerVideo={registerVideo(c.sample.id)}
                isMaster={i === 0}
                onMasterTime={onMasterTime}
              />
            ))}
          </div>
        )}

        {/* SINGLE-mode add CTA: focused, nothing pinned yet */}
        {pinned.length === 0 && focused && (
          <button
            onClick={addFocused}
            className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08]"
          >
            <Plus size={14} strokeWidth={2.5} /> Add to comparison
          </button>
        )}

        {/* DETAIL — full read-out for the active cell */}
        {activeSample && (
          <>
            {gallery && (
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                <Microscope size={12} /> Detail · {activeSample.treatment.drug}
              </div>
            )}
            <CellDetail sample={activeSample} hideMedia={gallery} />
          </>
        )}

        {/* Hint when a single cell is pinned */}
        {pinned.length === 1 && !focused && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[12px] text-white/35">
            <Sparkles size={12} className="text-cyan-300/50" />
            Add another cell to compare them side by side.
          </p>
        )}
      </div>
    </div>
  );
};

export default CellsPanel;
