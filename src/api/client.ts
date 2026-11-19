/**
 * API client for MitoSpace backend (projection and features).
 *
 * Every endpoint now optionally accepts a `version` parameter (`'v1' | 'v3'`)
 * which the backend uses to route to the right dataset. When omitted, the
 * backend defaults to v3.
 */

import type { DatasetVersion } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

// Long enough for a cold-starting backend, short enough that an outage surfaces as an error.
const REQUEST_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function withVersion(params: URLSearchParams, version?: DatasetVersion): URLSearchParams {
  if (version) params.set('version', version);
  return params;
}

// Read-only payloads are fetched once per session (the warm-up and the feature switch share them).
const sessionCache = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = sessionCache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const request = load();
  sessionCache.set(key, request);
  request.catch(() => sessionCache.delete(key));
  return request;
}

export interface ProjectResponse {
  x: number;
  y: number;
  z: number;
  predictedValue: number;
  /** 1 = on manifold, <1 when extrapolating (for confidence indicator) */
  confidence?: number | null;
}

export interface FeatureStats {
  min: number;
  max: number;
  /** Percentiles of measured cells that `min` / `max` sit at. */
  lowPercentile?: number;
  highPercentile?: number;
  /** Cells with no measurement for this feature. */
  missing?: number;
}

export interface ProjectOptions {
  /** 'spatial' = highlight follows where this feature value lives in 3D (default). 'axis' = embedding axis. */
  method?: 'spatial' | 'axis';
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  scaleFactor?: number;
  /** Which dataset to query. */
  version?: DatasetVersion;
}

export async function projectOnAxis(
  pointIndex: number,
  targetValue: number,
  feature: string = 'fragment_length_mean',
  options?: ProjectOptions
): Promise<ProjectResponse> {
  const body: Record<string, unknown> = { pointIndex, targetValue, feature };
  if (options?.method) body.method = options.method;
  if (options?.version) body.version = options.version;
  if (
    options?.centerX != null &&
    options?.centerY != null &&
    options?.centerZ != null &&
    options?.scaleFactor != null
  ) {
    body.centerX = options.centerX;
    body.centerY = options.centerY;
    body.centerZ = options.centerZ;
    body.scaleFactor = options.scaleFactor;
  }
  const url = `${API_BASE}/api/project`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[api] project failed', res.status, text);
    throw new Error(text || `Project failed: ${res.status}`);
  }
  return res.json();
}

export interface AxisTrajectoryResponse {
  points: Array<{ x: number; y: number; z: number }>;
  featureMin: number;
  featureMax: number;
}

export interface AxisTrajectoryOptions {
  /** When set, backend returns points in scene space (same as project API) so trajectory aligns with scatter */
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  scaleFactor?: number;
  version?: DatasetVersion;
}

export async function getAxisTrajectory(
  feature: string = 'fragment_length_mean',
  numPoints: number = 80,
  options?: AxisTrajectoryOptions
): Promise<AxisTrajectoryResponse> {
  const params = new URLSearchParams({
    feature,
    num_points: String(numPoints),
  });
  withVersion(params, options?.version);
  if (
    options?.centerX != null &&
    options?.centerY != null &&
    options?.centerZ != null &&
    options?.scaleFactor != null
  ) {
    params.set('center_x', String(options.centerX));
    params.set('center_y', String(options.centerY));
    params.set('center_z', String(options.centerZ));
    params.set('scale_factor', String(options.scaleFactor));
  }
  const url = `${API_BASE}/api/axis-trajectory?${params.toString()}`;
  return once(url, async () => {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Axis trajectory failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    const points = Array.isArray(data.points) ? data.points : [];
    return { points, featureMin: data.featureMin, featureMax: data.featureMax };
  });
}

export async function getFeatureStats(
  feature: string = 'fragment_length_mean',
  version?: DatasetVersion,
): Promise<FeatureStats> {
  const params = withVersion(new URLSearchParams({ feature }), version);
  const url = `${API_BASE}/api/feature-stats?${params.toString()}`;
  return once(url, async () => {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Feature stats failed: ${res.status}`);
    return res.json();
  });
}

export async function getFeatureValues(
  featureName: string,
  version?: DatasetVersion,
): Promise<number[]> {
  // v1 column names have spaces; backend accepts both spaces and underscores.
  const name = featureName.replace(/\s+/g, '_');
  const params = withVersion(new URLSearchParams({ format: 'f32' }), version);
  const url = `${API_BASE}/api/features/${encodeURIComponent(name)}?${params.toString()}`;
  return once(url, async () => {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Feature values failed: ${res.status}`);
    // float32 per cell, NaN = no measurement; older backends ignore `format` and send JSON.
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      return Array.from(new Float32Array(await res.arrayBuffer()));
    }
    const data = await res.json();
    // Unmeasured cells arrive as null; NaN keeps them out of every numeric path.
    return ((data.values ?? []) as Array<number | null>).map((v) => v ?? NaN);
  });
}

export interface ApiHealth {
  status?: string;
  version?: string;
  point_count?: number;
  /** Older backends report the point count under this name. */
  embedding_count?: number;
  /** Hash of the API's per-row condition order (see `rowOrderHash`). */
  row_order?: string | null;
}

