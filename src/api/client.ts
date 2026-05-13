/**
 * API client for MitoSpace backend (projection and features).
 *
 * Every endpoint now optionally accepts a `version` parameter (`'v1' | 'v3'`)
 * which the backend uses to route to the right dataset. When omitted, the
 * backend defaults to v3.
 */

import type { DatasetVersion } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

function withVersion(params: URLSearchParams, version?: DatasetVersion): URLSearchParams {
  if (version) params.set('version', version);
  return params;
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
  const res = await fetch(url, {
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
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Axis trajectory failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const points = Array.isArray(data.points) ? data.points : [];
  return { points, featureMin: data.featureMin, featureMax: data.featureMax };
}

export async function getFeatureStats(
  feature: string = 'fragment_length_mean',
  version?: DatasetVersion,
): Promise<FeatureStats> {
  const params = withVersion(new URLSearchParams({ feature }), version);
  const url = `${API_BASE}/api/feature-stats?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feature stats failed: ${res.status}`);
  return res.json();
}

export async function getFeatureValues(
  featureName: string,
  version?: DatasetVersion,
): Promise<number[]> {
  // v1 column names have spaces; backend accepts both spaces and underscores.
  const name = featureName.replace(/\s+/g, '_');
  const params = withVersion(new URLSearchParams(), version);
  const qs = params.toString();
  const url = `${API_BASE}/api/features/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feature values failed: ${res.status}`);
  const data = await res.json();
  return data.values ?? [];
}

export async function healthCheck(version?: DatasetVersion): Promise<{
  version?: string;
  available_versions?: string[];
  embeddings_loaded?: boolean;
  umap_points_loaded: boolean;
  umap_reducer_loaded?: boolean;
  embedding_count: number;
  features: string[];
  axes: string[];
  chat_available?: boolean;
}> {
  const params = withVersion(new URLSearchParams(), version);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/health${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export interface ChatResponse {
  answer: string;
  data?: any;
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
