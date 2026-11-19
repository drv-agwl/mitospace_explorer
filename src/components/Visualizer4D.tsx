import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Home, ZoomIn, ZoomOut, HelpCircle, Maximize2, Minimize2, Grid3X3 } from 'lucide-react';
import { MAX_COMPARE_CELLS, useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import SemanticAxisPreview from './SemanticAxisPreview';
import DrugConditionStrip from './DrugConditionStrip';
import SmoothHeight from './SmoothHeight';
import CompareTray from './CompareTray';
import { prefersReducedMotion } from '../utils/motion';
import { projectOnAxis, getAxisTrajectory } from '../api/client';
import { loadFeatureAxis } from '../data/sampleData';
import type { FeatureAxis } from '../utils/featureAxis';
import { featureToColorPlasmaAdaptive, NO_MEASUREMENT_RGB, plasmaAtT } from '../utils/featureColor';
import { adaptColorForDarkTheme, rgbCss } from '../utils/colorUtils';
import { dropdownCloseInProgressRef } from '../utils/dropdownCloseRef';
import { buildSampleIdToIndex } from '../utils/sampleIndexMap';
import { computeDistancesToPolyline, buildFadeFactors } from '../utils/axisDistance';
import { estimatePlasmaParams } from '../utils/featureColorParams';
import {
  computeQuantileBeads,
  computeEndpointAnchors,
  polylineSegmentDensities,
  estimateDensityRadius,
  type AxisBead,
  type EndpointAnchors,
} from '../utils/axisGeometry';
import {
  buildTrajectorySnapPath,
  evaluateCursorPath,
  type CursorPath,
} from '../utils/axisCursorPath';
import type { AxisStyle, Sample } from '../types';
import { getFeatureDisplayLabel } from '../constants/features';
import { conditionLabel } from '../constants/conditions';
import { formatFeatureValue } from '../utils/formatFeature';
import { trackError, trackEvent } from '../analytics';

const SCALE_FACTOR = 4;
const INTRO_SEEN_STORAGE_KEY = 'mitospace.introSeen';
// Load time is measured once per page load; returning from About remounts this component.
let explorerReadyReported = false;

/** Default orbit distance: symmetric diagonal toward origin (v1). */
function v1DiagonalCameraCoord(): number {
  const initDist = 1 + 0.26 * 299;
  return initDist / Math.sqrt(3);
}

/**
 * v3 default camera — exact pose captured in-app (user Shift+C export).
 * Position / target / up / FOV are fixed in scene space (centered cloud at origin).
 */
const V3_DEFAULT_CAMERA = {
  position: new THREE.Vector3(-20.0188, 86.7031, 4.1465),
  target: new THREE.Vector3(-2.1732, -0.0622, -1.3373),
  up: new THREE.Vector3(0, 1, 0),
  fov: 50,
} as const;

function applyV3PinnedDefaultCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls): void {
  camera.fov = V3_DEFAULT_CAMERA.fov;
  camera.up.copy(V3_DEFAULT_CAMERA.up);
  camera.position.copy(V3_DEFAULT_CAMERA.position);
  controls.target.copy(V3_DEFAULT_CAMERA.target);
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  controls.update();
}

/** Reused for dense point picking (avoid per-click allocations). */
const pickWorldP = new THREE.Vector3();
const pickViewP = new THREE.Vector3();
const pickNdc = new THREE.Vector3();

/** Colour changes on the map (condition ↔ feature, feature ↔ feature) ease over this long. */
const COLOR_TWEEN_MS = 450;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Eases a colour buffer to `target`, starting from what it shows now, so a retarget mid-way stays smooth. */
function tweenColors(
  attr: THREE.BufferAttribute,
  target: Float32Array,
  durationMs: number,
  rafRef: { current: number },
  onFrame: () => void
): void {
  cancelAnimationFrame(rafRef.current);
  rafRef.current = 0;
  const colors = attr.array as Float32Array;
  if (durationMs <= 0) {
    colors.set(target);
    attr.needsUpdate = true;
    onFrame();
    return;
  }
  const from = colors.slice();
  // Clock starts at the first frame, so work right after the click doesn't eat into the ease.
  let start = -1;
  const step = (now: number) => {
    if (start < 0) start = now;
    const t = Math.min(1, (now - start) / durationMs);
    const e = easeInOutCubic(t);
    for (let i = 0; i < colors.length; i++) colors[i] = from[i] + (target[i] - from[i]) * e;
    attr.needsUpdate = true;
    onFrame();
    rafRef.current = t < 1 ? requestAnimationFrame(step) : 0;
  };
  rafRef.current = requestAnimationFrame(step);
}

/** Builds the selected-cell marker: white ring, dark halo for contrast, and the cell's dot drawn on top. */
function createSelectionMarker(color: THREE.Color): THREE.Mesh {
  const overlay = { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide };
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.95, ...overlay })
  );
  ring.renderOrder = 22;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.2, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.55, ...overlay })
  );
  halo.renderOrder = 21;
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({ color, opacity: 1, ...overlay })
  );
  core.renderOrder = 23;
  ring.add(halo, core);
  ring.userData.core = core;
  return ring;
}

/** Sizes the marker in screen pixels around the drawn dot (same sprite maths as picking) and faces it to the camera. */
function fitSelectionMarker(
  marker: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  viewportHeightPx: number,
  pointSize: number
): void {
  const h = Math.max(1, viewportHeightPx);
  camera.updateMatrixWorld();
  pickViewP.copy(marker.position).applyMatrix4(camera.matrixWorldInverse);
  const viewZ = Math.max(1e-3, -pickViewP.z);
  const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewZ) / h;
  const dotRadiusPx = Math.max(2.5, (pointSize * h * 0.25) / viewZ);
  const ringRadiusPx = Math.max(11, dotRadiusPx + 7) + (marker.userData.onTrajectory ? 4 : 0);
  marker.scale.setScalar(ringRadiusPx * worldPerPx);
  marker.quaternion.copy(camera.quaternion);
  const core = marker.userData.core as THREE.Object3D | undefined;
  core?.scale.setScalar(Math.min(0.6, (dotRadiusPx + 0.5) / ringRadiusPx));
}

/**
 * Pick the point whose drawn sprite is closest to the click (CSS pixels).
 *
 * `PointsMaterial` + `sizeAttenuation: true` renders each sample at
 *   gl_PointSize = pointSize * (canvasHeightDevice / 2) / -viewZ
 * → CSS-pixel diameter = pointSize * cssHeight / (2 * viewZ).
 *
 * We compute that exact radius per point and accept any vertex whose
 * **projected center** is within `radius + slack` CSS pixels of the click.
 * Among candidates the **screen-closest** wins (matches the user's visual
 * intent); ties within 1.5 px fall through to camera-near. This avoids the
 * trap where the front-most point in a stack wins even when the user's
 * click is clearly inside the back disk.
 */
function pickFilteredPointIndexFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.PerspectiveCamera,
  posAttr: THREE.BufferAttribute,
  count: number,
  pointSizeWorld: number
): number {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  camera.updateMatrixWorld();

  // Empty-cursor slack so the user can miss the disk by a few pixels.
  const SLACK_PX = 4;
  // Tiny far-away sprites become hard to hit; clamp at 6 px floor.
  const MIN_RADIUS_PX = 6;
  // Treat near-zero-pointSize gracefully.
  const sizeMul = pointSizeWorld * h * 0.25; // = pointSize * h / 4

  let bestIdx = -1;
  let bestScreenDist = Infinity;
  let bestViewZ = Infinity;

  for (let i = 0; i < count; i++) {
    pickWorldP.fromBufferAttribute(posAttr, i);

    // View-space Z drives BOTH culling AND the drawn pixel size.
    pickViewP.copy(pickWorldP).applyMatrix4(camera.matrixWorldInverse);
    const viewZ = -pickViewP.z;
    if (viewZ < camera.near || viewZ > camera.far) continue;

    // Project to NDC, then to CSS pixels.
    pickNdc.copy(pickWorldP).project(camera);
    if (pickNdc.x < -1.05 || pickNdc.x > 1.05 || pickNdc.y < -1.05 || pickNdc.y > 1.05) continue;
    const sx = (pickNdc.x + 1) * 0.5 * w;
    const sy = (1 - pickNdc.y) * 0.5 * h;
    const dx = sx - cx;
    const dy = sy - cy;
    const screenDist = Math.hypot(dx, dy);

    // Exact CSS-pixel radius of what's actually drawn at this depth.
    const drawnRadiusPx = sizeMul / viewZ;
    const hitRadius = Math.max(MIN_RADIUS_PX, drawnRadiusPx + SLACK_PX);
    if (screenDist > hitRadius) continue;

    if (
      screenDist < bestScreenDist - 1.5 ||
      (Math.abs(screenDist - bestScreenDist) <= 1.5 && viewZ < bestViewZ)
    ) {
      bestScreenDist = screenDist;
      bestViewZ = viewZ;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Round point sprite (white, tinted per vertex by the cloud's colours). */
function generatePointTexture(darkMode: boolean): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 2;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);

  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  if (darkMode) {
    // Crisp gradient for dark mode - retains color to edges
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.85)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
  } else {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  }
  context.fillStyle = gradient;
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const Visualizer4D: React.FC = () => {
  const {
    filteredSamples4D,
    samples4D,
    selectedSample,
    selectedPointIndex,
    setSelectedSample,
    setSelectedPointIndex,
    visualizerOptions,
    setShowGrid,
    semanticState,
    coloringFeature,
    featureValues,
    setSemanticState,
    apiEmbeddingCount,
    datasetVersion,
    searchQuery,
    selectedDrugs,
    clearDrugFilter,
    compareSamples,
    compareHidden,
    compareOpen,
    toggleCompare,
    comparePicking,
    setComparePicking,
    setMapFocusHandler,
  } = useSample();

  const axisColorPending = Boolean(
    semanticState.advancedMode &&
      semanticState.selectedFeature &&
      !semanticState.featureLoadFailed &&
      coloringFeature !== semanticState.selectedFeature
  );
  const pendingFeatureLabel = semanticState.selectedFeature
    ? getFeatureDisplayLabel(semanticState.selectedFeature, datasetVersion)
    : null;

  // True when active filters (condition/search) exclude every cell. We show a
  // helpful overlay + reset instead of a silent empty canvas.
  const noSamplesAfterFilter =
    samples4D.length > 0 &&
    filteredSamples4D.length === 0 &&
    (selectedDrugs.size > 0 || searchQuery.trim().length > 0);

  const sampleIdToEmbeddingIndex = React.useMemo(
    () => buildSampleIdToIndex(samples4D),
    [samples4D]
  );
  const filterKey = `${Array.from(selectedDrugs).sort().join(',')}|${searchQuery.trim()}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  /** One material (and point texture) for the cloud; geometry is rebuilt only when the cell count changes. */
  const pointsMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const pointsOpacityRef = useRef(1);
  /** Cell list the colour buffer was last painted for. */
  const colorsPaintedForRef = useRef<unknown>(null);
  const colorTweenRef = useRef(0);
  /** Schedule one frame; the scene is only drawn when something changed. */
  const requestRenderRef = useRef<() => void>(() => {});
  /** Filter the camera was last framed for; starts unfiltered so a shared filtered link is framed on load. */
  const lastFilterKeyRef = useRef('|');
  const selectedPointMeshRef = useRef<THREE.Mesh | null>(null);
  const targetHighlightPosRef = useRef<THREE.Vector3 | null>(null);
  const pointSizeRef = useRef(visualizerOptions.pointSize);
  pointSizeRef.current = visualizerOptions.pointSize;
  /** Hover indicator ring: shows which point a click would select. */
  const hoverRingRef = useRef<THREE.Mesh | null>(null);
  /** Condition name next to the hovered dot (written directly, no re-render). */
  const hoverLabelRef = useRef<HTMLDivElement>(null);
  const hoverTextRef = useRef<HTMLSpanElement>(null);
  /** What a click on the hovered dot will do, while that is not obvious. */
  const hoverHintRef = useRef<HTMLSpanElement>(null);
  const hoverFrameQueuedRef = useRef(false);
  const lastPointerCssRef = useRef<{ x: number; y: number } | null>(null);
  const selectedSampleIdRef = useRef<string | null>(null);
  const trajectoryLineRef = useRef<THREE.Group | null>(null);
  // Iso-disk that hovers at the slider's position along the axis.
  const isoDiskRef = useRef<{
    group: THREE.Group;
    disk: THREE.Mesh;
    ring: THREE.Mesh;
    curve: THREE.CatmullRomCurve3;
  } | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const grid2Ref = useRef<THREE.GridHelper | null>(null);
  /** Mean xyz (embedding space) from the last point-cloud build; used to pan camera when filtering re-centroids the cloud. */
  const prevEmbeddingCentroidRef = useRef<THREE.Vector3 | null>(null);
  /** True once the point cloud has played its initial fade-in. */
  const pointsHaveFadedInRef = useRef(false);
  /** Numbered tags on compared cells; repositioned after every frame. */
  const compareMarkersRef = useRef<HTMLDivElement>(null);
  const afterRenderRef = useRef<() => void>(() => {});
  const flyToRafRef = useRef(0);
  const [compareFullNotice, setCompareFullNotice] = useState(false);
  const compareNoticeTimerRef = useRef(0);
  const flashCompareFull = useCallback(() => {
    setCompareFullNotice(true);
    window.clearTimeout(compareNoticeTimerRef.current);
    compareNoticeTimerRef.current = window.setTimeout(() => setCompareFullNotice(false), 2400);
  }, []);

  const [trajectoryPoints, setTrajectoryPoints] = useState<Array<{ x: number; y: number; z: number }> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const fpsTextRef = useRef<HTMLSpanElement>(null);
  const fpsDotRef = useRef<HTMLSpanElement>(null);
  const [pointCount, setPointCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  // Dark mode is currently fixed on; keep as a const to avoid an unused setter.
  const [isDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [graphicsLost, setGraphicsLost] = useState(false);
  // Visitors should see the condition movies right away; "Hide movies" collapses to a one-row rail.
  const [drugStripExpanded, setDrugStripExpanded] = useState(true);
  const [introVisible, setIntroVisible] = useState(() => {
    try {
      return window.localStorage?.getItem(INTRO_SEEN_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const dismissIntro = useCallback(() => {
    setIntroVisible(false);
    try {
      window.localStorage?.setItem(INTRO_SEEN_STORAGE_KEY, '1');
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }, []);

  const toggleHelp = () => {
    setShowHelp((v) => !v);
  };

  const cloudCenter = React.useMemo(() => {
    const center = new THREE.Vector3();
    for (const s of filteredSamples4D) {
      center.x += s.x;
      center.y += s.y;
      center.z += s.z;
    }
    return center.divideScalar(filteredSamples4D.length);
  }, [filteredSamples4D]);
  const getCenter = useCallback(() => cloudCenter.clone(), [cloudCenter]);

  const toScenePos = useCallback(
    (x: number, y: number, z: number) => {
      const c = getCenter();
      return new THREE.Vector3(
        (x - c.x) * SCALE_FACTOR,
        (y - c.y) * SCALE_FACTOR,
        (z - c.z) * SCALE_FACTOR
      );
    },
    [getCenter]
  );

  const disposeHighlight = useCallback(() => {
    const mesh = selectedPointMeshRef.current;
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    });
    selectedPointMeshRef.current = null;
  }, []);

  const createOrUpdateHighlight = useCallback(
    (position: THREE.Vector3, color: THREE.Color, onTrajectory = false) => {
      if (!sceneRef.current) return;
      disposeHighlight();
      const mesh = createSelectionMarker(color);
      mesh.userData.onTrajectory = onTrajectory;
      mesh.position.copy(position);
      sceneRef.current.add(mesh);
      selectedPointMeshRef.current = mesh;
      targetHighlightPosRef.current = position.clone();
    },
    [disposeHighlight]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    
    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(
      50,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    
    cameraRef.current = camera;
    // A new camera has not been framed for the current filter yet.
    lastFilterKeyRef.current = '|';
    
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    const w = Math.max(1, containerRef.current.clientWidth);
    const h = Math.max(1, containerRef.current.clientHeight);
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 300;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 2.0;
    controls.panSpeed = 0.8;
    controls.enableZoom = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    
    controlsRef.current = controls;
    
    // Initial camera (v1-style diagonal); v3 overrides in datasetVersion effect
    const initCoord = v1DiagonalCameraCoord();
    camera.position.set(initCoord, initCoord, initCoord);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    
    // Add control state monitors
    let interacted = false;
    controls.addEventListener('start', () => {
      setIsDragging(true);
      if (!interacted) {
        interacted = true;
        trackEvent('map_interact');
      }
    });
    
    controls.addEventListener('end', () => {
      setIsDragging(false);
    });
    
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Floor grid — XZ plane (horizontal, no rotation)
    const gridSize = 280;
    const gridDivisions = 56;
    const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x4a4a4a, 0x2d2d2d);
    grid.position.y = 0;
    grid.renderOrder = -1;
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.opacity = 0.28;
    gridMat.transparent = true;
    scene.add(grid);
    gridRef.current = grid;

    // Back wall grid — XY plane (vertical, perpendicular to floor)
    const grid2 = new THREE.GridHelper(gridSize, gridDivisions, 0x4a4a4a, 0x2d2d2d);
    grid2.rotation.x = -Math.PI / 2;
    grid2.position.z = 0;
    grid2.renderOrder = -1;
    const grid2Mat = grid2.material as THREE.LineBasicMaterial;
    grid2Mat.opacity = 0.22;
    grid2Mat.transparent = true;
    scene.add(grid2);
    grid2Ref.current = grid2;

    // Hover preview ring: thin wireframe circle billboarded toward the camera
    // showing which point the next click will select. Lives forever, scaled
    // per-frame to track sprite size.
    const hoverGeom = new THREE.RingGeometry(0.85, 1, 48);
    const hoverMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const hoverRing = new THREE.Mesh(hoverGeom, hoverMat);
    hoverRing.renderOrder = 20;
    hoverRing.visible = false;
    scene.add(hoverRing);
    hoverRingRef.current = hoverRing;
    
    // FPS counter — write to DOM refs so we don't re-render the whole tree.
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId = 0;
    let contextLost = false;

    const updateFPS = () => {
      const now = performance.now();
      frameCount++;
      if (now - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastTime));
        frameCount = 0;
        lastTime = now;
        if (fpsTextRef.current) fpsTextRef.current.textContent = `${fps} FPS`;
        if (fpsDotRef.current) {
          fpsDotRef.current.className = `w-1.5 h-1.5 rounded-full ${
            fps > 30 ? 'bg-emerald-500' : fps > 15 ? 'bg-amber-500' : 'bg-red-500'
          }`;
        }
      }
    };

    // Draw on demand: a frame is scheduled when something changes and keeps
    // rescheduling only while the camera is easing (damping) or the highlight glides.
    const LERP_SPEED = 0.35;
    const renderFrame = () => {
      rafId = 0;
      if (contextLost) return;
      let gliding = false;
      const mesh = selectedPointMeshRef.current;
      const target = targetHighlightPosRef.current;
      if (mesh && target && mesh.position.distanceTo(target) > 0.001) {
        mesh.position.lerp(target, LERP_SPEED);
        gliding = true;
      }
      // Emits 'change' (→ another frame) while damping is still moving the camera.
      controls.update();
      if (mesh) fitSelectionMarker(mesh, camera, renderer.domElement.clientHeight, pointSizeRef.current);
      renderer.render(scene, camera);
      afterRenderRef.current();
      updateFPS();
      if (gliding) requestRender();
    };
    const requestRender = () => {
      if (rafId === 0 && !contextLost) rafId = requestAnimationFrame(renderFrame);
    };
    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);

    // The browser can drop the GPU context (driver reset, GPU pressure). Three.js restores its
    // own state; we pause drawing, tell the user, and redraw once the context is back.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      setGraphicsLost(true);
      trackError('webgl', 'context lost');
    };
    const onContextRestored = () => {
      contextLost = false;
      setGraphicsLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    requestRender();
    setIsLoading(false);
    
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = Math.max(1, containerRef.current.clientWidth);
      const h = Math.max(1, containerRef.current.clientHeight);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      // setSize clears the canvas: draw now, before this frame is painted, so it never flashes blank.
      if (rafId) cancelAnimationFrame(rafId);
      renderFrame();
    };
    
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);

    // Add specific wheel event handler for better trackpad pinch-to-zoom support
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        
        const delta = -event.deltaY;
        const zoomSpeed = 0.1;
        
        if (cameraRef.current && controlsRef.current) {
          const currentPos = cameraRef.current.position.clone();
          const direction = new THREE.Vector3(0, 0, 0).sub(currentPos).normalize();
          const zoomAmount = delta * zoomSpeed;
          
          cameraRef.current.position.addScaledVector(direction, zoomAmount);
          controlsRef.current.update();
        }
      }
    };
    
    containerRef.current.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      requestRenderRef.current = () => {};
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheel);
      }
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      if (pointsRef.current && sceneRef.current) {
        sceneRef.current.remove(pointsRef.current);
        pointsRef.current.geometry.dispose();
        pointsRef.current = null;
      }
      if (pointsMaterialRef.current) {
        pointsMaterialRef.current.map?.dispose();
        pointsMaterialRef.current.dispose();
        pointsMaterialRef.current = null;
      }
      disposeHighlight();
      if (trajectoryLineRef.current && sceneRef.current) {
        sceneRef.current.remove(trajectoryLineRef.current);
        trajectoryLineRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (child.material) (child.material as THREE.Material).dispose();
          }
        });
        trajectoryLineRef.current = null;
      }
      if (gridRef.current && sceneRef.current) {
        sceneRef.current.remove(gridRef.current);
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
        gridRef.current = null;
      }
      if (grid2Ref.current && sceneRef.current) {
        sceneRef.current.remove(grid2Ref.current);
        grid2Ref.current.geometry.dispose();
        (grid2Ref.current.material as THREE.Material).dispose();
        grid2Ref.current = null;
      }
      if (hoverRingRef.current && sceneRef.current) {
        sceneRef.current.remove(hoverRingRef.current);
        hoverRingRef.current.geometry.dispose();
        (hoverRingRef.current.material as THREE.Material).dispose();
        hoverRingRef.current = null;
      }
      // Free the GPU context now rather than at GC, so route changes never pile up contexts.
      renderer.dispose();
      renderer.forceContextLoss();
      rendererRef.current = null;
    };
  }, [disposeHighlight]);

  // Apply default camera when dataset version changes.
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    if (datasetVersion === 'v3') {
      applyV3PinnedDefaultCamera(cameraRef.current, controlsRef.current);
      return;
    }
    const c = v1DiagonalCameraCoord();
    cameraRef.current.position.set(c, c, c);
    cameraRef.current.up.set(0, 1, 0);
    cameraRef.current.lookAt(0, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [datasetVersion]);

  // New dataset → first filtered rebuild should not compensate camera against old centroid.
  useEffect(() => {
    prevEmbeddingCentroidRef.current = null;
  }, [datasetVersion]);

  // Update scene background and lighting when dark mode changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = null;

      const lights = sceneRef.current.children.filter(child => child instanceof THREE.Light);
      lights.forEach(light => {
        if (light instanceof THREE.AmbientLight) {
          light.intensity = isDarkMode ? 0.6 : 0.7;
        } else if (light instanceof THREE.DirectionalLight) {
          light.intensity = isDarkMode ? 0.8 : 0.8;
        }
      });
    }
  }, [isDarkMode, visualizerOptions.backgroundColor]);

  // Grids pass through center (origin) — no positioning update needed

  // Toggle grid visibility
  useEffect(() => {
    const show = visualizerOptions.showGrid !== false;
    if (gridRef.current) gridRef.current.visible = show;
    if (grid2Ref.current) grid2Ref.current.visible = show;
  }, [visualizerOptions.showGrid]);

  const useFeatureColoring = Boolean(
    semanticState.advancedMode &&
      coloringFeature &&
      featureValues[coloringFeature]?.length &&
      semanticState.featureRange
  );

  // Per-feature plasma tuning (gamma + contrast) computed from the selected
  // feature's distribution and cached by array reference.
  const plasmaParams = React.useMemo(() => {
    if (!useFeatureColoring) return { gamma: undefined, contrast: undefined } as const;
    const fname = coloringFeature;
    if (!fname) return { gamma: undefined, contrast: undefined } as const;
    const fv = featureValues[fname];
    if (!fv) return { gamma: undefined, contrast: undefined } as const;
    const p = estimatePlasmaParams(fv);
    return { gamma: p.gamma, contrast: p.contrast } as const;
  }, [useFeatureColoring, coloringFeature, featureValues]);

  // Visible cells without a value for the active feature (drawn grey, outside the scale).
  const missingFeatureCount = React.useMemo(() => {
    if (!useFeatureColoring || !coloringFeature) return 0;
    const fv = featureValues[coloringFeature];
    if (!fv) return 0;
    let n = 0;
    for (const s of filteredSamples4D) {
      const ei = sampleIdToEmbeddingIndex.get(s.id) ?? -1;
      if (ei < 0 || ei >= fv.length || !Number.isFinite(fv[ei])) n++;
    }
    return n;
  }, [useFeatureColoring, coloringFeature, featureValues, filteredSamples4D, sampleIdToEmbeddingIndex]);

  // Smoothed colours and the cursor path are computed in the dataset worker and cached per
  // feature + filter, so a feature switch never blocks the page.
  const axisRange = semanticState.featureRange;
  const featureAxisKey =
    useFeatureColoring && coloringFeature && axisRange
      ? `${coloringFeature}|${filterKey}|${axisRange.min}|${axisRange.max}`
      : null;
  const [featureAxis, setFeatureAxis] = useState<{ key: string; axis: FeatureAxis } | null>(null);
  useEffect(() => {
    const values = coloringFeature ? featureValues[coloringFeature] : undefined;
    if (!featureAxisKey || !values || !axisRange) return;
    let cancelled = false;
    const indices =
      filteredSamples4D.length === samples4D.length
        ? null
        : Int32Array.from(filteredSamples4D, (s) => sampleIdToEmbeddingIndex.get(s.id) ?? -1);
    loadFeatureAxis(featureAxisKey, values, indices, axisRange).then(
      (axis) => {
        if (!cancelled) setFeatureAxis({ key: featureAxisKey, axis });
      },
      (err) => console.warn('[axis] feature axis failed', err)
    );
    return () => {
      cancelled = true;
    };
  }, [
    featureAxisKey,
    coloringFeature,
    featureValues,
    axisRange,
    filteredSamples4D,
    samples4D,
    sampleIdToEmbeddingIndex,
  ]);
  const readyAxis = featureAxis?.key === featureAxisKey ? featureAxis.axis : null;
  const smoothedFeatureValues = readyAxis?.smoothed ?? null;

  // ─── New axis-style state (A/B switch) ────────────────────────────────
  // We precompute quantile beads, endpoint anchors and a dense cursor path
  // *once per feature* from the filtered cloud; the slider then cheaply
  // interpolates positions without recomputing geometry.
  const axisStyle: AxisStyle = semanticState.axisStyle ?? 'cursor';
  // Cursor-family modes share a common UI footprint: the cursor ball is
  // the only 3D feedback element. `cursor` builds the path locally from
  // density modes; `cursor-axis` builds it by snapping the backend's
  // learnt trajectory onto real cells (smoother for most features).
  const isCursorMode = axisStyle === 'cursor' || axisStyle === 'cursor-axis';

  /**
   * Sample-id → embedding-index lookup for the *filtered* cloud, in
   * filtered-index order. Quantile beads / endpoint anchors need to
   * dereference feature values by embedding index, so we pass this through.
   */
  const filteredEmbeddingIndexOf = useCallback(
    (filteredIdx: number) => {
      const s = filteredSamples4D[filteredIdx];
      if (!s) return -1;
      return sampleIdToEmbeddingIndex.get(s.id) ?? -1;
    },
    [filteredSamples4D, sampleIdToEmbeddingIndex]
  );

  /**
   * Quantile beads in *raw UMAP coordinates*. Re-computed only when the
   * feature, the filtered cloud, or the feature range changes — never on
   * camera moves or slider drags.
   */
  const quantileBeads = React.useMemo<AxisBead[]>(() => {
    if (!useFeatureColoring || axisStyle !== 'beads') return [];
    const fname = coloringFeature;
    if (!fname) return [];
    const fv = featureValues[fname];
    const fr = semanticState.featureRange;
    if (!fv || !fr) return [];
    return computeQuantileBeads(filteredSamples4D, fv, filteredEmbeddingIndexOf, fr, 7, 24);
  }, [
    useFeatureColoring,
    axisStyle,
    coloringFeature,
    semanticState.featureRange,
    featureValues,
    filteredSamples4D,
    filteredEmbeddingIndexOf,
  ]);

  /**
   * Endpoint anchor centroids for the `bare` style.
   */
  const endpointAnchors = React.useMemo<EndpointAnchors | null>(() => {
    if (!useFeatureColoring || axisStyle !== 'bare') return null;
    const fname = coloringFeature;
    if (!fname) return null;
    const fv = featureValues[fname];
    if (!fv) return null;
    return computeEndpointAnchors(filteredSamples4D, fv, filteredEmbeddingIndexOf, 0.05);
  }, [
    useFeatureColoring,
    axisStyle,
    coloringFeature,
    featureValues,
    filteredSamples4D,
    filteredEmbeddingIndexOf,
  ]);

  /**
   * Hidden cell-anchored cursor path. Dispatches on axis style:
   *
   *   cursor       — mode-seeking over feature-value-nearest cells with a
   *                  bucket-count tiebreak. Locates the densest cluster
   *                  of cells matching each slider value, picks a core
   *                  cell in that cluster.
   *   cursor-axis  — snaps each backend trajectory point to its nearest
   *                  real cell. Smoother through contiguous regions
   *                  because the backend trajectory is sorted by feature
   *                  value, so adjacent waypoints are spatially close.
   *
   * Both paths are consumed by the same `evaluateCursorPath`, which lerps
   * within a cluster and snaps (teleports) across inter-cluster jumps.
   */
  const cursorPath = React.useMemo<CursorPath | null>(() => {
    if (!useFeatureColoring) return null;
    const fr = semanticState.featureRange;
    if (!fr) return null;

    if (axisStyle === 'cursor-axis') {
      if (trajectoryPoints && trajectoryPoints.length >= 2) {
        return buildTrajectorySnapPath(trajectoryPoints, filteredSamples4D, fr);
      }
      // Backend trajectory unavailable (e.g. offline). Fall through to
      // the local density-mode path so the cursor still works.
    }
    if (axisStyle === 'cursor' || axisStyle === 'cursor-axis') {
      return readyAxis?.cursorPath ?? null;
    }
    return null;
  }, [
    axisStyle,
    useFeatureColoring,
    semanticState.featureRange,
    filteredSamples4D,
    trajectoryPoints,
    readyAxis,
  ]);

  // Fetch backend trajectory whenever Advanced Semantic + feature are set.
  // In cursor mode we don't render the backend trajectory, but we still
  // need to know "is the axis engaged" for the cloud dim — the cursorPath
  // memo (computed entirely client-side) handles that without a network
  // call, so we skip the fetch in cursor mode.
  useEffect(() => {
    if (!semanticState.advancedMode || !semanticState.selectedFeature) {
      setTrajectoryPoints(null);
      return;
    }
    if (axisStyle === 'cursor') {
      // `cursor` is purely client-side; clear any stale trajectory so
      // the legacy axis-distance fade and axisFadeFactors stay disabled.
      // `cursor-axis` still needs the trajectory (we snap it onto real
      // cells), so we fall through to the fetch for that style.
      setTrajectoryPoints(null);
      return;
    }
    const feature = semanticState.selectedFeature as string;
    getAxisTrajectory(feature, 80, { version: datasetVersion })
      .then((res) => {
        const count = res.points?.length ?? 0;
        if (count >= 2) {
          setTrajectoryPoints(res.points!);
        } else {
          setTrajectoryPoints(null);
        }
      })
      .catch((err) => {
        console.warn('[trajectory] fetch failed', err);
        setTrajectoryPoints(null);
      });
  }, [semanticState.advancedMode, semanticState.selectedFeature, datasetVersion, axisStyle]);

  // ─── Trajectory rendering ────────────────────────────────────────────
  //
  // Four representations are shipped behind a runtime switch (`axisStyle`)
  // so the team can A/B them. All four dispose their geometries on cleanup
  // and write into `trajectoryLineRef` so the rest of the visualizer can
  // remain agnostic.
  //
  //   cursor       — NO path geometry. Only the slider-driven ball moves
  //                  along a hidden density-grounded trajectory.
  //                  (Handled by the marker effect below — this effect
  //                  short-circuits.)
  //   tube         — original Catmull-Rom plasma tube + arrow cones.
  //   tube-masked  — same tube, but split into K sub-segments whose alpha
  //                  is driven by local point density. The tube fades to
  //                  invisible in empty UMAP regions.
  //   beads        — discrete quantile waypoints anchored to cell
  //                  centroids; bookend Low/High arrows at the chain
  //                  endpoints; a thin connector whose per-segment alpha
  //                  is again density-gated.
  //   bare         — no path geometry. Two endpoint anchor spheres only;
  //                  the colored cloud itself carries the gradient story.
  //
  useEffect(() => {
    if (!sceneRef.current) return;

    const disposeGroup = (g: THREE.Group | null) => {
      if (!g || !sceneRef.current) return;
      sceneRef.current.remove(g);
      g.traverse((child) => {
        const m = child as THREE.Mesh | THREE.LineSegments | THREE.Line;
        // dispose geometry
        if ('geometry' in m && m.geometry) {
          (m.geometry as THREE.BufferGeometry).dispose();
        }
        // dispose material(s)
        if ('material' in m && m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else mat.dispose();
        }
      });
    };

    disposeGroup(trajectoryLineRef.current);
      trajectoryLineRef.current = null;

    // Cursor-family modes: render NO path geometry. The slider-marker
    // effect is the sole source of axis feedback for both `cursor` and
    // `cursor-axis`.
    if (isCursorMode) return;

    // Nothing to draw if semantic mode is off, no feature is selected, or
    // we're in `bare` style (which intentionally renders no path geometry
    // beyond the endpoint anchors handled later in this effect).
    const hasTrajectory = !!(trajectoryPoints && trajectoryPoints.length >= 2);
    const hasBeads = quantileBeads.length >= 2;
    if (axisStyle !== 'bare' && !hasTrajectory && !hasBeads) return;

    const center =
      filteredSamples4D.length > 0
        ? getCenter()
        : new THREE.Vector3(0, 0, 0);
    const toScene = (p: { x: number; y: number; z: number }) =>
      new THREE.Vector3(
        (p.x - center.x) * SCALE_FACTOR,
        (p.y - center.y) * SCALE_FACTOR,
        (p.z - center.z) * SCALE_FACTOR
      );

    const group = new THREE.Group();
    group.renderOrder = 10;

    // ── Shared helpers ───────────────────────────────────────────────
    const plasmaColor = (t: number) => {
      const c = plasmaAtT(t, plasmaParams.gamma, plasmaParams.contrast);
      return isDarkMode ? adaptColorForDarkTheme(c.r, c.g, c.b) : c;
    };
    const colorAtT = (t: number) => {
      const c = plasmaColor(t);
      return new THREE.Color(c.r, c.g, c.b);
    };

    // Place an arrow cone pointing along `tangent` at `position`, colored
    // for axis fraction `t`. Used for bookend arrows in the beads style and
    // for the inline arrows in the tube styles.
    const addArrow = (
      position: THREE.Vector3,
      tangent: THREE.Vector3,
      t: number,
      radius = 0.9,
      height = 2.2,
      opacity = 0.95
    ) => {
      const arrowGeom = new THREE.ConeGeometry(radius, height, 10);
      const arrowMat = new THREE.MeshBasicMaterial({
        color: colorAtT(t),
        transparent: true,
        opacity,
        depthTest: true,
      });
      const arrow = new THREE.Mesh(arrowGeom, arrowMat);
      arrow.position.copy(position);
      if (tangent.lengthSq() > 1e-6) {
        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent.clone().normalize());
        arrow.applyQuaternion(quat);
      }
      arrow.renderOrder = 11;
      group.add(arrow);
    };

    // ── Style: tube / tube-masked ────────────────────────────────────
    if ((axisStyle === 'tube' || axisStyle === 'tube-masked') && hasTrajectory) {
      const vertices = trajectoryPoints!.map((p) => toScene(p));
    const curve = new THREE.CatmullRomCurve3(vertices, false);

    const tubeRadius = 0.38;
    const radialSegments = 8;

      if (axisStyle === 'tube') {
        // ── One continuous tube, vertex-coloured plasma along its length.
        const tubeSegments = Math.max(vertices.length * 2, 64);
        const geometry = new THREE.TubeGeometry(
          curve,
          tubeSegments,
          tubeRadius,
          radialSegments,
          false
        );
    const posAttr = geometry.getAttribute('position');
    const vertexCount = posAttr.count;
    const colorArray = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      const t = Math.floor(i / radialSegments) / tubeSegments;
          const c = plasmaColor(t);
          colorArray[i * 3] = c.r;
          colorArray[i * 3 + 1] = c.g;
          colorArray[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    const tubeMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: 1,
    });
    const tube = new THREE.Mesh(geometry, tubeMaterial);
    tube.renderOrder = 10;
    group.add(tube);

        // 5 inline arrows along the tube
        for (let i = 1; i <= 5; i++) {
          const t = i / 6;
          addArrow(curve.getPoint(t), curve.getTangent(t), t);
        }
      } else {
        // ── tube-masked: split into K sub-tubes; each sub-tube's opacity
        //                is driven by local point density. Where the tube
        //                would pass through empty UMAP regions, that
        //                section nearly disappears.
        const K = 14;
        const radius = estimateDensityRadius(filteredSamples4D);
        const subSegments = 6;
        for (let k = 0; k < K; k++) {
          const t0 = k / K;
          const t1 = (k + 1) / K;
          const subStart = curve.getPoint(t0);
          const subEnd = curve.getPoint(t1);
          // Quick density at the midpoint (cheap, good enough for K=14).
          const mid = curve.getPoint((t0 + t1) / 2);
          // Count cells within `radius` of `mid` in RAW UMAP coords.
          const radius2 = radius * radius;
          let count = 0;
          for (let s = 0; s < filteredSamples4D.length; s++) {
            const sx = filteredSamples4D[s].x - (mid.x / SCALE_FACTOR + center.x);
            const sy = filteredSamples4D[s].y - (mid.y / SCALE_FACTOR + center.y);
            const sz = filteredSamples4D[s].z - (mid.z / SCALE_FACTOR + center.z);
            if (sx * sx + sy * sy + sz * sz <= radius2) count++;
          }
          const density = Math.min(1, count / 30);
          // Opacity envelope: empty → very faint hint, dense → solid.
          const alpha = 0.08 + 0.84 * Math.pow(density, 0.7);

          const subPath = new THREE.CatmullRomCurve3(
            [subStart, curve.getPoint((t0 + t1) / 2), subEnd],
            false
          );
          const subTubeGeom = new THREE.TubeGeometry(
            subPath,
            subSegments,
            tubeRadius,
            radialSegments,
            false
          );
          const tColor = (t0 + t1) / 2;
          const subTubeMat = new THREE.MeshBasicMaterial({
            color: colorAtT(tColor),
            transparent: true,
            opacity: alpha,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: 1,
          });
          const subTube = new THREE.Mesh(subTubeGeom, subTubeMat);
          subTube.renderOrder = 10;
          group.add(subTube);
        }
        // Inline arrows — only where density is reasonable (avoid arrows
        // marooned in empty space).
        for (let i = 1; i <= 5; i++) {
          const t = i / 6;
      const pos = curve.getPoint(t);
          // Re-evaluate density at this t (cheap).
          const radius2 = radius * radius;
          let count = 0;
          for (let s = 0; s < filteredSamples4D.length; s++) {
            const sx = filteredSamples4D[s].x - (pos.x / SCALE_FACTOR + center.x);
            const sy = filteredSamples4D[s].y - (pos.y / SCALE_FACTOR + center.y);
            const sz = filteredSamples4D[s].z - (pos.z / SCALE_FACTOR + center.z);
            if (sx * sx + sy * sy + sz * sz <= radius2) count++;
          }
          if (count >= 6) {
            addArrow(pos, curve.getTangent(t), t, 0.9, 2.2, 0.95);
          }
        }
      }
    }

    // ── Style: beads ────────────────────────────────────────────────
    // Discrete plasma-colored spheres at quantile centroids (guaranteed to
    // sit inside dense regions), a faint density-gated connector between
    // neighbours, and bookend Low/High arrows at the chain endpoints.
    if (axisStyle === 'beads' && hasBeads) {
      const beadPositions = quantileBeads.map((b) => toScene(b));
      const radius = estimateDensityRadius(filteredSamples4D);

      // Density along the (raw-UMAP) connector segments — used to fade
      // segments that cross empty regions.
      const densities = polylineSegmentDensities(
        quantileBeads.map((b) => ({ x: b.x, y: b.y, z: b.z })),
        filteredSamples4D,
        radius
      );

      // Connector: one thin Line per adjacent pair, opacity = density.
      for (let i = 0; i < beadPositions.length - 1; i++) {
        const a = beadPositions[i];
        const b = beadPositions[i + 1];
        const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
        const density = densities[i] ?? 0;
        const alpha = 0.05 + 0.55 * Math.pow(density, 0.7);
        const tMid = (quantileBeads[i].t + quantileBeads[i + 1].t) / 2;
        const lineMat = new THREE.LineBasicMaterial({
          color: colorAtT(tMid),
          transparent: true,
          opacity: alpha,
          depthTest: true,
          depthWrite: false,
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 10;
        group.add(line);
      }

      // Beads themselves — plasma spheres with a subtle bright ring for
      // legibility against the dark cloud.
      const beadRadius = 1.6;
      for (let i = 0; i < beadPositions.length; i++) {
        const pos = beadPositions[i];
        const t = quantileBeads[i].t;
        const sphereGeom = new THREE.SphereGeometry(beadRadius, 20, 20);
        const sphereMat = new THREE.MeshBasicMaterial({
          color: colorAtT(t),
        transparent: true,
        opacity: 0.95,
        depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: 1,
        });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        sphere.position.copy(pos);
        sphere.renderOrder = 11;
        // Tag so the slider effect below can find + scale these.
        (sphere as THREE.Object3D & { userData: Record<string, unknown> }).userData = {
          type: 'axisBead',
          t,
          baseRadius: beadRadius,
        };
        group.add(sphere);

        const ringGeom = new THREE.RingGeometry(beadRadius * 1.05, beadRadius * 1.18, 28);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(pos);
        // Billboard the ring toward the camera each frame? Keep it simple:
        // a flat XY ring reads as a "halo" from typical orbit angles.
        ring.renderOrder = 11;
        group.add(ring);
      }

      // Bookend arrows: outward at both ends so the direction is unambiguous.
      const first = beadPositions[0];
      const second = beadPositions[1];
      const lastIdx = beadPositions.length - 1;
      const last = beadPositions[lastIdx];
      const penult = beadPositions[lastIdx - 1];

      const lowDir = first.clone().sub(second).normalize();
      const highDir = last.clone().sub(penult).normalize();
      const arrowOffset = 3.0;
      addArrow(
        first.clone().add(lowDir.clone().multiplyScalar(arrowOffset)),
        lowDir,
        0,
        1.1,
        2.6,
        0.95
      );
      addArrow(
        last.clone().add(highDir.clone().multiplyScalar(arrowOffset)),
        highDir,
        1,
        1.1,
        2.6,
        0.95
      );
    }

    // ── Style: bare ─────────────────────────────────────────────────
    // No path geometry at all. Two endpoint anchors (small plasma spheres
    // with rings) sit on the centroids of the bottom-5%/top-5% cells.
    if (axisStyle === 'bare' && endpointAnchors) {
      const mkAnchor = (
        rawPos: { x: number; y: number; z: number },
        tFrac: number
      ) => {
        const pos = toScene(rawPos);
        const r = 2.0;
        const sphereGeom = new THREE.SphereGeometry(r, 20, 20);
        const sphereMat = new THREE.MeshBasicMaterial({
          color: colorAtT(tFrac),
          transparent: true,
          opacity: 0.95,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: 1,
        });
        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
        sphere.position.copy(pos);
        sphere.renderOrder = 11;
        group.add(sphere);

        const ringGeom = new THREE.RingGeometry(r * 1.15, r * 1.35, 36);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(pos);
        ring.renderOrder = 11;
        group.add(ring);
      };
      mkAnchor(endpointAnchors.low, 0);
      mkAnchor(endpointAnchors.high, 1);
    }

    sceneRef.current.add(group);
    trajectoryLineRef.current = group;

    return () => {
      disposeGroup(trajectoryLineRef.current);
        trajectoryLineRef.current = null;
    };
  }, [
    axisStyle,
    trajectoryPoints,
    quantileBeads,
    endpointAnchors,
    isDarkMode,
    filteredSamples4D,
    getCenter,
    plasmaParams.gamma,
    plasmaParams.contrast,
  ]);

  /**
   * Slider feedback marker (built once per style/data change).
   *
   * Strategy by `axisStyle`:
   *   cursor
   *     A prominent plasma-coloured ball with a white halo ring. There is
   *     NO axis geometry in the scene — this ball is the only visual
   *     indicator of "where the slider is". Its position is driven by a
   *     hidden density-grounded trajectory (`cursorPath`) so it stays
   *     inside the cloud at every slider value, not just at waypoints.
   *   tube / tube-masked
   *     A translucent iso-disk + ring, perpendicular to the tube at the
   *     slider's current value. Re-uses the spline.
   *   beads
   *     A small floating sphere that interpolates along the bead chain
   *     (linear between adjacent beads). The chain itself is what the eye
   *     reads as the axis, so we don't draw a heavy disk — just a clean
   *     "cursor" sphere.
   *   bare
   *     A small floating sphere interpolated along the (low → high)
   *     anchor line. No path geometry exists, so the cursor's job is
   *     mostly "you are here on the axis".
   *
   * The build effect creates geometry once per data change; the update
   * effect below cheaply moves + recolors the marker on every slider drag.
   */
  useEffect(() => {
    if (!sceneRef.current) return;
    const cleanupExisting = () => {
      const ref = isoDiskRef.current;
      if (ref && sceneRef.current) {
        sceneRef.current.remove(ref.group);
        ref.disk.geometry.dispose();
        (ref.disk.material as THREE.Material).dispose();
        ref.ring.geometry.dispose();
        (ref.ring.material as THREE.Material).dispose();
      }
      isoDiskRef.current = null;
    };
    cleanupExisting();
    if (!semanticState.featureRange) return;

    const center =
      filteredSamples4D.length > 0 ? getCenter() : new THREE.Vector3(0, 0, 0);
    const toScene = (p: { x: number; y: number; z: number }) =>
      new THREE.Vector3(
        (p.x - center.x) * SCALE_FACTOR,
        (p.y - center.y) * SCALE_FACTOR,
        (p.z - center.z) * SCALE_FACTOR
      );

    // ── Cursor-family styles: build prominent plasma ball + halo +
    // outer ring. Same geometry for both `cursor` and `cursor-axis`;
    // only the underlying cursorPath differs. The ball is sized so it's
    // clearly the focal point in a dense cloud but doesn't dominate the
    // scene. Driven by the cursorPath in the update effect below.
    if (isCursorMode) {
      if (!cursorPath) return;
      // Inner plasma ball
      const ballRadius = 2.6;
      const ballGeom = new THREE.SphereGeometry(ballRadius, 32, 32);
      const ballMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: 1,
      });
      const ball = new THREE.Mesh(ballGeom, ballMat);
      ball.renderOrder = 14;
      // Outer halo ring (face-camera billboard maintained in animate loop;
      // here we just position it; rotation is handled per-frame in update).
      const haloGeom = new THREE.RingGeometry(ballRadius * 1.5, ballRadius * 1.85, 48);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.renderOrder = 13;

      const group = new THREE.Group();
      group.add(ball);
      group.add(halo);
      group.visible = false;
      group.renderOrder = 13;
      sceneRef.current.add(group);
      // We re-use the existing ref schema: `disk` = inner ball, `ring` =
      // halo, `curve` is unused in cursor mode (we route around it).
      const placeholderCurve = new THREE.CatmullRomCurve3(
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)],
        false
      );
      isoDiskRef.current = { group, disk: ball, ring: halo, curve: placeholderCurve };
      return cleanupExisting;
    }

    // Pick the parametric path the slider rides on for the legacy styles.
    let curve: THREE.CatmullRomCurve3 | null = null;
    if ((axisStyle === 'tube' || axisStyle === 'tube-masked') && trajectoryPoints && trajectoryPoints.length >= 2) {
      curve = new THREE.CatmullRomCurve3(trajectoryPoints.map(toScene), false);
    } else if (axisStyle === 'beads' && quantileBeads.length >= 2) {
      // Linear (Centripetal would over-shoot) chain through the beads.
      curve = new THREE.CatmullRomCurve3(
        quantileBeads.map((b) => toScene(b)),
        false,
        'catmullrom',
        0
      );
    } else if (axisStyle === 'bare' && endpointAnchors) {
      curve = new THREE.CatmullRomCurve3(
        [toScene(endpointAnchors.low), toScene(endpointAnchors.high)],
        false
      );
    }
    if (!curve) return;

    // Tube styles get the original heavyweight iso-disk; the new bead-based
    // styles get a smaller floating sphere "cursor" instead.
    const useDisk = axisStyle === 'tube' || axisStyle === 'tube-masked';
    const diskRadius = useDisk ? 4.6 : 1.4;

    let disk: THREE.Mesh;
    let ring: THREE.Mesh;

    if (useDisk) {
      const diskGeom = new THREE.CircleGeometry(diskRadius, 48);
      const diskMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disk = new THREE.Mesh(diskGeom, diskMat);
      disk.renderOrder = 12;

      const ringGeom = new THREE.RingGeometry(diskRadius * 0.965, diskRadius, 80);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      ring = new THREE.Mesh(ringGeom, ringMat);
      ring.renderOrder = 13;
    } else {
      // Cursor sphere + bright outline ring (perpendicular ring kept so the
      // depth cue is consistent across modes).
      const sphereGeom = new THREE.SphereGeometry(diskRadius, 24, 24);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: 1,
      });
      disk = new THREE.Mesh(sphereGeom, sphereMat);
      disk.renderOrder = 13;

      const ringGeom = new THREE.RingGeometry(diskRadius * 1.45, diskRadius * 1.7, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      ring = new THREE.Mesh(ringGeom, ringMat);
      ring.renderOrder = 13;
    }

    const group = new THREE.Group();
    group.add(disk);
    group.add(ring);
    group.visible = false;
    group.renderOrder = 12;
    sceneRef.current.add(group);
    isoDiskRef.current = { group, disk, ring, curve };

    return cleanupExisting;
  }, [
    axisStyle,
    trajectoryPoints,
    quantileBeads,
    endpointAnchors,
    cursorPath,
    filteredSamples4D.length,
    getCenter,
    semanticState.featureRange,
  ]);

  /**
   * Cheap update path: position + orient + recolor the slider marker on
   * every slider drag without allocating geometry/material.
   *
   * In `cursor` mode we don't use the ref's stored curve. The position
   * is computed directly from the dense, hidden cursor path so the ball
   * stays inside the cloud at every slider value (the path's centroids
   * are guaranteed to live in dense regions).
   *
   * In `beads` mode we also scale the bead nearest to the slider so the
   * user sees which waypoint they're sitting on. Other beads relax back
   * to baseline size.
   */
  useEffect(() => {
    const ref = isoDiskRef.current;
    const fr = semanticState.featureRange;
    const sliderValue = semanticState.semanticSliderValue;
    const haveSlider = fr != null && sliderValue != null && Number.isFinite(sliderValue);
    const span = fr ? fr.max - fr.min : 0;
    const t = haveSlider && span > 0 ? Math.max(0, Math.min(1, (sliderValue! - fr!.min) / span)) : 0.5;

    if (ref) {
      if (!haveSlider) {
        ref.group.visible = false;
      } else if (isCursorMode) {
        // Sample the hidden density-grounded path; transform to scene space.
        const c = filteredSamples4D.length > 0 ? getCenter() : new THREE.Vector3(0, 0, 0);
        const raw = cursorPath ? evaluateCursorPath(cursorPath, sliderValue!) : null;
        if (!raw) {
          ref.group.visible = false;
        } else {
          ref.group.position.set(
            (raw.x - c.x) * SCALE_FACTOR,
            (raw.y - c.y) * SCALE_FACTOR,
            (raw.z - c.z) * SCALE_FACTOR
          );
          // Halo: billboard toward the camera so it always reads as a ring.
          if (cameraRef.current) {
            const lookAt = ref.group.position
              .clone()
              .add(cameraRef.current.position.clone().sub(ref.group.position));
            ref.ring.lookAt(lookAt);
          }
          // Ball stays bright white (high contrast cursor); halo takes the
          // plasma colour at the slider's normalised position so users can
          // read the feature value off the cursor itself.
          const cc = plasmaAtT(t, plasmaParams.gamma, plasmaParams.contrast);
          const adapted = isDarkMode ? adaptColorForDarkTheme(cc.r, cc.g, cc.b) : cc;
          (ref.disk.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1);
          (ref.ring.material as THREE.MeshBasicMaterial).color.setRGB(adapted.r, adapted.g, adapted.b);
          ref.group.visible = true;
        }
      } else {
        const pos = ref.curve.getPoint(t);
        ref.group.position.copy(pos);
        if (axisStyle === 'tube' || axisStyle === 'tube-masked') {
          const tangent = ref.curve.getTangent(t).normalize();
          if (tangent.lengthSq() > 1e-6) {
            const up = new THREE.Vector3(0, 0, 1);
            const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
            ref.group.quaternion.copy(quat);
          }
        } else {
          // Billboard-ish: keep ring facing roughly the camera by clearing
          // rotation; OrbitControls will reveal it fine for typical angles.
          ref.group.quaternion.identity();
        }
        const c = plasmaAtT(t, plasmaParams.gamma, plasmaParams.contrast);
        const adapted = isDarkMode ? adaptColorForDarkTheme(c.r, c.g, c.b) : c;
        (ref.disk.material as THREE.MeshBasicMaterial).color.setRGB(adapted.r, adapted.g, adapted.b);
        (ref.ring.material as THREE.MeshBasicMaterial).color.setRGB(adapted.r, adapted.g, adapted.b);
        ref.group.visible = true;
      }
    }

    // Bead emphasis: in beads mode, scale the closest bead up and others
    // back to normal so users see which waypoint they're aligned with.
    const group = trajectoryLineRef.current;
    if (group && axisStyle === 'beads' && quantileBeads.length > 0 && haveSlider) {
      // Find the bead with the closest `t` to the slider's normalized value.
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < quantileBeads.length; i++) {
        const d = Math.abs(quantileBeads[i].t - t);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      let beadCount = 0;
      group.traverse((child) => {
        const m = child as THREE.Mesh & { userData?: Record<string, unknown> };
        if (m.userData?.type !== 'axisBead') return;
        const isActive = beadCount === bestIdx;
        m.scale.setScalar(isActive ? 1.45 : 0.9);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = isActive ? 1.0 : 0.55;
        beadCount++;
      });
    } else if (group && axisStyle === 'beads') {
      // No slider yet: relax all beads to baseline.
      group.traverse((child) => {
        const m = child as THREE.Mesh & { userData?: Record<string, unknown> };
        if (m.userData?.type !== 'axisBead') return;
        m.scale.setScalar(1);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.95;
      });
    }
  }, [
    semanticState.semanticSliderValue,
    semanticState.featureRange,
    axisStyle,
    quantileBeads,
    cursorPath,
    filteredSamples4D.length,
    getCenter,
    isDarkMode,
    plasmaParams.gamma,
    plasmaParams.contrast,
  ]);

  // "Trajectory active" controls the slight cloud dim that helps axis
  // elements (tube / beads / cursor ball) pop. In either cursor mode we
  // have no path geometry — but we still want the dim while semantic
  // mode is engaged on a feature, so the cursor ball reads as the focal
  // element.
  const trajectoryActive =
    (isCursorMode &&
      Boolean(semanticState.advancedMode && semanticState.selectedFeature && cursorPath)) ||
    Boolean(semanticState.advancedMode && semanticState.selectedFeature && trajectoryPoints?.length) ||
    Boolean(selectedSample && semanticState.projectedPosition);

  /**
   * Per-point fade factor in [0, 1] driven by 3-D distance to the trajectory
   * polyline. 1 = on/near the axis (full plasma), 0 = far from the axis
   * (faded toward neutral dim). Recomputed only when the polyline or the
   * filtered cloud changes — the slider can drag freely without paying for
   * this. Null means "no fade applied".
   */
  const axisFadeFactors = React.useMemo<Float32Array | null>(() => {
    if (!useFeatureColoring) return null;
    // Either cursor mode hides the axis polyline; fading the cloud by
    // distance to a hidden polyline would be visually arbitrary.
    if (isCursorMode) return null;
    if (!trajectoryPoints || trajectoryPoints.length < 2) return null;
    if (!filteredSamples4D.length) return null;
    const dist = computeDistancesToPolyline(filteredSamples4D, trajectoryPoints);
    // Tighter band: ~half the cloud closest to the axis stays at full
    // brightness; only the outermost ~5% reach the dimmest level.
    return buildFadeFactors(dist, 0.5, 0.95);
  }, [trajectoryPoints, filteredSamples4D, useFeatureColoring, isCursorMode]);

  // The cloud is updated in three independent steps so that, e.g., a click (which only moves
  // the highlight) never touches the 36k-point buffers.

  // 1. Material: point size, opacity and the round point sprite.
  useEffect(() => {
    let material = pointsMaterialRef.current;
    if (!material) {
      material = new THREE.PointsMaterial({
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        alphaTest: 0.5,
      });
      pointsMaterialRef.current = material;
      if (pointsRef.current) pointsRef.current.material = material;
    }
    if (material.userData.dark !== isDarkMode) {
      const previousMap = material.map;
      material.map = generatePointTexture(isDarkMode);
      material.userData.dark = isDarkMode;
      previousMap?.dispose();
      material.needsUpdate = true;
    }
    material.size = visualizerOptions.pointSize;
    pointsOpacityRef.current = isDarkMode ? 1.0 : 0.9;
    material.opacity = pointsOpacityRef.current;
  }, [visualizerOptions.pointSize, isDarkMode]);

  useEffect(() => () => cancelAnimationFrame(colorTweenRef.current), []);

  // 2. Geometry: positions, rebuilt only when the visible cells change.
  useEffect(() => {
    const scene = sceneRef.current;
    const material = pointsMaterialRef.current;
    if (!scene || !material) return;
    if (!filteredSamples4D.length) {
      prevEmbeddingCentroidRef.current = null;
      if (pointsRef.current) {
        scene.remove(pointsRef.current);
        pointsRef.current.geometry.dispose();
        pointsRef.current = null;
      }
      setPointCount(0);
      return;
    }

    setPointCount(filteredSamples4D.length);

    const center = cloudCenter;
    // Re-centering the cloud in scene space when the filter changes is equivalent
    // to translating all points by (prevCenter − center) * SCALE_FACTOR; move the
    // camera + orbit target by the same vector so the framing stays stable.
    const prevC = prevEmbeddingCentroidRef.current;
    if (prevC && cameraRef.current && controlsRef.current) {
      const shift = new THREE.Vector3().subVectors(prevC, center).multiplyScalar(SCALE_FACTOR);
      cameraRef.current.position.add(shift);
      controlsRef.current.target.add(shift);
      controlsRef.current.update();
    }
    prevEmbeddingCentroidRef.current = center.clone();

    const n = filteredSamples4D.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const sample = filteredSamples4D[i];
      positions[i * 3] = (sample.x - center.x) * SCALE_FACTOR;
      positions[i * 3 + 1] = (sample.y - center.y) * SCALE_FACTOR;
      positions[i * 3 + 2] = (sample.z - center.z) * SCALE_FACTOR;
    }

    const existing = pointsRef.current;
    if (existing && existing.geometry.getAttribute('position').count === n) {
      const posAttr = existing.geometry.getAttribute('position') as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(positions);
      posAttr.needsUpdate = true;
      existing.geometry.computeBoundingSphere();
      return;
    }

    if (existing) {
      scene.remove(existing);
      existing.geometry.dispose();
      pointsRef.current = null;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;
    colorsPaintedForRef.current = null;

    // Fade the cloud in the first time it appears so it "develops in" rather
    // than popping. Subsequent rebuilds (filters/colors) render at full opacity.
    if (!pointsHaveFadedInRef.current) {
      pointsHaveFadedInRef.current = true;
      if (!explorerReadyReported) {
        explorerReadyReported = true;
        // Time from opening the page to seeing the map.
        trackEvent('explorer_ready', { ms: Math.round(performance.now()) });
      }
      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion) {
        const start = performance.now();
        const DURATION = 450;
        material.opacity = 0;
        const ramp = () => {
          if (pointsMaterialRef.current !== material) return;
          const t = Math.min(1, (performance.now() - start) / DURATION);
          material.opacity = pointsOpacityRef.current * t;
          requestRenderRef.current();
          if (t < 1) requestAnimationFrame(ramp);
        };
        requestAnimationFrame(ramp);
      }
    }
  }, [filteredSamples4D, cloudCenter]);

  // 3. Colours: condition colours, or the feature plasma once its smoothed values are ready.
  useEffect(() => {
    const points = pointsRef.current;
    if (!points) return;
    const colorAttr = points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = new Float32Array(colorAttr.array.length);
    const fr = semanticState.featureRange;
    const fvCol = useFeatureColoring && coloringFeature ? featureValues[coloringFeature] : null;
    const featureMode = Boolean(fvCol && fr);
    const sameCells = colorsPaintedForRef.current === filteredSamples4D;
    // While a feature's smoothed values are on their way keep the current colours, unless the
    // buffer belongs to a different set of cells (then paint raw values rather than leave it blank).
    if (featureMode && !smoothedFeatureValues && sameCells) return;
    // Slight dim while the axis is engaged so the cursor ball reads as the focal point. Done in
    // colour, not opacity: with alphaTest a lower opacity drops small (distant) sprites entirely.
    const dim = trajectoryActive ? 0.72 : 1;

    const n = Math.min(filteredSamples4D.length, colorAttr.count);
    for (let i = 0; i < n; i++) {
      const sample = filteredSamples4D[i];
      let r: number;
      let g: number;
      let b: number;
      if (featureMode) {
        let v: number | null = null;
        if (smoothedFeatureValues && i < smoothedFeatureValues.length) {
          const sv = smoothedFeatureValues[i];
          v = Number.isFinite(sv) ? sv : null;
        } else {
          const ei = sampleIdToEmbeddingIndex.get(sample.id) ?? -1;
          v = ei >= 0 && ei < fvCol!.length ? fvCol![ei] : null;
        }
        const c = featureToColorPlasmaAdaptive(v, fr!.min, fr!.max, plasmaParams.gamma, plasmaParams.contrast);
        const adapted = isDarkMode ? adaptColorForDarkTheme(c.r, c.g, c.b) : c;
        // Off-axis points keep their hue but are dimmed to [MIN_B, 1] so the on-axis ribbon pops.
        let brightness = 1;
        if (axisFadeFactors && i < axisFadeFactors.length) {
          const MIN_B = 0.7;
          brightness = MIN_B + (1 - MIN_B) * Math.pow(axisFadeFactors[i], 0.5);
        }
        r = adapted.r * brightness;
        g = adapted.g * brightness;
        b = adapted.b * brightness;
      } else {
        const src =
          visualizerOptions.coloringMode === 'phenotype' ? sample.color_phenotypic : sample.color;
        const cr = src?.r ?? 0;
        const cg = src?.g ?? 0;
        const cb = src?.b ?? 0;
        const adapted = isDarkMode ? adaptColorForDarkTheme(cr, cg, cb) : { r: cr, g: cg, b: cb };
        r = adapted.r;
        g = adapted.g;
        b = adapted.b;
      }
      colors[i * 3] = r * dim;
      colors[i * 3 + 1] = g * dim;
      colors[i * 3 + 2] = b * dim;
    }
    colorsPaintedForRef.current = filteredSamples4D;
    // A new set of cells is painted at once; the same cells ease to their new colours.
    tweenColors(
      colorAttr,
      colors,
      sameCells && !prefersReducedMotion() ? COLOR_TWEEN_MS : 0,
      colorTweenRef,
      () => requestRenderRef.current()
    );
  }, [
    filteredSamples4D,
    visualizerOptions.coloringMode,
    isDarkMode,
    coloringFeature,
    semanticState.featureRange,
    featureValues,
    useFeatureColoring,
    sampleIdToEmbeddingIndex,
    axisFadeFactors,
    smoothedFeatureValues,
    plasmaParams.gamma,
    plasmaParams.contrast,
    trajectoryActive,
  ]);

  // Highlight position: projected (semantic, already in scene space from API)
  // or selected sample. In `cursor` / `cursor-axis` we ignore `projectedPosition`
  // so the API projection sphere does not duplicate the slider cursor ball.
  useEffect(() => {
    const proj = isCursorMode ? null : semanticState.projectedPosition;
    const pos = proj
      ? new THREE.Vector3(proj.x, proj.y, proj.z)
      : selectedSample
        ? toScenePos(selectedSample.x, selectedSample.y, selectedSample.z)
        : null;
    if (!pos) {
      targetHighlightPosRef.current = null;
      disposeHighlight();
      return;
    }
    targetHighlightPosRef.current = pos.clone();
    const useFeatureHighlight =
      useFeatureColoring && selectedSample && coloringFeature && semanticState.featureRange;
    let featureHighlightColor: THREE.Color | null = null;
    if (useFeatureHighlight) {
      const fvH = featureValues[coloringFeature!];
      const ei = sampleIdToEmbeddingIndex.get(selectedSample!.id) ?? -1;
      if (fvH && ei >= 0 && ei < fvH.length) {
        const c = featureToColorPlasmaAdaptive(
          fvH[ei],
          semanticState.featureRange!.min,
          semanticState.featureRange!.max,
          plasmaParams.gamma,
          plasmaParams.contrast
        );
        featureHighlightColor = isDarkMode
          ? new THREE.Color(...Object.values(adaptColorForDarkTheme(c.r, c.g, c.b)))
          : new THREE.Color(c.r, c.g, c.b);
      }
    }
    let color: THREE.Color;
    if (proj && trajectoryPoints?.length && semanticState.featureRange) {
      const target =
        semanticState.semanticSliderValue ??
        (semanticState.featureRange.min + semanticState.featureRange.max) / 2;
      const c = featureToColorPlasmaAdaptive(
        target,
        semanticState.featureRange.min,
        semanticState.featureRange.max,
        plasmaParams.gamma,
        plasmaParams.contrast
      );
      color = isDarkMode
        ? new THREE.Color(...Object.values(adaptColorForDarkTheme(c.r, c.g, c.b)))
        : new THREE.Color(c.r, c.g, c.b);
    } else if (featureHighlightColor) {
      color = featureHighlightColor;
    } else if (selectedSample) {
      const cr =
        visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.r ?? 0)
          : (selectedSample.color?.r ?? 0);
      const cg =
        visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.g ?? 0)
          : (selectedSample.color?.g ?? 0);
      const cb =
        visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.b ?? 0)
          : (selectedSample.color?.b ?? 0);
      color = isDarkMode
        ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
        : new THREE.Color(cr, cg, cb);
    } else {
      color = new THREE.Color(1, 1, 0);
    }
    const onTrajectory = Boolean(proj && trajectoryPoints?.length);
    if (!selectedPointMeshRef.current) {
      createOrUpdateHighlight(pos, color, onTrajectory);
    } else {
      if (!proj) selectedPointMeshRef.current.position.copy(pos);
      const core = selectedPointMeshRef.current.userData.core as THREE.Mesh | undefined;
      (core?.material as THREE.MeshBasicMaterial | undefined)?.color.copy(color);
      if (Boolean(selectedPointMeshRef.current.userData.onTrajectory) !== onTrajectory) {
        createOrUpdateHighlight(pos, color, onTrajectory);
      }
    }
  }, [
    axisStyle,
    semanticState.projectedPosition,
    semanticState.semanticSliderValue,
    semanticState.featureRange,
    selectedSample,
    coloringFeature,
    featureValues,
    useFeatureColoring,
    sampleIdToEmbeddingIndex,
    visualizerOptions.coloringMode,
    isDarkMode,
    toScenePos,
    createOrUpdateHighlight,
    disposeHighlight,
    trajectoryPoints,
  ]);

  // Every scene mutation happens in an effect or goes through OrbitControls, so one frame
  // after each commit (plus the controls' 'change' events) keeps the canvas current.
  useEffect(() => {
    requestRenderRef.current();
  });

  // Preselect a control cell once per mount; after that an empty selection is the user's choice.
  const initialSelectionDoneRef = useRef(false);
  useEffect(() => {
    if (initialSelectionDoneRef.current || filteredSamples4D.length === 0) return;
    initialSelectionDoneRef.current = true;
    if (selectedSample) return;
    const defaultSample = filteredSamples4D.find((s) => s.phenotype === 'control');
    if (defaultSample) setSelectedSample(defaultSample);
  }, [filteredSamples4D, selectedSample, setSelectedSample]);

  useEffect(() => {
    selectedSampleIdRef.current = selectedSample?.id ?? null;
  }, [selectedSample]);

  const handleSemanticSliderChange = useCallback(
    (_pointIndex: number, targetValue: number) => {
      // Cursor-family styles: the slider's 3D feedback is the cursor
      // ball, not a backend projection. Skip the API round-trip entirely
      // AND clear any stale projectedPosition so the old highlight ball
      // doesn't linger.
      if (isCursorMode) {
        setSemanticState((s) => ({
          ...s,
          projectedPosition: null,
          projectedConfidence: null,
        }));
        return;
      }
      let embeddingIndex = -1;
      if (selectedSample) {
        embeddingIndex = sampleIdToEmbeddingIndex.get(selectedSample.id) ?? -1;
      } else if (
        selectedPointIndex != null &&
        selectedPointIndex >= 0 &&
        selectedPointIndex < filteredSamples4D.length
      ) {
        const s = filteredSamples4D[selectedPointIndex];
        embeddingIndex = sampleIdToEmbeddingIndex.get(s.id) ?? -1;
      } else if (filteredSamples4D.length > 0) {
        embeddingIndex = sampleIdToEmbeddingIndex.get(filteredSamples4D[0].id) ?? -1;
      }
      if (embeddingIndex < 0) return;
      const maxIndex = apiEmbeddingCount ?? Infinity;
      if (embeddingIndex >= maxIndex) return;
      const feature = semanticState.selectedFeature ?? 'fragment_length_mean';
      const center = getCenter();
      const options = {
        centerX: center.x,
        centerY: center.y,
        centerZ: center.z,
        scaleFactor: SCALE_FACTOR,
        version: datasetVersion,
      };
      const requestSampleId = selectedSample?.id ?? null;
      projectOnAxis(embeddingIndex, targetValue, feature, options)
        .then((res) => {
          if (requestSampleId != null && selectedSampleIdRef.current !== requestSampleId) return;
          const proj = { x: res.x, y: res.y, z: res.z };
          setSemanticState((s) => ({
            ...s,
            projectedPosition: proj,
            projectedConfidence: res.confidence ?? null,
          }));
          targetHighlightPosRef.current = new THREE.Vector3(proj.x, proj.y, proj.z);
        })
        .catch((err) => {
          console.error('[semantic] API error', err);
        });
    },
    [isCursorMode, selectedSample, samples4D, semanticState.selectedFeature, datasetVersion, setSemanticState, apiEmbeddingCount, getCenter, sampleIdToEmbeddingIndex, selectedPointIndex, filteredSamples4D]
  );

  // Initial projection when the axis is enabled or the feature changes — once
  // per (feature) so the user gets a default projection to look at. We do NOT
  // re-project on point clicks; clicking a sample should leave the highlight
  // at the clicked location and only the slider should drive projections.
  const lastProjKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !semanticState.advancedMode ||
      !semanticState.selectedFeature ||
      !semanticState.featureRange
    )
      return;
    const key = `${semanticState.selectedFeature}`;
    if (lastProjKeyRef.current === key) return;
    lastProjKeyRef.current = key;
    const val =
      semanticState.semanticSliderValue ??
      (semanticState.featureRange.min + semanticState.featureRange.max) / 2;
    handleSemanticSliderChange(0, val);
  }, [
    semanticState.advancedMode,
    coloringFeature,
    semanticState.featureRange,
    semanticState.semanticSliderValue,
    handleSemanticSliderChange,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    pointerMovedRef.current = false;
  }, []);

  const updateHoverPreview = useCallback(() => {
    hoverFrameQueuedRef.current = false;
    const pos = lastPointerCssRef.current;
    const container = containerRef.current;
    const cam = cameraRef.current;
    const pts = pointsRef.current;
    const ring = hoverRingRef.current;
    const label = hoverLabelRef.current;
    if (!pos || !container || !cam || !pts || !ring) return;
    const hide = () => {
      if (label) label.style.display = 'none';
      if (ring.visible) {
        ring.visible = false;
        requestRenderRef.current();
      }
    };

    // While the user is rotating/dragging, hide hover — they aren't targeting.
    if (pointerDownRef.current && pointerMovedRef.current) {
      hide();
      return;
    }
    const rect = container.getBoundingClientRect();
    const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = Math.min(posAttr.count, filteredSamples4D.length);
    const idx = pickFilteredPointIndexFromPointer(
      pos.x,
      pos.y,
      rect,
      cam,
      posAttr,
      count,
      visualizerOptions.pointSize
    );
    if (idx < 0) {
      hide();
      return;
    }
    ring.position.set(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
    // Scale ring with the drawn sprite size so it always frames the disk.
    pickViewP.set(ring.position.x, ring.position.y, ring.position.z).applyMatrix4(cam.matrixWorldInverse);
    const viewZ = Math.max(1e-3, -pickViewP.z);
    const drawnRadiusPx = (visualizerOptions.pointSize * rect.height * 0.25) / viewZ;
    // Convert pixels back to world units at this depth for the ring radius.
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) * viewZ) / rect.height;
    const ringWorldRadius = (drawnRadiusPx + 5) * worldPerPx;
    ring.scale.setScalar(Math.max(0.4, ringWorldRadius));
    // Billboard toward camera so the ring always reads as a circle.
    ring.lookAt(cam.position);
    ring.visible = true;
    requestRenderRef.current();

    const sample = filteredSamples4D[idx];
    if (label && sample) {
      let text = conditionLabel(sample.treatment.drug);
      if (useFeatureColoring && coloringFeature) {
        const v = featureValues[coloringFeature]?.[sampleIdToEmbeddingIndex.get(sample.id) ?? -1];
        text += Number.isFinite(v) ? ` · ${formatFeatureValue(v)}` : ' · no measurement';
      }
      const inComparison = compareSamples.some((s) => s.id === sample.id);
      const hint = inComparison
        ? `${comparePicking ? 'Click' : 'Shift-click'} to remove from the comparison`
        : compareSamples.length >= MAX_COMPARE_CELLS
          ? `The comparison is full (${MAX_COMPARE_CELLS} cells)`
          : comparePicking
            ? 'Click to add to the comparison'
            : 'Shift-click to compare';
      if (hoverTextRef.current) hoverTextRef.current.textContent = text;
      if (hoverHintRef.current) hoverHintRef.current.textContent = hint;
      label.style.display = 'block';
      const x = pos.x - rect.left;
      const y = pos.y - rect.top;
      // Keep the label inside the canvas: flip left near the right edge, below near the top.
      const flipX = x > rect.width - label.offsetWidth - 28;
      const flipY = y < label.offsetHeight + 18;
      label.style.left = `${flipX ? x - label.offsetWidth - 14 : x + 14}px`;
      label.style.top = `${flipY ? y + 18 : y - label.offsetHeight - 12}px`;
    }
  }, [
    filteredSamples4D,
    visualizerOptions.pointSize,
    useFeatureColoring,
    coloringFeature,
    featureValues,
    sampleIdToEmbeddingIndex,
    comparePicking,
    compareSamples,
  ]);

  // Refresh the label under a still pointer when a click changed what the next click would do.
  useEffect(() => {
    if (lastPointerCssRef.current && hoverLabelRef.current?.style.display === 'block') updateHoverPreview();
  }, [updateHoverPreview]);

  // Frames queued by pointer moves run the latest version, so a click's effect shows at once.
  const updateHoverPreviewRef = useRef(updateHoverPreview);
  updateHoverPreviewRef.current = updateHoverPreview;

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerDownRef.current && !pointerMovedRef.current) {
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) pointerMovedRef.current = true;
    }
    lastPointerCssRef.current = { x: e.clientX, y: e.clientY };
    if (!hoverFrameQueuedRef.current) {
      hoverFrameQueuedRef.current = true;
      requestAnimationFrame(() => updateHoverPreviewRef.current());
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerDownRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    pointerDownRef.current = null;
    lastPointerCssRef.current = null;
    if (hoverLabelRef.current) hoverLabelRef.current.style.display = 'none';
    if (hoverRingRef.current?.visible) {
      hoverRingRef.current.visible = false;
      requestRenderRef.current();
    }
  }, []);

  const handleClick = (event: React.MouseEvent) => {
    // Clicks on overlay buttons bubble here too; only the canvas itself picks or deselects.
    if (event.target !== rendererRef.current?.domElement) return;
    if (!containerRef.current || !cameraRef.current || !pointsRef.current) return;
    if (isDragging || pointerMovedRef.current) {
      pointerMovedRef.current = false;
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const geo = pointsRef.current.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const count = Math.min(posAttr.count, filteredSamples4D.length);
    const pointSizeWorld = visualizerOptions.pointSize;

    const bestIdx = pickFilteredPointIndexFromPointer(
      event.clientX,
      event.clientY,
      rect,
      cameraRef.current,
      posAttr,
      count,
      pointSizeWorld
    );

    // Shift- or Cmd/Ctrl-click, or any click while picking, collects cells for comparison and
    // leaves the open cell as it is.
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    if (modifier || comparePicking) {
      dropdownCloseInProgressRef.current = false;
      if (bestIdx >= 0) {
        if (introVisible) dismissIntro();
        if (!toggleCompare(filteredSamples4D[bestIdx], modifier ? 'map' : 'pick')) flashCompareFull();
      }
      return;
    }

    if (bestIdx >= 0) {
      if (introVisible) dismissIntro();
      setSelectedPointIndex(bestIdx);
      setSelectedSample(filteredSamples4D[bestIdx]);
      trackEvent('select_cell', {
        source: 'map',
        condition: filteredSamples4D[bestIdx].treatment.drug,
        cell: filteredSamples4D[bestIdx].id,
      });
        setSemanticState((s) => ({ ...s, projectedPosition: null, projectedConfidence: null }));
    } else if (dropdownCloseInProgressRef.current) {
      dropdownCloseInProgressRef.current = false;
    } else {
      setSelectedSample(null);
      setSelectedPointIndex(null);
      setSemanticState((s) => ({ ...s, projectedPosition: null, projectedConfidence: null }));
    }
  };

  const handleResetView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    if (datasetVersion === 'v3') {
      applyV3PinnedDefaultCamera(cameraRef.current, controlsRef.current);
      return;
    }
    const c = v1DiagonalCameraCoord();
    cameraRef.current.position.set(c, c, c);
    cameraRef.current.up.set(0, 1, 0);
    cameraRef.current.lookAt(new THREE.Vector3(0, 0, 0));
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [datasetVersion]);

  /** Zoom buttons: scale the distance to the orbit centre, within the controls' limits. */
  const zoomBy = useCallback((factor: number) => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;
    const offset = cam.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    cam.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
  }, []);

  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    // Fullscreen the atlas and the sample panel together so a selected cell stays visible.
    const el = (fullscreenContainerRef.current?.closest('[data-fullscreen-root]') ??
      fullscreenContainerRef.current) as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
  }, []);

  // The icon follows the browser's actual state (requests can be refused or exited with Esc).
  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      setIsFullscreen(!!(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  // Frame the visible cells when the condition filter changes; clearing it restores the default view.
  useEffect(() => {
    if (lastFilterKeyRef.current === filterKey) return;
    lastFilterKeyRef.current = filterKey;
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls || filteredSamples4D.length === 0) return;
    if (selectedDrugs.size === 0 && !searchQuery.trim()) {
      handleResetView();
      return;
    }
    // The cloud is drawn centred on the visible cells' centroid, so frame a sphere at the origin.
    const center = getCenter();
    const dists = filteredSamples4D
      .map((s) => Math.hypot(s.x - center.x, s.y - center.y, s.z - center.z) * SCALE_FACTOR)
      .sort((a, b) => a - b);
    // 99.5th percentile keeps sparse tails in frame while ignoring the odd far outlier.
    const radius = Math.max(1, dists[Math.floor((dists.length - 1) * 0.995)]);
    const halfFov = THREE.MathUtils.degToRad(cam.fov) / 2;
    const halfFovX = Math.atan(Math.tan(halfFov) * cam.aspect);
    const distance = THREE.MathUtils.clamp(
      (radius / Math.sin(Math.min(halfFov, halfFovX))) * 1.1,
      controls.minDistance,
      controls.maxDistance
    );
    const dir = cam.position.clone().sub(controls.target).normalize();
    controls.target.set(0, 0, 0);
    cam.position.copy(dir.multiplyScalar(distance));
    controls.update();
  }, [filterKey, filteredSamples4D, selectedDrugs, searchQuery, getCenter, handleResetView]);

  const visibleSampleIds = React.useMemo(
    () =>
      filteredSamples4D.length === samples4D.length
        ? null
        : new Set(filteredSamples4D.map((s) => s.id)),
    [filteredSamples4D, samples4D]
  );

  // The axis strip keeps showing the last feature whose values and range are ready, so turning
  // the axis on or switching features never leaves the strip slot empty for a moment.
  const [axisStrip, setAxisStrip] = useState<{
    feature: string;
    range: NonNullable<typeof semanticState.featureRange>;
    values: number[];
  } | null>(null);
  const stripFeature = semanticState.selectedFeature;
  const stripRange = semanticState.featureRange;
  const stripValues = stripFeature ? featureValues[stripFeature] : undefined;
  const stripReady = Boolean(
    stripFeature && stripRange && semanticState.featureRangeFeature === stripFeature && stripValues
  );
  useEffect(() => {
    if (!semanticState.advancedMode) setAxisStrip(null);
    else if (stripReady) setAxisStrip({ feature: stripFeature!, range: stripRange!, values: stripValues! });
  }, [semanticState.advancedMode, stripReady, stripFeature, stripRange, stripValues]);
  const showAxisStrip = Boolean(semanticState.advancedMode && semanticState.axisSamplesVisible && axisStrip);
  const showConditionStrip =
    samples4D.length > 0 && (!semanticState.advancedMode || (semanticState.axisSamplesVisible && !axisStrip));

  // Only show "Mapping …" if it takes longer than a blink, so quick switches don't flash it.
  const mappingPending = (axisColorPending || (useFeatureColoring && !smoothedFeatureValues)) && !isLoading;
  const [showMappingPill, setShowMappingPill] = useState(false);
  useEffect(() => {
    if (!mappingPending) {
      setShowMappingPill(false);
      return;
    }
    const id = window.setTimeout(() => setShowMappingPill(true), 250);
    return () => window.clearTimeout(id);
  }, [mappingPending]);

  const selectFromStrip = useCallback(
    (source: 'strip' | 'axis_strip') => (sample: Sample, event: React.MouseEvent) => {
      if (comparePicking || event.shiftKey || event.metaKey || event.ctrlKey) {
        if (!toggleCompare(sample, 'strip')) flashCompareFull();
        return;
      }
      setSelectedSample(sample);
      trackEvent('select_cell', { source, condition: sample.treatment.drug, cell: sample.id });
    },
    [setSelectedSample, comparePicking, toggleCompare, flashCompareFull]
  );

  // Picking ends when the map goes away (e.g. on the About page).
  useEffect(() => () => setComparePicking(false), [setComparePicking]);

  const compareNumbers = React.useMemo(
    () => new Map(compareSamples.map((s, i) => [s.id, i + 1])),
    [compareSamples]
  );

  // Where each compared cell sits in the scene (null when the filter hides it).
  const comparePositions = React.useMemo(
    () => compareSamples.map((s, i) => (compareHidden[i] ? null : toScenePos(s.x, s.y, s.z))),
    [compareSamples, compareHidden, toScenePos]
  );
  useEffect(() => {
    const projected = new THREE.Vector3();
    afterRenderRef.current = () => {
      const root = compareMarkersRef.current;
      const cam = cameraRef.current;
      const container = containerRef.current;
      if (!root || !cam || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      comparePositions.forEach((pos, i) => {
        const el = root.children[i] as HTMLElement | undefined;
        if (!el) return;
        if (pos) projected.copy(pos).project(cam);
        const onScreen = Boolean(pos) && projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        el.style.display = onScreen ? 'block' : 'none';
        if (onScreen) el.style.transform = `translate(${((projected.x + 1) / 2) * w}px, ${((1 - projected.y) / 2) * h}px)`;
      });
    };
    requestRenderRef.current();
    return () => {
      afterRenderRef.current = () => {};
    };
  }, [comparePositions]);

  /** Select a cell and glide the orbit centre to it, keeping the current angle and distance. */
  const focusCellOnMap = useCallback(
    (sample: Sample) => {
      setSelectedSample(sample);
      const idx = filteredSamples4D.findIndex((s) => s.id === sample.id);
      setSelectedPointIndex(idx >= 0 ? idx : null);
      setSemanticState((s) => ({ ...s, projectedPosition: null, projectedConfidence: null }));
      const cam = cameraRef.current;
      const controls = controlsRef.current;
      if (!cam || !controls || idx < 0) return;
      const fromTarget = controls.target.clone();
      const fromPosition = cam.position.clone();
      const delta = toScenePos(sample.x, sample.y, sample.z).sub(fromTarget);
      const duration = prefersReducedMotion() ? 0 : 550;
      cancelAnimationFrame(flyToRafRef.current);
      let start = -1;
      const step = (now: number) => {
        if (start < 0) start = now;
        const e = duration ? easeInOutCubic(Math.min(1, (now - start) / duration)) : 1;
        controls.target.copy(fromTarget).addScaledVector(delta, e);
        cam.position.copy(fromPosition).addScaledVector(delta, e);
        controls.update();
        requestRenderRef.current();
        flyToRafRef.current = e < 1 ? requestAnimationFrame(step) : 0;
      };
      flyToRafRef.current = requestAnimationFrame(step);
    },
    [filteredSamples4D, setSelectedSample, setSelectedPointIndex, setSemanticState, toScenePos]
  );
  useEffect(() => {
    setMapFocusHandler(focusCellOnMap);
    return () => setMapFocusHandler(null);
  }, [focusCellOnMap, setMapFocusHandler]);
  useEffect(() => () => cancelAnimationFrame(flyToRafRef.current), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // The comparison covers the map and handles its own keys.
      if (compareOpen) return;
      // Leave browser shortcuts (Cmd/Ctrl+F, Cmd/Ctrl+R, …) alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape' && showHelp) {
        // Closing the overlay should not also deselect (global Esc handler).
        e.preventDefault();
        e.stopPropagation();
        setShowHelp(false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleResetView();
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setComparePicking(!comparePicking, 'key');
      }
    };
    // Capture phase so closing the help overlay wins over the global Esc handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleResetView, toggleFullscreen, showHelp, compareOpen, comparePicking, setComparePicking]);

  return (
    <div ref={fullscreenContainerRef} className={`${isDarkMode ? 'bg-black' : 'bg-white'} h-full flex flex-col overflow-hidden`}>
      {/* Sticky toolbar - stays visible when scrolling visualization pane */}
      <div
        className={`shrink-0 px-6 py-2.5 border-b ${isDarkMode ? 'bg-black/90 border-white/[0.08]' : 'bg-white border-gray-200'}`}
        role="toolbar"
        aria-label="Visualization controls"
      >
        <VisualizerControls
          type="4d"
          onSemanticSliderChange={handleSemanticSliderChange}
          dark={isDarkMode}
        />
      </div>

      {/* Condition rail / movie strip; the cells-along-axis strip replaces it in semantic-axis mode. */}
      <SmoothHeight className="shrink-0">
        {showConditionStrip && (
          <DrugConditionStrip
            samples={filteredSamples4D}
            expanded={drugStripExpanded}
            onToggleExpanded={() => setDrugStripExpanded((v) => !v)}
            onSelectSample={selectFromStrip('strip')}
            paused={compareOpen}
            compareNumbers={compareNumbers}
            picking={comparePicking}
          />
        )}
        {showAxisStrip && axisStrip && (
          <SemanticAxisPreview
            featureRange={axisStrip.range}
            featureValues={axisStrip.values}
            selectedFeature={axisStrip.feature}
            pending={axisStrip.feature !== semanticState.selectedFeature}
            samples={samples4D}
            visibleSampleIds={visibleSampleIds}
            apiEmbeddingCount={apiEmbeddingCount}
            datasetVersion={datasetVersion}
            onClose={() =>
              setSemanticState((s) => ({ ...s, axisSamplesVisible: false }))
            }
            onSelectSample={selectFromStrip('axis_strip')}
            paused={compareOpen}
            compareNumbers={compareNumbers}
            picking={comparePicking}
          />
        )}
      </SmoothHeight>

      <div
        ref={containerRef}
        className={`flex-1 min-h-0 relative overflow-hidden ${comparePicking ? 'cursor-crosshair' : ''}`}
        role="region"
        aria-label="Cell map"
        aria-describedby="cell-map-help"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        style={{
          background: isDarkMode
            ? 'linear-gradient(to bottom, #171717 0%, #1a1a1a 30%, #1a1a1a 70%, #1e1e1e 100%)'
            : 'linear-gradient(to bottom, #e5e5e5 0%, #f0f0f0 30%, #f0f0f0 70%, #f5f5f5 100%)',
        }}
      >
        <p id="cell-map-help" className="sr-only">
          3D map of single cells, one point per cell. Drag to rotate, scroll to zoom, click a point to
          open that cell. To choose a cell with the keyboard, use the strip of conditions above the map.
        </p>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="w-9 h-9 border-2 border-white/20 border-t-white/80 rounded-full animate-spin motion-reduce:animate-none" />
          </div>
        )}

        <div
          ref={hoverLabelRef}
          className="pointer-events-none absolute z-10 hidden whitespace-nowrap rounded-md border border-white/15 bg-black/80 px-2 py-1 text-[11px] font-medium text-white/90 shadow-elevated backdrop-blur-sm"
          aria-hidden="true"
        >
          <span ref={hoverTextRef} className="block" />
          <span ref={hoverHintRef} className="mt-0.5 block text-[10px] font-normal text-white/55" />
        </div>

        <div ref={compareMarkersRef} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
          {compareSamples.map((sample, i) => (
            <div key={sample.id} className="absolute left-0 top-0" style={{ display: 'none' }}>
              {/* One filled dot over the cell: its number, edged in the condition color. */}
              <span
                className="absolute -left-[10px] -top-[10px] flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-black tabular-nums"
                style={{ boxShadow: `0 0 0 2px ${rgbCss(sample.color)}, 0 0 0 3.5px rgba(0, 0, 0, 0.55)` }}
              >
                {i + 1}
              </span>
            </div>
          ))}
        </div>

        <CompareTray fullNotice={compareFullNotice} />

        {introVisible && !isLoading && (
          <div
            className="absolute top-4 left-4 z-10 max-w-sm rounded-xl border border-white/10 bg-black/80 backdrop-blur-sm px-4 py-3 shadow-elevated"
            role="note"
          >
            <p className="text-sm text-white/90 leading-relaxed">
              Each dot is one cell&apos;s 4D mitochondrial movie. Cells with similar mitochondrial shape and
              motion sit close together.
            </p>
            <p className="mt-1.5 text-xs text-white/55">
              Drag to rotate · Scroll to zoom · Click a dot to watch its movie · Shift-click dots to compare cells
            </p>
            <button
              type="button"
              onClick={dismissIntro}
              className="mt-3 h-8 px-3 rounded-lg text-xs font-medium bg-white text-black hover:bg-white/90 transition-colors"
            >
              Got it
            </button>
          </div>
        )}

        {mappingPending && showMappingPill && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none animate-fade-in">
            <div
              className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/75 backdrop-blur-md px-3.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-3.5 w-3.5 rounded-full border-2 border-white/25 border-t-white animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-white/90 tracking-wide">
                Mapping {pendingFeatureLabel || 'feature'}…
              </span>
            </div>
          </div>
        )}

        {graphicsLost && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-black/70" role="alert">
            <div className="max-w-sm text-center rounded-2xl border border-white/10 bg-black/80 px-6 py-5 shadow-elevated">
              <p className="text-sm font-medium text-white/90">The 3D view was interrupted</p>
              <p className="mt-1 text-xs text-white/55">
                The browser paused graphics on this page. It usually comes back on its own in a moment.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 h-9 px-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/90 transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        )}

        {/* Empty-filter state: filters excluded every cell. */}
        {noSamplesAfterFilter && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
            <div className="pointer-events-auto max-w-sm text-center rounded-2xl border border-white/10 bg-black/70 backdrop-blur-sm px-6 py-5 shadow-elevated">
              <p className="text-sm font-medium text-white/90">No cells match your filters</p>
              <p className="mt-1 text-xs text-white/55">
                Try removing a condition or clearing your search to see the atlas again.
              </p>
              <button
                type="button"
                onClick={clearDrugFilter}
                className="mt-4 h-9 px-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/90 transition-colors"
              >
                Clear filters
              </button>
            </div>
          </div>
        )}

        {/* Floating controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button
            onClick={handleResetView}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Reset view (R)"
            aria-label="Reset view"
          >
            <Home size={18} strokeWidth={2} />
          </button>
          <button
            onClick={() => zoomBy(0.8)}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={18} strokeWidth={2} />
          </button>
          <button
            onClick={() => zoomBy(1.25)}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={18} strokeWidth={2} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title={isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize2 size={18} strokeWidth={2} /> : <Maximize2 size={18} strokeWidth={2} />}
          </button>
          <button
            onClick={() => setShowGrid(visualizerOptions.showGrid === false)}
            className={`p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border ${visualizerOptions.showGrid !== false ? 'bg-white/15 text-white border-white/20' : 'bg-white/10 hover:bg-white/15 text-white/90 border-white/10'}`}
            title={visualizerOptions.showGrid !== false ? 'Hide grid' : 'Show grid'}
            aria-label="Grid"
            aria-pressed={visualizerOptions.showGrid !== false}
          >
            <Grid3X3 size={18} strokeWidth={2} />
          </button>
          <button
            onClick={toggleHelp}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Controls (?)"
            aria-label="Controls and shortcuts"
          >
            <HelpCircle size={18} strokeWidth={2} />
          </button>
        </div>
        
        {/* Bottom-left: no-measurement key (semantic mode) + cell count. The condition rail
            above the canvas is the drug legend. */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          {useFeatureColoring && missingFeatureCount > 0 && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm border border-white/10 ${isDarkMode ? 'bg-black/70 text-white/80' : 'bg-white/90 text-gray-700'}`}
              title="These cells have no value for this feature. They are drawn gray and left out of the color scale, the slider range and the cells along the axis."
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: `rgb(${NO_MEASUREMENT_RGB.r * 255}, ${NO_MEASUREMENT_RGB.g * 255}, ${NO_MEASUREMENT_RGB.b * 255})`,
                }}
                aria-hidden="true"
              />
              <span>No measurement · {missingFeatureCount.toLocaleString()} cells</span>
            </div>
          )}
          <div className={`px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm border border-white/10 ${isDarkMode ? 'bg-black/70 text-white/80' : 'bg-white/90 text-gray-700'}`}>
            <div className="flex items-center gap-2">
              {import.meta.env.DEV && (
                <>
                  <span ref={fpsDotRef} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span ref={fpsTextRef}>0 FPS</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{pointCount.toLocaleString()} cells</span>
            </div>
          </div>
        </div>
        
        {/* Help overlay */}
        {showHelp && (
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={toggleHelp}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="map-help-title"
              className="bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-elevated p-6 w-full max-w-md animate-fade-in"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="map-help-title" className="text-lg font-semibold text-white mb-4">Controls</h3>
              <dl className="space-y-3 text-sm text-white/70">
                {[
                  ['Drag', 'Rotate'],
                  ['Right-drag or Shift-drag', 'Pan'],
                  ['Scroll or pinch', 'Zoom'],
                  ['Click a dot', 'Open that cell'],
                  ['Shift-click a dot', 'Add it to the comparison'],
                  ['Compare cells, then click dots', 'Pick cells to compare'],
                  ['Click empty space', 'Clear the selection'],
                ].map(([action, effect]) => (
                  <div key={action} className="flex justify-between gap-4">
                    <dt className="font-medium text-white/90">{action}</dt>
                    <dd>{effect}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-white/10 mt-4 pt-4">
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-2.5">Shortcuts</p>
                <dl className="space-y-2 text-sm text-white/70">
                  {[
                    ['F', 'Full screen'],
                    ['R', 'Reset view'],
                    ['C', 'Start or stop picking cells to compare'],
                    ['Esc', 'Stop picking, or clear the selection'],
                    ['?', 'Show or hide this panel'],
                  ].map(([key, effect]) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <dt>
                        <kbd className="inline-flex min-w-[28px] h-6 items-center justify-center rounded-md border border-white/15 bg-white/[0.06] px-1.5 font-sans text-xs font-medium text-white/90">
                          {key}
                        </kbd>
                      </dt>
                      <dd>{effect}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <button autoFocus className="btn-primary mt-6 w-full" onClick={toggleHelp}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Visualizer4D;
