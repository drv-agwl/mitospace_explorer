import React from 'react';
import { Loader2 } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import type { DatasetVersion } from '../types';

const OPTIONS: Array<{ value: DatasetVersion; label: string; sub: string }> = [
  { value: 'v1', label: 'v1', sub: '2024 · 13K' },
  { value: 'v3', label: 'v3', sub: '2025 · 36K' },
];

const DatasetToggle: React.FC = () => {
  const { datasetVersion, datasetLoading, setDatasetVersion } = useSample();

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5"
      data-tour="dataset-toggle"
      aria-label="Dataset version"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === datasetVersion;
        const isLoading = datasetLoading && active;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (!active) setDatasetVersion(opt.value);
            }}
            className={`relative px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              active
                ? 'bg-white text-black'
                : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
            }`}
            title={`${opt.label} dataset (${opt.sub})`}
          >
            <span className="tracking-wide">{opt.label}</span>
            <span className={active ? 'text-black/50' : 'text-white/30'}>·</span>
            <span className={`text-[10px] tabular-nums ${active ? 'text-black/60' : 'text-white/40'}`}>
              {opt.sub}
            </span>
            {isLoading && (
              <Loader2 size={11} className="ml-0.5 animate-spin text-black/60" strokeWidth={2.5} />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default DatasetToggle;
