import React from 'react';

/** Plasma colormap gradient (matches featureColor.ts): dark purple → magenta → orange → yellow */
const PLASMA_CSS =
  'linear-gradient(to right, rgb(13, 8, 135), rgb(71, 5, 166), rgb(201, 28, 138), rgb(252, 120, 56), rgb(240, 242, 33))';

interface FeatureColorBarProps {
  visible: boolean;
}

const FeatureColorBar: React.FC<FeatureColorBarProps> = ({ visible }) => {
  if (!visible) return null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/70 backdrop-blur-sm overflow-hidden px-4 py-2.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-white/80 uppercase tracking-wider">
          Feature value
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/60 shrink-0">Low</span>
          <div
            className="flex-1 h-3 rounded border border-white/20"
            style={{ background: PLASMA_CSS }}
          />
          <span className="text-xs text-white/60 shrink-0">High</span>
        </div>
      </div>
    </div>
  );
};

export default FeatureColorBar;
