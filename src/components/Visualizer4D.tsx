import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Home, ZoomIn, ZoomOut, HelpCircle, Maximize2, Minimize2, Grid3X3 } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import SemanticAxisPreview from './SemanticAxisPreview';
import DrugConditionStrip from './DrugConditionStrip';
import ColorLegend from './ColorLegend';
import { projectOnAxis, getAxisTrajectory } from '../api/client';
import { featureToColorPlasmaAdaptive, plasmaAtT } from '../utils/featureColor';
import { adaptColorForDarkTheme } from '../utils/colorUtils';
import { dropdownCloseInProgressRef } from '../utils/dropdownCloseRef';
import { buildSampleIdToIndex } from '../utils/sampleIndexMap';
import { computeDistancesToPolyline, buildFadeFactors } from '../utils/axisDistance';
import { smoothFeatureValuesKnn } from '../utils/featureSmooth';
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
  buildSmoothCursorPath,
  buildTrajectorySnapPath,
  evaluateCursorPath,
  type CursorPath,
} from '../utils/axisCursorPath';
import type { AxisStyle } from '../types';

const SCALE_FACTOR = 4;

/** Default orbit distance: symmetric diagonal toward origin (same for v1 and v3). */
function v1DiagonalCameraCoord(): number {
  const initDist = 1 + 0.26 * 299;
  return initDist / Math.sqrt(3);
}

