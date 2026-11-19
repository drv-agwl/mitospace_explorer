import React from 'react';

/** The explorer on a desktop screen, framed as a browser window (phone page and About). */
const ExplorerPreview: React.FC<{ priority?: boolean; className?: string }> = ({
  priority = false,
  className = '',
}) => (
  <figure
    className={`overflow-hidden rounded-xl border border-white/[0.1] bg-[#0a0a0a] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ${className}`}
  >
    <div className="relative flex items-center gap-1.5 h-7 px-3 border-b border-white/[0.08] bg-white/[0.03]" aria-hidden="true">
      <span className="w-2 h-2 rounded-full bg-white/15" />
      <span className="w-2 h-2 rounded-full bg-white/15" />
      <span className="w-2 h-2 rounded-full bg-white/15" />
      <span className="absolute inset-x-0 text-center text-[10px] tracking-wide text-white/40">mitospace.ai</span>
    </div>
    <img
      src="/preview/explorer-1200.webp"
      srcSet="/preview/explorer-1200.webp 1200w, /preview/explorer-1800.webp 1800w"
      sizes="(min-width: 1024px) 960px, 100vw"
      width={1200}
      height={750}
      alt="The explorer on a desktop screen: one movie per drug condition above a 3D map of cells, with a selected cell's movie in the side panel"
      decoding="async"
      {...(priority ? { fetchpriority: 'high' } : { loading: 'lazy' as const })}
      className="block w-full h-auto"
    />
  </figure>
);

export default ExplorerPreview;
