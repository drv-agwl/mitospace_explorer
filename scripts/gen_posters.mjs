#!/usr/bin/env node
/**
 * Generate first-frame WebP poster thumbnails for the drug-overview strip.
 *
 * The strip shows one representative sample per drug. Instead of waiting on
 * ~1.3MB MP4s per card, we show a ~10-15KB WebP poster instantly (facade
 * pattern) and fade the video in behind it.
 *
 * Usage: node scripts/gen_posters.mjs
 * Requires: ffmpeg on PATH.
 *
 * Output:
 *   public/posters/<drug-slug>.webp
 *   public/posters/manifest.json  { drug -> "/posters/<slug>.webp", byId: { id -> path } }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data', 'points4d_v3.json');
const OUT_DIR = path.join(ROOT, 'public', 'posters');

const VIDEO_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i;
const isVideoUrl = (u) => typeof u === 'string' && VIDEO_RE.test(u);

/** Same rep selection as src/utils/drugStripSamples.ts (video > image > any). */
function selectRepresentatives(points) {
  const byDrug = new Map();
  for (const s of points) {
    const drug = s?.treatment?.drug;
    if (!drug) continue;
    // v3 stores the movie in `images` as an .mp4 URL.
    const videos = (s.videos && s.videos.length ? s.videos : (s.images || [])).filter(isVideoUrl);
    const cand = { ...s, _videos: videos };
    const existing = byDrug.get(drug);
    if (!existing) { byDrug.set(drug, cand); continue; }
    const candHasVideo = cand._videos.length > 0;
    const existHasVideo = existing._videos.length > 0;
    if (candHasVideo && !existHasVideo) byDrug.set(drug, cand);
  }
  return Array.from(byDrug.entries())
    .map(([drug, sample]) => ({ drug, sample }))
    .sort((a, b) => a.drug.localeCompare(b.drug));
}

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  if (!existsSync(DATA)) {
    console.error(`[posters] dataset not found: ${DATA}`);
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  console.log('[posters] reading dataset…');
  const parsed = JSON.parse(await readFile(DATA, 'utf8'));
  const points = parsed.points || [];
  const reps = selectRepresentatives(points);
  console.log(`[posters] ${reps.length} drug representatives`);

  const manifest = { byDrug: {}, byId: {} };
  let ok = 0;
  let failed = 0;

  for (const { drug, sample } of reps) {
    const url = sample._videos[0];
    if (!url) { failed++; continue; }
    const slug = slugify(drug);
    const outPath = path.join(OUT_DIR, `${slug}.webp`);
    const publicPath = `/posters/${slug}.webp`;

    try {
      // -ss before -i for a fast keyframe seek; single frame; small WebP.
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', '0.3',
        '-i', url,
        '-frames:v', '1',
        '-vf', 'scale=224:-2',
        '-c:v', 'libwebp',
        '-q:v', '70',
        outPath,
      ], { timeout: 60_000 });
      manifest.byDrug[drug] = publicPath;
      if (sample.id != null) manifest.byId[sample.id] = publicPath;
      ok++;
      console.log(`[posters] ${drug} -> ${publicPath}`);
    } catch (err) {
      failed++;
      console.warn(`[posters] FAILED ${drug}: ${err?.message ?? err}`);
    }
  }

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`[posters] done: ${ok} ok, ${failed} failed. manifest.json written.`);
}

main().catch((err) => {
  console.error('[posters] fatal', err);
  process.exit(1);
});
