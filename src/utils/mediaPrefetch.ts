/**
 * Warm remote media into the browser cache before the UI needs it.
 *
 * S3 videos are cross-origin without CORS for fetch()/blob, so we warm via
 * off-DOM <video preload="auto"> elements and keep them attached (hidden)
 * so buffered media stays hot for the visible strip players.
 */

const warmed = new Set<string>();
const inflight = new Map<string, Promise<void>>();
let host: HTMLDivElement | null = null;

function getHost(): HTMLDivElement {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);pointer-events:none;opacity:0;';
  document.body.appendChild(host);
  return host;
}

function warmOneVideo(url: string, timeoutMs: number): Promise<void> {
  if (warmed.has(url)) return Promise.resolve();
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    // #t=0.001 nudges some browsers to fetch the first media segment promptly.
    video.src = url.includes('#') ? url : `${url}#t=0.001`;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('canplaythrough', finish);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', finish);
      warmed.add(url);
      inflight.delete(url);
      resolve();
    };

    const onLoaded = () => {
      // loadeddata is enough for a smooth first frame; canplaythrough may never
      // fire on some networks for long loops.
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('canplaythrough', finish);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', finish);

    getHost().appendChild(video);
    try {
      video.load();
    } catch {
      finish();
    }
  });

  inflight.set(url, promise);
  return promise;
}

export function isMediaWarmed(url: string): boolean {
  return warmed.has(url);
}

/**
 * Prefetch videos with bounded concurrency. Resolves when all have reached a
 * playable buffer (or timed out / errored — never blocks forever).
 */
export async function warmVideos(
  urls: string[],
  opts: { concurrency?: number; timeoutMs?: number } = {}
): Promise<void> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  if (unique.length === 0) return;

  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let next = 0;

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (next < unique.length) {
      const i = next++;
      await warmOneVideo(unique[i], timeoutMs);
    }
  });

  await Promise.all(workers);
}

/** Fire-and-forget HTTP/media warmup for exploration assets (lower priority). */
export function warmVideosInBackground(
  urls: string[],
  opts: { concurrency?: number; timeoutMs?: number } = {}
): void {
  const run = () => {
    void warmVideos(urls, {
      concurrency: opts.concurrency ?? 3,
      timeoutMs: opts.timeoutMs ?? 25_000,
    });
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => run(), { timeout: 2500 });
  } else {
    window.setTimeout(run, 400);
  }
}