/** Reused for dense point picking (avoid per-click allocations). */
const pickWorldP = new THREE.Vector3();
const pickViewP = new THREE.Vector3();
const pickNdc = new THREE.Vector3();

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
    featureValues,
    setSemanticState,
    apiEmbeddingCount,
    datasetVersion,
  } = useSample();

  const sampleIdToEmbeddingIndex = React.useMemo(
    () => buildSampleIdToIndex(samples4D),
    [samples4D]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const selectedPointMeshRef = useRef<THREE.Mesh | null>(null);
  const targetHighlightPosRef = useRef<THREE.Vector3 | null>(null);
  /** Hover indicator ring: shows which point a click would select. */
  const hoverRingRef = useRef<THREE.Mesh | null>(null);
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

  const [trajectoryPoints, setTrajectoryPoints] = useState<Array<{ x: number; y: number; z: number }> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [fps, setFps] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Drug-conditions overview strip (renders above the canvas on first view).
  // `drugStripVisible` toggles from the toolbar or the strip's close control.
  // While semantic axis is on, `drugStripKilled` hides the strip (it conflicts
  // with the "samples along axis" strip). Turning semantic axis off clears
  // `drugStripKilled` so the overview can be opened again.
  const [drugStripVisible, setDrugStripVisible] = useState(true);
  const [drugStripKilled, setDrugStripKilled] = useState(false);

  // Axis-samples strip and drug overview don't share the layout; hide drug
  // strip whenever axis samples are shown.
  useEffect(() => {
    if (semanticState.axisSamplesVisible && !drugStripKilled) {
      setDrugStripKilled(true);
      setDrugStripVisible(false);
    }
  }, [semanticState.axisSamplesVisible, drugStripKilled]);

  // Leaving semantic-axis mode restores the option to open the drug overview.
  useEffect(() => {
    if (!semanticState.advancedMode && drugStripKilled) {
      setDrugStripKilled(false);
    }
  }, [semanticState.advancedMode, drugStripKilled]);

  const toggleHelp = () => {
    setShowHelp(!showHelp);
  };

  const getCenter = useCallback(() => {
    const center = new THREE.Vector3();
    filteredSamples4D.forEach((s) => center.add(new THREE.Vector3(s.x, s.y, s.z)));
    center.divideScalar(filteredSamples4D.length);
    return center;
  }, [filteredSamples4D]);

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

  const createOrUpdateHighlight = useCallback(
    (position: THREE.Vector3, color: THREE.Color, onTrajectory = false) => {
      if (!sceneRef.current) return;
      const radius = onTrajectory ? 2.6 : 1.8;
      const prev = selectedPointMeshRef.current;
      if (prev && sceneRef.current) {
        sceneRef.current.remove(prev);
      }
      const geometry = new THREE.SphereGeometry(radius, 24, 24);
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: onTrajectory ? 0.95 : 0.9,
        wireframe: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      sceneRef.current.add(mesh);
      selectedPointMeshRef.current = mesh;
      targetHighlightPosRef.current = position.clone();
    },
    []
  );

  // Generate circular point texture for better-looking points
  const generatePointTexture = (darkMode: boolean) => {
    const canvas = document.createElement('canvas');
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    
    if (!context) return null;
    
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 2;
    
    // Draw circular point
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
    
    // Create gradient - adjust for dark mode
    const gradient = context.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, radius
    );
    
    if (darkMode) {
      // Crisp gradient for dark mode - retains color to edges
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.95)');
      gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.85)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
    } else {
      // Original gradient for light mode
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
  };

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
    controls.addEventListener('start', () => {
      setIsDragging(true);
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
    
    // FPS counter setup
    let frameCount = 0;
    let lastTime = performance.now();
    
    const updateFPS = () => {
      const now = performance.now();
      frameCount++;
      if (now - lastTime >= 1000) {
        setFps(Math.round(frameCount * 1000 / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }
    };
    
    const LERP_SPEED = 0.35;
    const animate = () => {
      requestAnimationFrame(animate);
      const mesh = selectedPointMeshRef.current;
      const target = targetHighlightPosRef.current;
      if (mesh && target && mesh.position.distanceTo(target) > 0.001) {
        mesh.position.lerp(target, LERP_SPEED);
      }
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      updateFPS();
    };
    
    animate();
    setIsLoading(false);
    
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = Math.max(1, containerRef.current.clientWidth);
      const h = Math.max(1, containerRef.current.clientHeight);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
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
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheel);
      }
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      if (pointsRef.current && sceneRef.current) {
        sceneRef.current.remove(pointsRef.current);
      }
      if (selectedPointMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(selectedPointMeshRef.current);
        selectedPointMeshRef.current = null;
      }
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
    };
  }, []);

  // Apply default camera when dataset version changes (same diagonal framing for v1 and v3).
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    const c = v1DiagonalCameraCoord();
    cameraRef.current.position.set(c, c, c);
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

  const useFeatureColoring =
    semanticState.advancedMode &&
    semanticState.selectedFeature &&
    featureValues[semanticState.selectedFeature]?.length &&
    semanticState.featureRange;

  // Per-feature plasma tuning (gamma + contrast) computed from the selected
  // feature's distribution and cached by array reference.
  const plasmaParams = React.useMemo(() => {
    if (!useFeatureColoring) return { gamma: undefined, contrast: undefined } as const;
    const fname = semanticState.selectedFeature;
    if (!fname) return { gamma: undefined, contrast: undefined } as const;
    const fv = featureValues[fname];
    if (!fv) return { gamma: undefined, contrast: undefined } as const;
    const p = estimatePlasmaParams(fv);
    return { gamma: p.gamma, contrast: p.contrast } as const;
  }, [useFeatureColoring, semanticState.selectedFeature, featureValues]);

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
    if (!useFeatureColoring) return [];
    const fname = semanticState.selectedFeature;
    if (!fname) return [];
    const fv = featureValues[fname];
    const fr = semanticState.featureRange;
    if (!fv || !fr) return [];
    return computeQuantileBeads(filteredSamples4D, fv, filteredEmbeddingIndexOf, fr, 7, 24);
  }, [
    useFeatureColoring,
    semanticState.selectedFeature,
    semanticState.featureRange,
    featureValues,
    filteredSamples4D,
    filteredEmbeddingIndexOf,
  ]);

  /**
   * Endpoint anchor centroids for the `bare` style.
   */
  const endpointAnchors = React.useMemo<EndpointAnchors | null>(() => {
    if (!useFeatureColoring) return null;
    const fname = semanticState.selectedFeature;
    if (!fname) return null;
    const fv = featureValues[fname];
    if (!fv) return null;
    return computeEndpointAnchors(filteredSamples4D, fv, filteredEmbeddingIndexOf, 0.05);
  }, [
    useFeatureColoring,
    semanticState.selectedFeature,
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
    const fname = semanticState.selectedFeature;
    if (!fname) return null;
    const fv = featureValues[fname];
    const fr = semanticState.featureRange;
    if (!fv || !fr) return null;

    if (axisStyle === 'cursor-axis') {
      if (trajectoryPoints && trajectoryPoints.length >= 2) {
        return buildTrajectorySnapPath(trajectoryPoints, filteredSamples4D, fr);
      }
      // Backend trajectory unavailable (e.g. offline). Fall through to
      // the local density-mode path so the cursor still works.
    }
    if (axisStyle === 'cursor' || axisStyle === 'cursor-axis') {
      return buildSmoothCursorPath(
        filteredSamples4D,
        fv,
        filteredEmbeddingIndexOf,
        fr,
        200,
        64
      );
    }
    return null;
  }, [
    axisStyle,
    useFeatureColoring,
    semanticState.selectedFeature,
    semanticState.featureRange,
    featureValues,
    filteredSamples4D,
    filteredEmbeddingIndexOf,
    trajectoryPoints,
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

  /**
   * Gentle k-NN spatial smoothing of the active feature's values across the
   * filtered cloud. We feed the *smoothed* values into the plasma colormap so
   * adjacent points get similar colors — much less speckle, gradient reads as
   * a gradient. The colormap and its scaling are unchanged, so colors still
   * mean magnitudes (no rank distortion). Recomputed only when the cloud or
   * the feature changes; the slider doesn't pay for it.
   */
  const smoothedFeatureValues = React.useMemo<Float32Array | null>(() => {
    if (!useFeatureColoring) return null;
    const fname = semanticState.selectedFeature;
    if (!fname) return null;
    const fvCol = featureValues[fname];
    if (!fvCol || filteredSamples4D.length === 0) return null;
    return smoothFeatureValuesKnn(
      filteredSamples4D,
      fvCol,
      (i) => sampleIdToEmbeddingIndex.get(filteredSamples4D[i].id) ?? -1,
      6,
      0.35
    );
  }, [
    useFeatureColoring,
    semanticState.selectedFeature,
    featureValues,
    filteredSamples4D,
    sampleIdToEmbeddingIndex,
  ]);

  // Update visualization when samples or options change; fade points when trajectory/selection is active
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!filteredSamples4D?.length) {
      prevEmbeddingCentroidRef.current = null;
      return;
    }

    setPointCount(filteredSamples4D.length);
    if (pointsRef.current && sceneRef.current) {
      sceneRef.current.remove(pointsRef.current);
      pointsRef.current = null;
    }

    const center = getCenter();
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

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(filteredSamples4D.length * 3);
    const colors = new Float32Array(filteredSamples4D.length * 3);
    const sizes = new Float32Array(filteredSamples4D.length);
    const pointsOpacity = trajectoryActive ? 0.72 : (isDarkMode ? 1.0 : 0.9);
    const pointsSize = visualizerOptions.pointSize;
    const fr = semanticState.featureRange;
    const fvCol =
      useFeatureColoring && semanticState.selectedFeature
        ? featureValues[semanticState.selectedFeature]
        : null;

    filteredSamples4D.forEach((sample, i) => {
      positions[i * 3] = (sample.x - center.x) * SCALE_FACTOR;
      positions[i * 3 + 1] = (sample.y - center.y) * SCALE_FACTOR;
      positions[i * 3 + 2] = (sample.z - center.z) * SCALE_FACTOR;

      let color: THREE.Color;
      if (fvCol && fr && useFeatureColoring) {
        // Prefer the spatially-smoothed value so neighboring points get
        // similar colors (the gradient reads continuously); fall back to the
        // raw value indexed by embedding if smoothing isn't available yet.
        let v: number | null = null;
        if (smoothedFeatureValues && i < smoothedFeatureValues.length) {
          const sv = smoothedFeatureValues[i];
          v = Number.isFinite(sv) ? sv : null;
        }
        if (v == null) {
          const ei = sampleIdToEmbeddingIndex.get(sample.id) ?? -1;
          v = ei >= 0 && ei < fvCol.length ? fvCol[ei] : null;
        }
        const c = featureToColorPlasmaAdaptive(v, fr.min, fr.max, plasmaParams.gamma, plasmaParams.contrast);
        const adapted = isDarkMode ? adaptColorForDarkTheme(c.r, c.g, c.b) : c;
        if (axisFadeFactors && i < axisFadeFactors.length) {
          // Off-axis points are scaled by a brightness factor in [MIN_B, 1].
          // This preserves hue (no gray-blend), just dims the points farther
          // from the axis so the on-axis ribbon visually pops without the
          // cloud turning desaturated.
          const MIN_B = 0.7;
          const f = axisFadeFactors[i];
          const brightness = MIN_B + (1 - MIN_B) * Math.pow(f, 0.5);
          color = new THREE.Color(
            adapted.r * brightness,
            adapted.g * brightness,
            adapted.b * brightness
          );
        } else {
          color = new THREE.Color(adapted.r, adapted.g, adapted.b);
        }
      } else if (visualizerOptions.coloringMode === 'phenotype') {
        const cr = sample.color_phenotypic?.r ?? 0;
        const cg = sample.color_phenotypic?.g ?? 0;
        const cb = sample.color_phenotypic?.b ?? 0;
        color = isDarkMode
          ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
          : new THREE.Color(cr, cg, cb);
      } else {
        const cr = sample.color?.r ?? 0;
        const cg = sample.color?.g ?? 0;
        const cb = sample.color?.b ?? 0;
        color = isDarkMode
          ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
          : new THREE.Color(cr, cg, cb);
      }
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      sizes[i] = pointsSize;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.PointsMaterial({
      size: pointsSize,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: pointsOpacity,
      alphaTest: 0.5,
      map: generatePointTexture(isDarkMode),
    });
    const points = new THREE.Points(geometry, material);
    sceneRef.current.add(points);
    pointsRef.current = points;
  }, [
    filteredSamples4D,
    visualizerOptions,
    isDarkMode,
    semanticState.advancedMode,
    semanticState.selectedFeature,
    semanticState.projectedPosition,
    semanticState.featureRange,
    featureValues,
    getCenter,
    useFeatureColoring,
    sampleIdToEmbeddingIndex,
    trajectoryActive,
    trajectoryPoints,
    selectedSample,
    axisFadeFactors,
    smoothedFeatureValues,
    plasmaParams.gamma,
    plasmaParams.contrast,
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
      if (selectedPointMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(selectedPointMeshRef.current);
        selectedPointMeshRef.current = null;
      }
      return;
    }
    targetHighlightPosRef.current = pos.clone();
    const useFeatureHighlight =
      useFeatureColoring && selectedSample && semanticState.selectedFeature && semanticState.featureRange;
    let featureHighlightColor: THREE.Color | null = null;
    if (useFeatureHighlight) {
      const fvH = featureValues[semanticState.selectedFeature!];
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
      const mat = selectedPointMeshRef.current.material as THREE.MeshBasicMaterial;
      if (mat) mat.color.copy(color);
      // Resize sphere when switching on/off trajectory (recreate with new radius)
      const currentRadius = (selectedPointMeshRef.current.geometry as THREE.SphereGeometry).parameters.radius;
      const wantRadius = onTrajectory ? 2.6 : 1.8;
      if (Math.abs(currentRadius - wantRadius) > 0.01) {
        createOrUpdateHighlight(pos, color, onTrajectory);
      }
    }
  }, [
    axisStyle,
    semanticState.projectedPosition,
    semanticState.semanticSliderValue,
    semanticState.featureRange,
    selectedSample,
    semanticState.selectedFeature,
    featureValues,
    useFeatureColoring,
    sampleIdToEmbeddingIndex,
    visualizerOptions.coloringMode,
    isDarkMode,
    toScenePos,
    createOrUpdateHighlight,
    trajectoryPoints,
  ]);

  useEffect(() => {
    if (filteredSamples4D.length > 0 && !selectedSample) {
      const defaultSample = filteredSamples4D.find((s) => s.phenotype === 'control');
      if (defaultSample) setSelectedSample(defaultSample);
    }
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
    semanticState.selectedFeature,
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
    if (!pos || !container || !cam || !pts || !ring) return;

    // While the user is rotating/dragging, hide hover — they aren't targeting.
    if (pointerDownRef.current && pointerMovedRef.current) {
      ring.visible = false;
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
      ring.visible = false;
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
  }, [filteredSamples4D.length, visualizerOptions.pointSize]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerDownRef.current && !pointerMovedRef.current) {
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) pointerMovedRef.current = true;
    }
    lastPointerCssRef.current = { x: e.clientX, y: e.clientY };
    if (!hoverFrameQueuedRef.current) {
      hoverFrameQueuedRef.current = true;
      requestAnimationFrame(updateHoverPreview);
    }
  }, [updateHoverPreview]);

  const handlePointerUp = useCallback(() => {
    pointerDownRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    pointerDownRef.current = null;
    lastPointerCssRef.current = null;
    if (hoverRingRef.current) hoverRingRef.current.visible = false;
  }, []);

  const handleClick = (event: React.MouseEvent) => {
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

    if (bestIdx >= 0) {
      setSelectedPointIndex(bestIdx);
      setSelectedSample(filteredSamples4D[bestIdx]);
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
    const c = v1DiagonalCameraCoord();
    cameraRef.current.position.set(c, c, c);
    cameraRef.current.lookAt(new THREE.Vector3(0, 0, 0));
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = fullscreenContainerRef.current as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (!el) return;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.() ?? (document as Document & { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      setIsFullscreen(!!(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleResetView();
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleResetView, toggleFullscreen]);

  return (
    <div ref={fullscreenContainerRef} className={`${isDarkMode ? 'bg-black' : 'bg-white'} h-full flex flex-col overflow-hidden`}>
      {/* Mobile Warning */}
      <div className={`lg:hidden shrink-0 ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'} border-l-4 px-4 py-3`} role="alert">
        <p className="font-medium text-sm">Desktop recommended for best experience</p>
      </div>

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
          drugOverviewStripAvailable={!drugStripKilled && samples4D.length > 0}
          drugOverviewStripVisible={drugStripVisible}
          onDrugOverviewStripToggle={() => setDrugStripVisible((v) => !v)}
        />
      </div>

      {/* Drug-conditions overview strip. Hidden while axis samples are visible
          (see `drugStripKilled`); available again after semantic axis is off. */}
      {drugStripVisible && !semanticState.axisSamplesVisible && samples4D.length > 0 && (
        <DrugConditionStrip
          samples={samples4D}
          onClose={() => setDrugStripVisible(false)}
          onSelectSample={setSelectedSample}
        />
      )}

      {/* Axis samples preview */}
      {semanticState.axisSamplesVisible &&
        semanticState.selectedFeature &&
        semanticState.featureRange &&
        featureValues[semanticState.selectedFeature] && (
          <SemanticAxisPreview
            featureRange={semanticState.featureRange}
            featureValues={featureValues[semanticState.selectedFeature]}
            selectedFeature={semanticState.selectedFeature}
            samples={samples4D}
            apiEmbeddingCount={apiEmbeddingCount}
            datasetVersion={datasetVersion}
            onClose={() =>
              setSemanticState((s) => ({ ...s, axisSamplesVisible: false }))
            }
            onSelectSample={setSelectedSample}
          />
        )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden"
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
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/50">
            <div className="w-10 h-10 border-2 border-mito-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        
        {/* Floating controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button
            onClick={handleResetView}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Reset view (R)"
          >
            <Home size={18} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              if (cameraRef.current) {
                const currentPos = cameraRef.current.position.clone();
                const direction = new THREE.Vector3(0, 0, 0).sub(currentPos).normalize();
                cameraRef.current.position.addScaledVector(direction, 5);
                if (controlsRef.current) controlsRef.current.update();
              }
            }}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Zoom in"
          >
            <ZoomIn size={18} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              if (cameraRef.current) {
                const currentPos = cameraRef.current.position.clone();
                const direction = new THREE.Vector3(0, 0, 0).sub(currentPos).normalize();
                cameraRef.current.position.addScaledVector(direction, -5);
                if (controlsRef.current) controlsRef.current.update();
              }
            }}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Zoom out"
          >
            <ZoomOut size={18} strokeWidth={2} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Fullscreen (F) — hide browser UI"
          >
            {isFullscreen ? <Minimize2 size={18} strokeWidth={2} /> : <Maximize2 size={18} strokeWidth={2} />}
          </button>
          <button
            onClick={() => setShowGrid(visualizerOptions.showGrid === false)}
            className={`p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border ${visualizerOptions.showGrid !== false ? 'bg-white/15 text-white border-white/20' : 'bg-white/10 hover:bg-white/15 text-white/90 border-white/10'}`}
            title={visualizerOptions.showGrid !== false ? 'Hide grid' : 'Show grid'}
          >
            <Grid3X3 size={18} strokeWidth={2} />
          </button>
          <button
            onClick={toggleHelp}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Controls (?)"
          >
            <HelpCircle size={18} strokeWidth={2} />
          </button>
        </div>
        
        {/* Bottom-left: treatment legend (only when not in semantic mode —
            the plasma slider in the toolbar doubles as the gradient legend)
            + perf status. */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          <ColorLegend visible={!useFeatureColoring} />
          <div className={`px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm border border-white/10 ${isDarkMode ? 'bg-black/70 text-white/80' : 'bg-white/90 text-gray-700'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${fps > 30 ? 'bg-emerald-500' : fps > 15 ? 'bg-amber-500' : 'bg-red-500'}`} />
              {fps} FPS · {pointCount.toLocaleString()} points
            </div>
          </div>
        </div>
        
        {/* Help overlay */}
        {showHelp && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={toggleHelp}>
            <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-elevated p-6 w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white mb-4">Controls</h3>
              <div className="space-y-3 text-sm text-white/70">
                <div className="flex justify-between"><span className="font-medium text-white/90">Left drag</span> Rotate</div>
                <div className="flex justify-between"><span className="font-medium text-white/90">Middle / Right drag</span> Pan</div>
                <div className="flex justify-between"><span className="font-medium text-white/90">Scroll / Pinch</span> Zoom</div>
                <div className="flex justify-between"><span className="font-medium text-white/90">Click</span> Select point</div>
                <div className="flex justify-between"><span className="font-medium text-white/90">Click empty</span> Deselect</div>
                <div className="border-t border-white/10 mt-4 pt-4 space-y-1.5">
                  <p className="text-white/50 text-xs font-medium uppercase tracking-wider">Shortcuts</p>
                  <div className="flex justify-between"><span className="font-medium text-white/90">F</span> Fullscreen (hide browser)</div>
                  <div className="flex justify-between"><span className="font-medium text-white/90">R</span> Reset view</div>
                  <div className="flex justify-between"><span className="font-medium text-white/90">Esc</span> Close panel</div>
                </div>
              </div>
              <button className="btn-primary mt-6 w-full" onClick={toggleHelp}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Visualizer4D;
