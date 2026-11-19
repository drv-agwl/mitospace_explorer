#!/usr/bin/env node
/**
 * Convert the per-cell v3 dataset (public/data/points4d_v3.json, ~21 MB) into
 * the compact file the explorer loads (src/data/points4d_v3.compact.json, ~1 MB).
 *
 * Everything that is the same for every cell of a condition (name, dose,
 * SMILES, colour, metadata) is stored once in `conditions`; per cell only the
 * coordinates and a condition index remain. Ids, movie URLs and other per-cell
 * strings follow the row index and are stored as templates (`{i}`, `{i:06}`).
 *
 * Usage: node scripts/compact_v3_points.mjs
 * The output is checked against the input (every field, coordinates within
 * rounding) before it is written.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'data', 'points4d_v3.json');
const OUT = path.join(ROOT, 'src', 'data', 'points4d_v3.compact.json');
const DECIMALS = 5;

const expand = (tpl, i) =>
  tpl.replace(/\{i(?::0(\d+))?\}/g, (_, width) => (width ? String(i).padStart(Number(width), '0') : String(i)));

/** Template for a string that embeds row index `i` (zero-padded or plain), or null. */
function templateFor(value, i) {
  if (typeof value !== 'string') return null;
  for (const [needle, token] of [
    [String(i).padStart(6, '0'), '{i:06}'],
    [String(i), '{i}'],
  ]) {
    const at = value.lastIndexOf(needle);
    if (at >= 0) return value.slice(0, at) + token + value.slice(at + needle.length);
  }
  return null;
}

function movieOf(p) {
  const list = (p.videos && p.videos.length ? p.videos : p.images) ?? [];
  return list[0];
}

async function main() {
  const points = JSON.parse(await readFile(SRC, 'utf8')).points;
  if (!Array.isArray(points) || points.length === 0) throw new Error('no points in source');

  // Templates come from the last row: a long index is unlikely to appear by chance.
  const last = points.length - 1;
  const ref = points[last];
  const idTemplate = templateFor(ref.id, last);
  const videoTemplate = templateFor(movieOf(ref), last);
  if (!idTemplate || !videoTemplate) throw new Error('ids or movie URLs do not follow the row index');
  const metadataTemplates = {};
  const sameCondition = points.find((p) => p.treatment?.drug === ref.treatment?.drug);
  for (const [k, v] of Object.entries(ref.metadata ?? {})) {
    if (JSON.stringify(sameCondition.metadata?.[k]) === JSON.stringify(v)) continue;
    const tpl = templateFor(v, last);
    if (!tpl) throw new Error(`metadata.${k} varies within a condition but does not follow the row index`);
    metadataTemplates[k] = tpl;
  }

  const conditions = [];
  const conditionIndex = new Map();
  const condition = new Array(points.length);
  const xyz = new Array(points.length * 3);
  const round = (v) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

  points.forEach((p, i) => {
    const drug = p.treatment?.drug;
    if (!conditionIndex.has(drug)) {
      const metadata = {};
      for (const [k, v] of Object.entries(p.metadata ?? {})) {
        metadata[k] = k in metadataTemplates ? metadataTemplates[k] : v;
      }
      conditionIndex.set(drug, conditions.length);
      conditions.push({ phenotype: p.phenotype, color: p.color, treatment: p.treatment, metadata });
    }
    condition[i] = conditionIndex.get(drug);
    xyz[i * 3] = round(p.x);
    xyz[i * 3 + 1] = round(p.y);
    xyz[i * 3 + 2] = round(p.z);
  });

  // Rebuild every cell from the compact form and compare with the source.
  const tolerance = 0.5 * 10 ** -DECIMALS + 1e-9;
  points.forEach((p, i) => {
    const c = conditions[condition[i]];
    const metadata = Object.fromEntries(
      Object.entries(c.metadata).map(([k, v]) => [k, k in metadataTemplates ? expand(v, i) : v])
    );
    const rebuilt = {
      id: expand(idTemplate, i),
      phenotype: c.phenotype,
      treatment: c.treatment,
      movie: expand(videoTemplate, i),
      metadata,
      color: c.color,
    };
    const original = {
      id: p.id,
      phenotype: p.phenotype,
      treatment: p.treatment,
      movie: movieOf(p),
      metadata: p.metadata,
      color: p.color,
    };
    if (JSON.stringify(rebuilt) !== JSON.stringify(original)) {
      throw new Error(`row ${i} does not round-trip:\n${JSON.stringify(original)}\n${JSON.stringify(rebuilt)}`);
    }
    for (const [axis, k] of [['x', 0], ['y', 1], ['z', 2]]) {
      if (Math.abs(xyz[i * 3 + k] - p[axis]) > tolerance) throw new Error(`row ${i} ${axis} off by more than rounding`);
    }
  });

  const out = {
    format: 'mitospace-points@1',
    count: points.length,
    idTemplate,
    videoTemplate,
    // Metadata keys whose condition value is a per-cell template.
    templatedMetadata: Object.keys(metadataTemplates),
    conditions,
    condition,
    xyz,
  };
  const text = JSON.stringify(out);
  await writeFile(OUT, text);
  console.log(
    `[compact] ${points.length} cells, ${conditions.length} conditions -> ${path.relative(ROOT, OUT)} (${(text.length / 1e6).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error('[compact] failed:', err.message ?? err);
  process.exit(1);
});
