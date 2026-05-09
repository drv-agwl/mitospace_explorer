import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import type { Sample } from '../types';

interface ColorLegendProps {
  /** Hide when using semantic/feature coloring */
  visible: boolean;
}

function getUniqueItems(
  samples: Sample[],
  mode: 'treatment' | 'phenotype'
): Array<{ label: string; r: number; g: number; b: number }> {
  const map = new Map<string, { r: number; g: number; b: number }>();
  for (const s of samples) {
    const label = mode === 'treatment' ? s.treatment.drug : s.phenotype;
    // Phenotype color may not exist in v3; fall back to treatment color.
    const color =
      mode === 'treatment' ? s.color : s.color_phenotypic ?? s.color;
    if (label && !map.has(label)) {
      map.set(label, {
        r: (color?.r ?? 0) * 255,
        g: (color?.g ?? 0) * 255,
        b: (color?.b ?? 0) * 255,
      });
    }
  }
  return Array.from(map.entries())
    .map(([label, rgb]) => ({ label, ...rgb }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const ColorLegend: React.FC<ColorLegendProps> = ({ visible }) => {
  const { filteredSamples4D, filteredSamples2D, visualizerOptions } = useSample();
  const [collapsed, setCollapsed] = useState(false);
  const samples = filteredSamples4D.length > 0 ? filteredSamples4D : filteredSamples2D;
  const items = useMemo(
    () => getUniqueItems(samples, visualizerOptions.coloringMode),
    [samples, visualizerOptions.coloringMode]
  );

  if (!visible || items.length === 0) return null;

  const label = visualizerOptions.coloringMode === 'treatment' ? 'Drug' : 'Phenotype';

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/70 backdrop-blur-sm overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-xs font-medium text-white/80 uppercase tracking-wider">{label} legend</span>
        {collapsed ? (
          <ChevronRight size={14} className="text-white/50" />
        ) : (
          <ChevronDown size={14} className="text-white/50" />
        )}
      </button>
      {!collapsed && (
        <div className="px-4 pb-3 max-h-40 overflow-y-auto scrollbar-thin space-y-1.5">
          {items.map(({ label: itemLabel, r, g, b }) => (
            <div key={itemLabel} className="flex items-center gap-2 text-xs">
              <div
                className="w-3 h-3 rounded shrink-0 border border-white/20"
                style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
              />
              <span className="text-white/80 truncate">{itemLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ColorLegend;
