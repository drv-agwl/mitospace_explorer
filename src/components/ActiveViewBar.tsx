import React from 'react';
import { Palette, Filter, X, RotateCcw, Droplet } from 'lucide-react';
import { useSample } from '../context/SampleContext';

/**
 * ActiveViewBar — a live, always-visible read-out of what's currently applied
 * to the atlas (feature colouring, colour mode, drug filters), with one-click
 * removal of each. It orients the user (especially after the agent changes the
 * view) and gives a fast manual "undo" for any single facet.
 *
 * Renders nothing when the atlas is in its default state, to keep the canvas
 * clean.
 */

const FEATURE_LABELS: Record<string, string> = {
  fragment_diffusivity_mean: 'Fragment Motility',
  segment_diffusivity_mean: 'Segment Motility',
  node_diffusivity_mean: 'Node Motility',
  fission_rate_mean: 'Fission Rate',
  fusion_rate_mean: 'Fusion Rate',
  fragment_length_mean: 'Fragment Length',
  segment_length_mean: 'Segment Length',
  fragment_diameter_mean: 'Fragment Diameter',
  fragment_tortuosity_mean: 'Tortuosity',
  tmrm_last: 'Membrane Potential',
};

const labelForFeature = (api: string): string =>
  FEATURE_LABELS[api] ??
  api
    .replace(/_(mean|last|std|median)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const Chip: React.FC<{
  icon: React.ReactNode;
  label: React.ReactNode;
  onClear: () => void;
  title?: string;
}> = ({ icon, label, onClear, title }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-black/70 py-1 pl-2.5 pr-1 text-[11.5px] font-medium text-white/85 backdrop-blur-md"
    title={title}
  >
    <span className="text-cyan-300/80">{icon}</span>
    <span className="max-w-[160px] truncate">{label}</span>
    <button
      onClick={onClear}
      className="flex h-4 w-4 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/15 hover:text-white"
      aria-label="Clear"
    >
      <X size={11} strokeWidth={2.5} />
    </button>
  </span>
);

const ActiveViewBar: React.FC = () => {
  const {
    semanticState,
    visualizerOptions,
    selectedDrugs,
    setSemanticState,
    setColoringMode,
    toggleDrugFilter,
    clearDrugFilter,
  } = useSample();

  const featureColoring = semanticState.advancedMode && !!semanticState.selectedFeature;
  const phenotypeMode = !featureColoring && visualizerOptions.coloringMode === 'phenotype';
  const drugs = Array.from(selectedDrugs);
  const hasFilter = drugs.length > 0;

  if (!featureColoring && !phenotypeMode && !hasFilter) return null;

  const clearFeatureColoring = () =>
    setSemanticState((s) => ({
      ...s,
      advancedMode: false,
      selectedFeature: null,
      semanticSliderValue: null,
      projectedPosition: null,
      projectedConfidence: null,
      axisSamplesVisible: false,
    }));

  const resetAll = () => {
    clearDrugFilter();
    setColoringMode('treatment');
    clearFeatureColoring();
  };

  const MAX_DRUG_CHIPS = 3;
  const shownDrugs = drugs.slice(0, MAX_DRUG_CHIPS);
  const overflow = drugs.length - shownDrugs.length;

  return (
    <div className="absolute left-4 top-4 z-10 flex max-w-[min(70%,560px)] flex-wrap items-center gap-1.5">
      {featureColoring && (
        <Chip
          icon={<Palette size={12} />}
          label={`Coloured: ${labelForFeature(semanticState.selectedFeature as string)}`}
          onClear={clearFeatureColoring}
          title="Feature colouring"
        />
      )}
      {phenotypeMode && (
        <Chip
          icon={<Droplet size={12} />}
          label="Coloured by phenotype"
          onClear={() => setColoringMode('treatment')}
          title="Colour mode"
        />
      )}
      {shownDrugs.map((d) => (
        <Chip
          key={d}
          icon={<Filter size={12} />}
          label={d}
          onClear={() => toggleDrugFilter(d)}
          title="Active condition filter"
        />
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded-full border border-white/[0.12] bg-black/70 px-2.5 py-1 text-[11.5px] font-medium text-white/60 backdrop-blur-md"
          title={drugs.slice(MAX_DRUG_CHIPS).join(', ')}
        >
          +{overflow} more
        </span>
      )}
      <button
        onClick={resetAll}
        className="inline-flex items-center gap-1 rounded-full border border-white/[0.12] bg-black/70 px-2.5 py-1 text-[11.5px] font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
        title="Reset all view changes"
      >
        <RotateCcw size={11} strokeWidth={2.5} /> Reset
      </button>
    </div>
  );
};

export default ActiveViewBar;
