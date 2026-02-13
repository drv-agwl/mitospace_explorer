import { useEffect } from 'react';

/** Global keyboard shortcuts. Ignores when focus is in form elements. */
export function useKeyboardShortcuts(handlers: {
  onEscape?: () => void;
  onKeyR?: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isFormElement =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable;

      if (isFormElement) return;

      if (e.key === 'Escape' && handlers.onEscape) {
        e.preventDefault();
        handlers.onEscape();
      } else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && handlers.onKeyR) {
        e.preventDefault();
        handlers.onKeyR();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers.onEscape, handlers.onKeyR]);
}
