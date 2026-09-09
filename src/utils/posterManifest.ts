/**
 * Access to pre-generated strip poster thumbnails (public/posters/manifest.json).
 * Loaded once, cached. Safe to call before load resolves (returns undefined).
 */
import { useEffect, useState } from 'react';

interface PosterManifest {
  byDrug: Record<string, string>;
  byId: Record<string, string>;
}

let manifest: PosterManifest | null = null;
let promise: Promise<PosterManifest | null> | null = null;

function base(): string {
  return (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
}

export function loadPosterManifest(): Promise<PosterManifest | null> {
  if (manifest) return Promise.resolve(manifest);
  if (promise) return promise;
  promise = fetch(`${base()}/posters/manifest.json`, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: PosterManifest | null) => {
      manifest = data ?? { byDrug: {}, byId: {} };
      return manifest;
    })
    .catch(() => {
      manifest = { byDrug: {}, byId: {} };
      return manifest;
    });
  return promise;
}

export function posterForDrug(drug: string | undefined): string | undefined {
  if (!drug || !manifest) return undefined;
  return manifest.byDrug[drug];
}

export function posterForId(id: string | number | undefined): string | undefined {
  if (id == null || !manifest) return undefined;
  return manifest.byId[String(id)];
}

/** React hook: returns the manifest once loaded (null until then). */
export function usePosterManifest(): PosterManifest | null {
  const [m, setM] = useState<PosterManifest | null>(manifest);
  useEffect(() => {
    let cancelled = false;
    loadPosterManifest().then((res) => {
      if (!cancelled) setM(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return m;
}
