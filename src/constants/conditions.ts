/**
 * Display names, mechanism classes, doses and colour fixes for the v3 conditions,
 * keyed by the raw `treatment.drug` value in `points4d_v3.json`.
 *
 * Mechanisms are the dataset's `labelMoa` classes with "Depolarizer"
 * corrected to "Depolymerizer". Names follow `server/drug_knowledge.py`.
 * Doses come from the v1 dataset (`src/data/points4d.json`); the v3 export only carried a
 * "10 nM · 1h" placeholder. No treatment time is shown: both files give 1h for every drug.
 */
interface ConditionInfo {
  label: string;
  mechanism: string;
  dose: string;
  /** Replaces the dataset colour where it is below 3:1 on the canvas or shared with another condition. */
  color?: string;
}

const CONDITIONS: Record<string, ConditionInfo> = {
  control: { label: 'Control (DMSO)', mechanism: 'Vehicle control', dose: '1% DMSO' },
  antimycina: {
    label: 'Antimycin A',
    mechanism: 'Complex III Inhibitor / Secondary ROS Inducer',
    dose: '100 µM',
    color: '#a838a6',
  },
  azide: { label: 'Azide', mechanism: 'Complex IV Inhibitor / Secondary ROS Inducer', dose: '10 mM' },
  cccp: { label: 'CCCP', mechanism: 'Ionophore / MMP Modulator / Secondary ROS Inducer', dose: '10 µM' },
  cisplatin: { label: 'Cisplatin', mechanism: 'DNA Crosslinker / Secondary ROS Inducer', dose: '100 µM' },
  colchicine: { label: 'Colchicine', mechanism: 'Microtubule Depolymerizer', dose: '10 µM' },
  cytochalasind: { label: 'Cytochalasin D', mechanism: 'Actin Depolymerizer', dose: '10 µM' },
  dnp: { label: 'DNP', mechanism: 'Ionophore / MMP Modulator / Secondary ROS Inducer', dose: '100 µM' },
  h2o2: { label: 'H\u2082O\u2082', mechanism: 'Direct ROS Inducer', dose: '500 µM' },
  lantrunculinb: { label: 'Latrunculin B', mechanism: 'Actin Depolymerizer', dose: '10 µM' },
  lonidamine: { label: 'Lonidamine', mechanism: 'Complex II Inhibitor', dose: '100 µM' },
  mdivi1: { label: 'Mdivi-1', mechanism: 'Mitochondrial Fission Inhibitor', dose: '100 µM' },
  mfi8: { label: 'MFI8', mechanism: 'Mitochondrial Fusion Inhibitor', dose: '50 µM' },
  mitomycinc: {
    label: 'Mitomycin C',
    mechanism: 'DNA Crosslinker / Secondary ROS Inducer',
    dose: '100 µM',
    color: '#aa71fc',
  },
  mitoq: { label: 'MitoQ', mechanism: 'Antioxidant', dose: '10 µM' },
  myls22: { label: 'MYLS22', mechanism: 'Mitochondrial Fusion Inhibitor', dose: '100 µM' },
  nigericin: { label: 'Nigericin', mechanism: 'Ionophore / MMP Modulator / Secondary ROS Inducer', dose: '10 µM' },
  nocodazole: { label: 'Nocodazole', mechanism: 'Microtubule Depolymerizer', dose: '10 µM' },
  oligomycin: { label: 'Oligomycin', mechanism: 'Complex V Inhibitor / Secondary ROS Inducer', dose: '50 µM' },
  p110: { label: 'P110', mechanism: 'Mitochondrial Fission Inhibitor', dose: '10 µM', color: '#3161d6' },
  paraquat: { label: 'Paraquat', mechanism: 'Direct ROS Inducer', dose: '10 mM' },
  resveratrol: { label: 'Resveratrol', mechanism: 'Antioxidant', dose: '100 µM' },
  rotenone: { label: 'Rotenone', mechanism: 'Complex I Inhibitor / Microtubule Depolymerizer', dose: '10 µM' },
  tbhp: { label: 'TBHP', mechanism: 'Direct ROS Inducer', dose: '500 µM' },
  tiron: { label: 'Tiron', mechanism: 'Antioxidant', dose: '10 mM', color: '#785aa6' },
  valinomycin: { label: 'Valinomycin', mechanism: 'Ionophore / MMP Modulator / Secondary ROS Inducer', dose: '100 nM' },
};

export function conditionLabel(key: string): string {
  return CONDITIONS[key]?.label ?? key;
}

export function conditionMechanism(key: string): string | null {
  return CONDITIONS[key]?.mechanism ?? null;
}

export function conditionDose(key: string | undefined): string | null {
  return (key && CONDITIONS[key]?.dose) || null;
}

/** Control first, then alphabetical by display name. */
export function compareConditions(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'control') return -1;
  if (b === 'control') return 1;
  return conditionLabel(a).localeCompare(conditionLabel(b));
}

/** Corrected colour (0..1 RGB) for conditions whose dataset colour is unreadable or duplicated. */
export function conditionColorOverride(
  key: string | undefined
): { r: number; g: number; b: number } | null {
  const hex = key ? CONDITIONS[key]?.color : undefined;
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
