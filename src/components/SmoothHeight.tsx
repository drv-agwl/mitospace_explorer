import React, { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from '../utils/motion';

const HEIGHT_TRANSITION = 'height 280ms cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Animates its own height when the content grows or shrinks (a toolbar row or a strip
 * appearing), so the 3D map below resizes smoothly instead of jumping. Styles are set
 * from the ResizeObserver callback, before paint, and content is clipped only mid-animation
 * so menus inside can still overflow.
 */
const SmoothHeight: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    let last: number | null = null;
    const measure = () => {
      const h = inner.offsetHeight;
      if (h === last) return;
      const animate = last !== null && !prefersReducedMotion();
      outer.style.transition = animate ? HEIGHT_TRANSITION : 'none';
      if (animate) outer.style.overflow = 'hidden';
      outer.style.height = `${h}px`;
      last = h;
    };
    const done = (e: TransitionEvent) => {
      if (e.target === outer && e.propertyName === 'height') outer.style.overflow = '';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    // Not on transitioncancel: a cancelled transition is replaced by the next one, still running.
    outer.addEventListener('transitionend', done);
    return () => {
      observer.disconnect();
      outer.removeEventListener('transitionend', done);
    };
  }, []);

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

export default SmoothHeight;
