import React, { useEffect, useState } from 'react';
import { Palette, Filter, Film, RotateCcw, Grid3X3, Circle, Sparkles } from 'lucide-react';
import { onToast, ToastPayload } from '../lib/uiCommands';

/**
 * Toaster — transient confirmations for agent-driven view changes, shown
 * bottom-centre over the atlas. Lets a change feel intentional even when the
 * user is watching the canvas rather than the agent panel.
 */

interface Toast extends ToastPayload {
  id: number;
}

const ICON = {
  color: Palette,
  filter: Filter,
  cell: Film,
  reset: RotateCcw,
  grid: Grid3X3,
  size: Circle,
  generic: Sparkles,
} as const;

const DURATION = 2600;

const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let counter = 0;
    return onToast((payload) => {
      const id = ++counter + Date.now();
      setToasts((prev) => [...prev.slice(-3), { ...payload, id }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, DURATION);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind ?? 'generic'];
        return (
          <div
            key={t.id}
            className="animate-fade-in pointer-events-auto flex items-center gap-2.5 rounded-xl border border-white/[0.12] bg-black/85 px-3.5 py-2.5 text-sm text-white/90 shadow-elevated backdrop-blur-md"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-400/15 text-cyan-200">
              <Icon size={13} />
            </span>
            {t.text}
          </div>
        );
      })}
    </div>
  );
};

export default Toaster;
