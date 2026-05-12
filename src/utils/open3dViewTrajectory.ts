import * as THREE from 'three';

/**
 * One keyframe from Open3D's `ViewTrajectory` JSON (Visualizer → save / export).
 * @see https://www.open3d.org/docs/release/tutorial/visualization/customized_visualization.html
 */
export interface Open3dViewTrajectoryKeyframe {
  boundingbox_max?: [number, number, number];
  boundingbox_min?: [number, number, number];
  field_of_view?: number;
  /** World-space viewing direction (camera looks along +front toward `lookat`). */
  front: [number, number, number];
  lookat: [number, number, number];
  up: [number, number, number];
  /** Open3D scales camera distance relative to the scene bounding-box extent. */
  zoom: number;
}

export interface Open3dViewTrajectoryFile {
  trajectory?: Open3dViewTrajectoryKeyframe[];
}

function bboxDiagonalExtent(k: Open3dViewTrajectoryKeyframe): number {
  if (!k.boundingbox_max || !k.boundingbox_min) return 1;
  const max = new THREE.Vector3(...k.boundingbox_max);
  const min = new THREE.Vector3(...k.boundingbox_min);
  return Math.max(1e-6, max.distanceTo(min));
}

/** `up` made perpendicular to `front` (right-handed camera frame). */
function cameraUpFromOpen3d(front: THREE.Vector3, upRaw: THREE.Vector3): THREE.Vector3 {
  const f = front.clone().normalize();
  let u = upRaw.clone();
  u.sub(f.clone().multiplyScalar(u.dot(f)));
  if (u.lengthSq() < 1e-12) u.set(0, 1, 0);
  return u.normalize();
}

export interface Open3dToOrbitResult {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  /** Degrees; pass to `PerspectiveCamera.fov` if desired. */
  fovDeg: number;
}

/**
 * Maps an Open3D visualizer keyframe to Three.js orbit-style camera state.
 *
 * Convention (matches Open3D’s pinhole / view-control behaviour): the camera
 * sits on the ray `lookat - t * front` with `t = zoom * ||bbox_max - bbox_min||`.
 * Your exported `front` should already be unit length; we normalise anyway.
 *
 * **Important for MitoSpace:** point positions in `Visualizer4D` are
 * `(embedding - centroid) * SCALE_FACTOR` with target at the origin. If you
 * composed the Open3D view on **raw** embedding coordinates, transform both
 * `position` and `target` with the same affine map before assigning them to
 * `camera.position` and `controls.target`.
 */
export function open3dKeyframeToOrbitCamera(
  k: Open3dViewTrajectoryKeyframe,
  options?: { distanceScale?: number }
): Open3dToOrbitResult {
  const distanceScale = options?.distanceScale ?? 1;
  const target = new THREE.Vector3(...k.lookat);
  const frontDir = new THREE.Vector3(...k.front).normalize();
  const up = cameraUpFromOpen3d(frontDir, new THREE.Vector3(...k.up));
  const extent = bboxDiagonalExtent(k);
  const distance = extent * k.zoom * distanceScale;
  const position = target.clone().sub(frontDir.clone().multiplyScalar(distance));
  const fovDeg = k.field_of_view ?? 60;
  return { position, target, up, fovDeg };
}

/**
 * Apply the same center + uniform scale used when building the Three.js point
 * cloud from embedding CSV/JSON (`center` = mean of xyz in data space).
 */
export function mapEmbeddingPointToScene(
  p: THREE.Vector3,
  center: THREE.Vector3,
  scaleFactor: number
): THREE.Vector3 {
  return new THREE.Vector3(
    (p.x - center.x) * scaleFactor,
    (p.y - center.y) * scaleFactor,
    (p.z - center.z) * scaleFactor
  );
}

/** Optional: load first keyframe from parsed JSON. */
export function firstKeyframeFromViewTrajectoryJson(
  data: Open3dViewTrajectoryFile
): Open3dViewTrajectoryKeyframe | null {
  const t = data.trajectory;
  if (!t?.length) return null;
  return t[0] ?? null;
}
