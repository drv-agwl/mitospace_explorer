import React, { useCallback, useEffect } from 'react';
import { useSample } from '../context/SampleContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { emitCommand } from '../lib/uiCommands';

/** Handles global Esc to close sample panel. R reset is handled per-visualizer. */
const GlobalKeyboardShortcuts: React.FC = () => {
  const { setSelectedSample } = useSample();
  const onEscape = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  useKeyboardShortcuts({ onEscape });

  // Command shortcuts that should fire even while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        emitCommand('focus-ask');
      } else if (k === 'b') {
        e.preventDefault();
        emitCommand('toggle-dock');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
};

export default GlobalKeyboardShortcuts;
