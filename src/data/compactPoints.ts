import type { Sample } from '../types';
import { conditionColorOverride, conditionDose } from '../constants/conditions';

/** Header of the compact v3 dataset written by scripts/compact_v3_points.mjs. */
export interface CompactHeader {
  format: string;
  count: number;
  /** Per-cell strings built from the row index: `{i}` or zero-padded `{i:06}`. */
  idTemplate: string;
  videoTemplate: string;
  templatedMetadata: string[];
  conditions: Array<{
    phenotype: string;
    color: Sample['color'];
    treatment: Sample['treatment'];
    metadata: Sample['metadata'];
  }>;
}

export interface CompactPoints extends CompactHeader {
  condition: number[];
  xyz: number[];
}

export const COMPACT_FORMAT = 'mitospace-points@1';

/** 32-bit FNV-1a of the labels joined by newlines; must match `row_order_hash` in the API. */
export function rowOrderHash(labels: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(labels.join('\n'))) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of the per-row condition order, compared with the API's `row_order`. */
export function compactRowHash(header: CompactHeader, condition: ArrayLike<number>): string {
  const drugs = header.conditions.map((c) => c.treatment.drug);
  return rowOrderHash(Array.from(condition, (c) => drugs[c]));
}

function compileTemplate(tpl: string): (i: number) => string {
  const parts = tpl.split(/(\{i(?::0\d+)?\})/).map((p) => {
    const m = /^\{i(?::0(\d+))?\}$/.exec(p);
    return m ? { width: m[1] ? Number(m[1]) : 0 } : p;
  });
  return (i) => {
    let s = '';
    for (const p of parts) {
      s += typeof p === 'string' ? p : p.width ? String(i).padStart(p.width, '0') : String(i);
    }
    return s;
  };
}

/** Expand the compact arrays into one Sample per cell (condition objects are shared). */
export function samplesFromCompact(
  header: CompactHeader,
  xyz: ArrayLike<number>,
  condition: ArrayLike<number>
): Sample[] {
  const id = compileTemplate(header.idTemplate);
  const video = compileTemplate(header.videoTemplate);
  const perCell = header.templatedMetadata.map((key) => ({
    key,
    byCondition: new Map<number, (i: number) => string>(),
  }));
  const conditions = header.conditions.map((c, ci) => {
    for (const t of perCell) {
      const tpl = c.metadata[t.key];
      if (typeof tpl === 'string') t.byCondition.set(ci, compileTemplate(tpl));
    }
    const drug = c.treatment?.drug;
    const color = conditionColorOverride(drug) ?? c.color;
    // The export's dose and time are placeholders: use the per-condition dose, leave time out.
    const dose = conditionDose(drug) ?? undefined;
    const treatment = { ...c.treatment, dose, time: undefined };
    return { ...c, color, treatment };
  });

  const samples = new Array<Sample>(header.count);
  for (let i = 0; i < header.count; i++) {
    const ci = condition[i];
    const c = conditions[ci];
    const metadata = { ...c.metadata };
    for (const t of perCell) {
      const f = t.byCondition.get(ci);
      if (f) metadata[t.key] = f(i);
    }
    samples[i] = {
      id: id(i),
      x: xyz[i * 3],
      y: xyz[i * 3 + 1],
      z: xyz[i * 3 + 2],
      phenotype: c.phenotype,
      color: c.color,
      treatment: c.treatment,
      videos: [video(i)],
      metadata,
    };
  }
  return samples;
}
