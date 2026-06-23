import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Microscope, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import { useAgent } from '../context/AgentContext';
import { onCommand } from '../lib/uiCommands';
import AgentPanel from './AgentPanel';
import CellsPanel from './CellsPanel';

/**
 * RightDock — the docked workspace rail.
 *
 * One resizable, collapsible column with two tabs:
 *   • Ask  — the conversational agent (input anchored at the column's bottom)
 *   • Cell — details/media for the selected point
 *
 * This replaces both the old floating agent bar and the fixed sample panel.
 * Because everything lives in this column, nothing ever overlaps the 3D atlas.
 * Selecting a point surfaces the Cell tab; the agent's answer stays one click
 * away under Ask.
 */

type Tab = 'agent' | 'cell';

const MIN_WIDTH = 340;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 420;
const W_KEY = 'mitospace.dock.width';
const COLLAPSED_KEY = 'mitospace.dock.collapsed';

const RightDock: React.FC = () => {
  const { selectedSample, comparisonCells } = useSample();
  const { messages } = useAgent();

  const [tab, setTab] = useState<Tab>('agent');
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(W_KEY));
    return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  );
  const [dragging, setDragging] = useState(false);

  // Track the active sample's identity so we only react to *new* selections.
  const lastSampleKey = useRef<string | null>(null);
  const [unseenAnswer, setUnseenAnswer] = useState(false);

  useEffect(() => {
    localStorage.setItem(W_KEY, String(width));
  }, [width]);
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // A new point selection surfaces the Cell tab (and expands the rail).
  useEffect(() => {
    const key = selectedSample
      ? `${selectedSample.treatment.drug}|${selectedSample.x},${selectedSample.y},${selectedSample.z}|${selectedSample.t ?? ''}`
      : null;
    if (key && key !== lastSampleKey.current) {
      setTab((prev) => {
        if (prev === 'agent' && messages.length > 0) setUnseenAnswer(true);
        return 'cell';
      });
      setCollapsed(false);
    }
    lastSampleKey.current = key;
  }, [selectedSample, messages.length]);

  // Respond to global command shortcuts (⌘K Ask, ⌘B toggle).
  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd === 'focus-ask') {
          setCollapsed(false);
          setTab('agent');
          setUnseenAnswer(false);
        } else if (cmd === 'toggle-dock') {
          setCollapsed((c) => !c);
        } else if (cmd === 'collapse-dock') {
          setCollapsed(true);
        }
      }),
    [],
  );

  // Drag-to-resize from the left edge.
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (startX - ev.clientX)));
        setWidth(next);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width],
  );

  const selectTab = (t: Tab) => {
    setTab(t);
    if (t === 'agent') setUnseenAnswer(false);
  };

  // ── Collapsed rail ────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l border-white/[0.08] bg-black/95 py-3"
        aria-label="Workspace (collapsed)"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Expand panel"
        >
          <PanelRightOpen size={18} />
        </button>
        <div className="my-1 h-px w-6 bg-white/10" />
        <button
          onClick={() => {
            selectTab('agent');
            setCollapsed(false);
          }}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Ask the atlas"
        >
          <Sparkles size={18} />
          {messages.length > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400" />
          )}
        </button>
        <button
          onClick={() => {
            selectTab('cell');
            setCollapsed(false);
          }}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Cells"
        >
          <Microscope size={18} />
          {comparisonCells.length > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-bold text-black">
              {comparisonCells.length}
            </span>
          ) : selectedSample ? (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
          ) : null}
        </button>
      </aside>
    );
  }

  // ── Expanded dock ───────────────────────────────────────────────────────────
  const TabButton: React.FC<{
    id: Tab;
    icon: React.ReactNode;
    label: string;
    dot?: 'cyan' | 'emerald' | null;
    count?: number;
  }> = ({ id, icon, label, dot, count }) => (
    <button
      onClick={() => selectTab(id)}
      className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
        tab === id ? 'bg-white/[0.10] text-white' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80'
      }`}
    >
      {icon}
      {label}
      {count && count > 0 ? (
        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400/20 px-1 text-[10px] font-semibold text-cyan-200 ring-1 ring-cyan-300/30">
          {count}
        </span>
      ) : dot ? (
        <span className={`h-1.5 w-1.5 rounded-full ${dot === 'cyan' ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
      ) : null}
    </button>
  );

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-white/[0.08] bg-black/95 backdrop-blur-sm"
      style={{ width }}
      aria-label="Workspace"
    >
      {/* Resize handle */}
      <div
        onPointerDown={onResizeStart}
        className={`group absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize`}
        title="Drag to resize"
      >
        <div
          className={`mx-auto h-full w-px transition-colors ${
            dragging ? 'bg-cyan-400/70' : 'bg-transparent group-hover:bg-white/25'
          }`}
        />
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-2.5 py-2">
        <div className="flex items-center gap-1">
          <TabButton
            id="agent"
            icon={<Sparkles size={14} className={tab === 'agent' ? 'text-cyan-300' : ''} />}
            label="Ask"
            dot={unseenAnswer && tab !== 'agent' ? 'cyan' : null}
          />
          <TabButton
            id="cell"
            icon={<Microscope size={14} />}
            label="Cells"
            dot={selectedSample ? 'emerald' : null}
            count={comparisonCells.length}
          />
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Collapse panel"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {/* Tab content — keep both mounted so agent state/scroll persist. */}
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 ${tab === 'agent' ? 'block' : 'hidden'}`}>
          <AgentPanel />
        </div>
        <div className={`absolute inset-0 ${tab === 'cell' ? 'flex' : 'hidden'} flex-col`}>
          <CellsPanel />
        </div>
      </div>
    </aside>
  );
};

export default RightDock;
