/** True when the user has asked the OS for less motion; cell movies then start paused. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
