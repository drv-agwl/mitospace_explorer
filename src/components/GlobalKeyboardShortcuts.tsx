import React, { useCallback } from 'react';
import { useSample } from '../context/SampleContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

/** Handles global Esc: closes the comparison, else ends picking cells, else clears the selected cell. R reset is handled per-visualizer. */
const GlobalKeyboardShortcuts: React.FC = () => {
  const { setSelectedSample, compareOpen, setCompareOpen, comparePicking, setComparePicking } = useSample();
  const onEscape = useCallback(() => {
    if (compareOpen) setCompareOpen(false);
    else if (comparePicking) setComparePicking(false);
    else setSelectedSample(null);
  }, [compareOpen, setCompareOpen, comparePicking, setComparePicking, setSelectedSample]);

  useKeyboardShortcuts({ onEscape });
  return null;
};

export default GlobalKeyboardShortcuts;