export async function healthCheck(version?: DatasetVersion): Promise<ApiHealth> {
  const params = withVersion(new URLSearchParams(), version);
  const qs = params.toString();
  const res = await fetchWithTimeout(`${API_BASE}/api/health${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export interface CellFeature {
  name: string;
  /** One per requested cell; null when the cell has no measurement. */
  values: Array<number | null>;
  /** Share of all measured cells with a lower value (0-100), per requested cell. */
  percentiles: Array<number | null>;
  median: number | null;
  /** Cells with a measurement for this feature. */
  measured: number;
}

export interface CellFeaturesResponse {
  /** Dataset rows, in the order requested. */
  cells: number[];
  features: CellFeature[];
}

/** Every feature of a few cells (dataset rows), each value placed among all measured cells. */
export async function getCellFeatures(rows: number[], version?: DatasetVersion): Promise<CellFeaturesResponse> {
  const params = withVersion(new URLSearchParams({ cells: rows.join(',') }), version);
  return once(`cell-features?${params}`, async () => {
    const res = await fetchWithTimeout(`${API_BASE}/api/cell-features?${params}`);
    if (!res.ok) throw new Error(`Cell features request failed: ${res.status}`);
    return (await res.json()) as CellFeaturesResponse;
  });
}

/** What the visit log knows about this visitor's network (never the IP address). */
export interface VisitInfo {
  org?: string;
  org_type?: string;
  org_domain?: string;
  /** 'bot' | 'vpn' | 'datacenter' when the visit is probably not a person on their own network. */
  traffic?: string;
}

const VISIT_URL = `${API_BASE}/api/visit`;
// text/plain keeps the cross-origin POST a simple request: no CORS preflight, and sendBeacon allows it.
const VISIT_HEADERS = { 'Content-Type': 'text/plain' };

export async function postVisit(payload: object): Promise<VisitInfo | null> {
  try {
    const res = await fetch(VISIT_URL, {
      method: 'POST',
      headers: VISIT_HEADERS,
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return res.ok ? ((await res.json()) as VisitInfo) : null;
  } catch {
    return null;
  }
}

/** For the page being hidden or closed: the request outlives the page. */
export function beaconVisit(payload: object): void {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.(VISIT_URL, new Blob([body], { type: 'text/plain' }))) return;
  } catch {
    // Fall back to a keepalive fetch below.
  }
  void fetch(VISIT_URL, { method: 'POST', headers: VISIT_HEADERS, body, keepalive: true }).catch(() => {});
}

/** Structured payload behind a chat answer (tool results, stats). */
export type ChatData = Record<string, unknown> & { query_type?: string };

export interface ChatResponse {
  answer: string;
  data?: ChatData;
  query_type?: string;
  request_id?: string;
  /** True iff every number in `answer` is verified against backend stats. */
  grounded?: boolean;
  /**
   * Where the answer came from:
   *  - 'agent'    — tool-using LLM agent (modern path)
   *  - 'llm'      — legacy single-shot LLM narration (kept for backward compat)
   *  - 'fallback' — deterministic narrator (LLM unreachable or hallucinated)
   */
  source?: 'agent' | 'llm' | 'fallback';
  /** Up to 3 natural follow-up questions a scientist might ask next. */
  suggestions?: string[];
  /** True when the answer was served from the in-memory response cache. */
  cached?: boolean;
  /** When the agent used tools, the tool names in call order (for transparency). */
  tools_used?: string[];
}

export class ChatRequestError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ChatRequestError';
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

export interface SendChatOptions {
  signal?: AbortSignal;
  /** Overall request timeout in ms; defaults to 60s. */
  timeoutMs?: number;
}

const DEFAULT_CHAT_TIMEOUT_MS = 60_000;

/**
 * Send a chat message to the backend.
 *
 * Cancellable via `options.signal` (used by the Stop button) and bounded by
 * an internal timeout (default 60s) so a hung backend can't leave the UI
 * spinning forever. Throws a {@link ChatRequestError} with `retryable=true`
 * for transient failures (timeouts, 429, 5xx) so the UI can offer a Retry
 * button without re-classifying every error string by hand.
 */
export async function sendChatMessage(
  message: string,
  history?: { role: string; content: string; query_type?: string }[],
  version?: DatasetVersion,
  options: SendChatOptions = {},
): Promise<ChatResponse> {
  const { signal: externalSignal, timeoutMs = DEFAULT_CHAT_TIMEOUT_MS } = options;

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);

  const onExternalAbort = () => timeoutController.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history || [], version }),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      throw new ChatRequestError(text || `Chat request failed (HTTP ${res.status})`, {
        status: res.status,
        retryable,
      });
    }

    return (await res.json()) as ChatResponse;
  } catch (err) {
    if (err instanceof ChatRequestError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      const userCancelled = externalSignal?.aborted ?? false;
      throw new ChatRequestError(
        userCancelled ? 'Cancelled.' : 'The request timed out. Please try again.',
        { retryable: !userCancelled },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ChatRequestError(`Network error: ${message}`, { retryable: true });
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
