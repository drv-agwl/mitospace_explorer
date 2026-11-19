#!/usr/bin/env node
/**
 * Generate the drug-strip media from each condition's representative movie.
 *
 * Frame 0 of every movie is the same frontal view of the volume (it rotates
 * afterwards), so posters are taken at frame 0 and clips start there too: the
 * poster hands over to the playing clip without a visible jump.
 *
 * Usage: node scripts/gen_posters.mjs
 * Requires: ffmpeg on PATH, network access to the S3 movies.
 *
 * Output:
 *   public/posters/<slug>.webp        224 px poster (strip tiles)
 *   public/posters/large/<slug>.webp  448 px poster (About page)
 *   public/strip/<slug>.mp4           224 px faststart clip, ~0.1 MB instead of ~1.3 MB
 *   public/posters/manifest.json      { byDrug, byId, clipById }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'src', 'data', 'points4d_v3.compact.json');
const POSTER_DIR = path.join(ROOT, 'public', 'posters');
const LARGE_DIR = path.join(POSTER_DIR, 'large');
const CLIP_DIR = path.join(ROOT, 'public', 'strip');

const VIDEO_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i;
const isVideoUrl = (u) => typeof u === 'string' && VIDEO_RE.test(u);

const expand = (tpl, i) =>
  tpl.replace(/\{i(?::0(\d+))?\}/g, (_, width) => (width ? String(i).padStart(Number(width), '0') : String(i)));

/** Cells of the compact dataset (scripts/compact_v3_points.mjs) with the fields used below. */
function pointsFromCompact(data) {
  return Array.from({ length: data.count }, (_, i) => ({
    id: expand(data.idTemplate, i),
    treatment: data.conditions[data.condition[i]].treatment,
    videos: [expand(data.videoTemplate, i)],
  }));
}

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

const ffmpeg = (args) => execFileAsync('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 120_000 });

async function main() {
  if (!existsSync(DATA)) {
    console.error(`[posters] dataset not found: ${DATA}`);
    process.exit(1);
  }
  await Promise.all([POSTER_DIR, LARGE_DIR, CLIP_DIR].map((d) => mkdir(d, { recursive: true })));
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mitospace-strip-'));

  console.log('[posters] reading dataset…');
  const parsed = JSON.parse(await readFile(DATA, 'utf8'));
  const reps = selectRepresentatives(pointsFromCompact(parsed));
  console.log(`[posters] ${reps.length} drug representatives`);

  const manifest = { byDrug: {}, byId: {}, clipById: {} };
  let ok = 0;
  let failed = 0;

  for (const { drug, sample } of reps) {
    const url = sample._videos[0];
    if (!url) { failed++; continue; }
    const slug = slugify(drug);
    const source = path.join(tmp, `${slug}.mp4`);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      await writeFile(source, Buffer.from(await res.arrayBuffer()));

      // No -ss: the very first frame is the frontal view.
      await ffmpeg(['-i', source, '-frames:v', '1', '-vf', 'scale=224:-2', '-c:v', 'libwebp', '-q:v', '70',
        path.join(POSTER_DIR, `${slug}.webp`)]);
      await ffmpeg(['-i', source, '-frames:v', '1', '-vf', 'scale=448:-2', '-c:v', 'libwebp', '-q:v', '75',
        path.join(LARGE_DIR, `${slug}.webp`)]);
      // Short GOP keeps seeks cheap for the shared loop clock; faststart puts the index first.
      await ffmpeg(['-i', source, '-an', '-vf', 'scale=224:224:flags=lanczos',
        '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', '-movflags', '+faststart',
        path.join(CLIP_DIR, `${slug}.mp4`)]);

      manifest.byDrug[drug] = `/posters/${slug}.webp`;
      if (sample.id != null) {
        manifest.byId[sample.id] = `/posters/${slug}.webp`;
        manifest.clipById[sample.id] = `/strip/${slug}.mp4`;
      }
      ok++;
      console.log(`[posters] ${drug}: poster, large poster, clip`);
    } catch (err) {
      failed++;
      console.warn(`[posters] FAILED ${drug}: ${err?.message ?? err}`);
    }
  }

  await rm(tmp, { recursive: true, force: true });
  await writeFile(path.join(POSTER_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[posters] done: ${ok} ok, ${failed} failed. manifest.json written.`);
}

main().catch((err) => {
  console.error('[posters] fatal', err);
  process.exit(1);
});
