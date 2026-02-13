import React, { useCallback } from 'react';
import { useSample } from '../context/SampleContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

/** Handles global Esc to close sample panel. R reset is handled per-visualizer. */
const GlobalKeyboardShortcuts: React.FC = () => {
  const { setSelectedSample } = useSample();
  const onEscape = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  useKeyboardShortcuts({ onEscape });
  return null;
};

export default GlobalKeyboardShortcuts;
