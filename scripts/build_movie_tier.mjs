#!/usr/bin/env node
/**
 * Prepare faster cell movies for the S3 bucket (audit item D2).
 *
 * The originals are 512 px, ~1.3 MB, with the MP4 index at the end, so a
 * browser has to fetch most of a file before the first frame. This writes,
 * per cell:
 *   <out>/preview/mtg_NNNNNN.mp4   256 px faststart copy for thumbnail players (~0.1 MB)
 *   <out>/original/mtg_NNNNNN.mp4  the original stream remuxed with the index first
 *                                  (lossless, same pixels; only with --remux)
 *
 * Resumable (existing outputs are skipped) and parallel. Nothing is uploaded;
 * the script prints the `aws s3 sync` commands to run afterwards.
 *
 * Usage:
 *   node scripts/build_movie_tier.mjs [--out data/movie_tier] [--limit N] [--concurrency 4] [--remux]
 * Requires ffmpeg on PATH and network access to the movies.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src', 'data', 'points4d_v3.compact.json');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, opt('out', 'data/movie_tier'));
const LIMIT = Number(opt('limit', Infinity));
const CONCURRENCY = Math.max(1, Number(opt('concurrency', Math.min(4, os.cpus().length))));
const REMUX = args.includes('--remux');
const PREVIEW_SIZE = 256;

const expand = (tpl, i) =>
  tpl.replace(/\{i(?::0(\d+))?\}/g, (_, width) => (width ? String(i).padStart(Number(width), '0') : String(i)));

const exists = (p) => stat(p).then(() => true, () => false);
const ffmpeg = (argv) => execFileAsync('ffmpeg', ['-v', 'error', '-y', ...argv], { timeout: 300_000 });

async function processMovie(url, tmpDir) {
  const name = path.basename(new URL(url).pathname);
  const preview = path.join(OUT, 'preview', name);
  const original = path.join(OUT, 'original', name);
  const todo = [!(await exists(preview)) && 'preview', REMUX && !(await exists(original)) && 'original'].filter(Boolean);
  if (todo.length === 0) return 'skipped';

  const source = path.join(tmpDir, name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await writeFile(source, Buffer.from(await res.arrayBuffer()));
  try {
    // Write to a temp name and rename, so an interrupted run never leaves a half file that looks done.
    if (todo.includes('preview')) {
      await ffmpeg(['-i', source, '-an', '-vf', `scale=${PREVIEW_SIZE}:${PREVIEW_SIZE}:flags=lanczos`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', '-movflags', '+faststart', `${preview}.part.mp4`]);
      await rename(`${preview}.part.mp4`, preview);
    }
    if (todo.includes('original')) {
      await ffmpeg(['-i', source, '-c', 'copy', '-movflags', '+faststart', `${original}.part.mp4`]);
      await rename(`${original}.part.mp4`, original);
    }
  } finally {
    await rm(source, { force: true });
  }
  return 'done';
}

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const urls = Array.from({ length: Math.min(data.count, LIMIT) }, (_, i) => expand(data.videoTemplate, i));
  await mkdir(path.join(OUT, 'preview'), { recursive: true });
  if (REMUX) await mkdir(path.join(OUT, 'original'), { recursive: true });
  const tmpDir = path.join(os.tmpdir(), 'mitospace-movie-tier');
  await mkdir(tmpDir, { recursive: true });

  const counts = { done: 0, skipped: 0, failed: 0 };
  const failures = [];
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        counts[await processMovie(url, tmpDir)]++;
      } catch (err) {
        counts.failed++;
        failures.push(`${url}: ${err?.message ?? err}`);
      }
      const n = counts.done + counts.skipped + counts.failed;
      if (n % 100 === 0 || n === urls.length) {
        console.log(`[tier] ${n}/${urls.length} (${counts.done} new, ${counts.skipped} skipped, ${counts.failed} failed, ${Math.round((Date.now() - started) / 1000)} s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await rm(tmpDir, { recursive: true, force: true });
  if (failures.length) await writeFile(path.join(OUT, 'failures.txt'), failures.join('\n') + '\n');

  const bucket = new URL(urls[0]);
  const prefix = path.posix.dirname(bucket.pathname).replace(/^\//, '');
  const s3 = `s3://${bucket.hostname.split('.')[0]}`;
  const headers = '--content-type video/mp4 --cache-control "public, max-age=31536000, immutable"';
  console.log(`\n[tier] ${counts.failed ? `${counts.failed} failed (see failures.txt). ` : ''}Upload when ready:`);
  console.log(`  aws s3 sync ${path.relative(ROOT, path.join(OUT, 'preview'))} ${s3}/${prefix}_preview/ ${headers}`);
  if (REMUX) console.log(`  aws s3 sync ${path.relative(ROOT, path.join(OUT, 'original'))} ${s3}/${prefix}/ ${headers}`);
  console.log(`Then set VITE_MOVIE_PREVIEW_BASE=https://${bucket.hostname}/${prefix}_preview for the build.`);
}

main().catch((err) => {
  console.error('[tier] fatal', err);
  process.exit(1);
});
