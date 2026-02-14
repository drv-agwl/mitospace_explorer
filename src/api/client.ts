/**
 * API client for MitoSpace backend (projection and features).
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

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
}

export async function projectOnAxis(
  pointIndex: number,
  targetValue: number,
  feature: string = 'Optical Flow (fg)',
  options?: ProjectOptions
): Promise<ProjectResponse> {
  const body: Record<string, unknown> = { pointIndex, targetValue, feature };
  if (options?.method) body.method = options.method;
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
}

export async function getAxisTrajectory(
  feature: string = 'Optical Flow (fg)',
  numPoints: number = 80,
  options?: AxisTrajectoryOptions
): Promise<AxisTrajectoryResponse> {
  const params = new URLSearchParams({
    feature,
    num_points: String(numPoints),
  });
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

export async function getFeatureStats(feature: string = 'Fragment Length'): Promise<FeatureStats> {
  const url = `${API_BASE}/api/feature-stats?feature=${encodeURIComponent(feature)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feature stats failed: ${res.status}`);
  return res.json();
}

export async function getFeatureValues(featureName: string): Promise<number[]> {
  // Backend accepts "Fragment Length" or "Fragment_Length"
  const name = featureName.replace(/\s+/g, '_');
  const res = await fetch(`${API_BASE}/api/features/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Feature values failed: ${res.status}`);
  const data = await res.json();
  return data.values ?? [];
}

export async function healthCheck(): Promise<{
  embeddings_loaded: boolean;
  umap_points_loaded: boolean;
  umap_reducer_loaded: boolean;
  embedding_count: number;
  features: string[];
  axes: string[];
}> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
