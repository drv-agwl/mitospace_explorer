import React, { useEffect } from 'react';
import { Columns3, Plus, X } from 'lucide-react';
import { MAX_COMPARE_CELLS, useSample } from '../context/SampleContext';
import { conditionLabel } from '../constants/conditions';
import { rgbCss } from '../utils/colorUtils';
import { trackEvent } from '../analytics';

const SECONDARY_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.14] px-2.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.08] hover:text-white';

/** Cells collected for comparison, shown over the map's bottom-right corner. */
const CompareTray: React.FC<{ fullNotice: boolean }> = ({ fullNotice }) => {
  const {
    compareSamples,
    compareHidden,
    removeFromCompare,
    clearCompare,
    setCompareOpen,
    focusOnMap,
    comparePicking,
    setComparePicking,
  } = useSample();
  const count = compareSamples.length;

  // Fetch the comparison view's code as soon as a comparison is likely.
  useEffect(() => {
    if (count > 0 || comparePicking) void import('./CompareView');
  }, [count, comparePicking]);

  if (count === 0 && !comparePicking) return null;
  const canCompare = count >= 2;
  const full = count >= MAX_COMPARE_CELLS;
  // Beyond three cells the chips drop their labels (still in the tooltip) so the tray stays one row.
  const compact = count > 3;
  const status =
    fullNotice && full
      ? `Up to ${MAX_COMPARE_CELLS} cells`
      : !comparePicking
        ? ''
        : count === 0
          ? `Click cells to add them, up to ${MAX_COMPARE_CELLS}`
          : count === 1
            ? 'Pick one more cell'
            : '';

  return (
    <div
      role="region"
      aria-label="Cells to compare"
      className={`absolute bottom-4 right-4 z-20 flex max-w-[calc(100%-17rem)] flex-wrap items-center justify-end gap-2 rounded-2xl border bg-black/80 p-2 shadow-elevated backdrop-blur-md animate-slide-up ${
        comparePicking ? 'border-white/30' : 'border-white/[0.12]'
      }`}
    >
      {count > 0 && (
        <ol className={`flex min-w-0 flex-wrap items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
          {compareSamples.map((sample, i) => {
            const label = conditionLabel(sample.treatment.drug);
            const hidden = compareHidden[i];
            return (
              <li key={sample.id} className="shrink-0">
                <div className="flex h-8 items-center rounded-lg border border-white/[0.1] bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => {
                      focusOnMap(sample);
                      trackEvent('select_cell', { source: 'compare_tray', condition: sample.treatment.drug, cell: sample.id });
                    }}
                    disabled={hidden}
                    title={hidden ? `${label}: hidden by the condition filter` : `Show cell ${i + 1} (${label}) on the map`}
                    className={`flex h-full items-center rounded-l-lg hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${compact ? 'gap-1 px-1' : 'gap-1.5 pl-1.5 pr-1'}`}
                  >
                    <span className="h-5 min-w-[20px] rounded-full bg-white px-1 text-center text-[11px] font-semibold leading-5 text-black tabular-nums">
                      {i + 1}
                    </span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: rgbCss(sample.color) }}
                      aria-hidden="true"
                    />
                    <span className={compact ? 'sr-only' : 'max-w-[96px] truncate text-xs font-medium text-white/85'}>
                      {label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(sample.id, 'tray')}
                    aria-label={`Remove cell ${i + 1} (${label}) from the comparison`}
                    title="Remove"
                    className={`flex h-full items-center justify-center rounded-r-lg text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white ${compact ? 'w-5' : 'w-6'}`}
                  >
                    <X size={12} strokeWidth={2.25} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <p role="status" className="whitespace-nowrap px-1 text-xs text-white/55 empty:hidden">
          {status}
        </p>
        {!comparePicking && !full && (
          <button
            type="button"
            onClick={() => setComparePicking(true, 'tray')}
            title="Pick more cells on the map (C). Shift-clicking a dot also adds it."
            className={SECONDARY_BUTTON}
          >
            <Plus size={13} />
            Add cells
          </button>
        )}
        {count > 0 && (
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            disabled={!canCompare}
            title={canCompare ? 'Compare these cells side by side' : 'Add a second cell to compare'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/45"
          >
            <Columns3 size={14} strokeWidth={2.25} />
            Compare
          </button>
        )}
        {comparePicking ? (
          <button
            type="button"
            onClick={() => setComparePicking(false)}
            title="Stop picking cells (Esc)"
            className={SECONDARY_BUTTON}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            onClick={clearCompare}
            className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};

export default CompareTray;
