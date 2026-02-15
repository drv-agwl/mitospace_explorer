import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Home, ZoomIn, ZoomOut, HelpCircle, Maximize2, Minimize2, Copy, Grid3X3 } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import SemanticAxisPreview from './SemanticAxisPreview';
import ColorLegend from './ColorLegend';
import FeatureColorBar from './FeatureColorBar';
import { projectOnAxis, getAxisTrajectory } from '../api/client';
import { featureToColorLog1pSafe } from '../utils/featureColor';
import { adaptColorForDarkTheme } from '../utils/colorUtils';
import { dropdownCloseInProgressRef } from '../utils/dropdownCloseRef';

const SCALE_FACTOR = 4;

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
  } = useSample();

  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const selectedPointMeshRef = useRef<THREE.Mesh | null>(null);
  const targetHighlightPosRef = useRef<THREE.Vector3 | null>(null);
  const selectedSampleIdRef = useRef<string | null>(null);
  const trajectoryLineRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const grid2Ref = useRef<THREE.GridHelper | null>(null);

  const [trajectoryPoints, setTrajectoryPoints] = useState<Array<{ x: number; y: number; z: number }> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [fps, setFps] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);

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
    
    // Set initial camera position (~74% zoom: distance ~79 from origin)
    const initDist = 1 + 0.26 * 299; // 74% zoom
    const initCoord = initDist / Math.sqrt(3);
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
    };
  }, []);

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
  const featureRange = semanticState.featureRange ?? { min: 0, max: 1 };

  // Fetch trajectory whenever Advanced Semantic + feature are set (don't require points so request always runs)
  useEffect(() => {
    if (!semanticState.advancedMode || !semanticState.selectedFeature) {
      setTrajectoryPoints(null);
      return;
    }
    const feature = semanticState.selectedFeature as string;
    getAxisTrajectory(feature, 80)
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
  }, [semanticState.advancedMode, semanticState.selectedFeature]);

  // Render trajectory (tube + direction arrows) in the same space as scatter
  useEffect(() => {
    if (!sceneRef.current) return;
    const prev = trajectoryLineRef.current;
    if (prev && sceneRef.current) {
      sceneRef.current.remove(prev);
      prev.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material) {
            const mat = child.material as THREE.Material;
            mat.dispose();
          }
        }
      });
      trajectoryLineRef.current = null;
    }
    if (!trajectoryPoints?.length || trajectoryPoints.length < 2) return;
    const center =
      filteredSamples4D.length > 0
        ? getCenter()
        : new THREE.Vector3(0, 0, 0);
    const vertices = trajectoryPoints.map((p) => {
      const x = typeof p.x === 'number' ? p.x : (Array.isArray(p) ? p[0] : 0);
      const y = typeof p.y === 'number' ? p.y : (Array.isArray(p) ? p[1] : 0);
      const z = typeof p.z === 'number' ? p.z : (Array.isArray(p) ? p[2] : 0);
      return new THREE.Vector3(
        (x - center.x) * SCALE_FACTOR,
        (y - center.y) * SCALE_FACTOR,
        (z - center.z) * SCALE_FACTOR
      );
    });
    const curve = new THREE.CatmullRomCurve3(vertices, false);
    const tubeRadius = 0.38;
    const tubeSegments = Math.max(vertices.length * 2, 64);
    const radialSegments = 8;
    const geometry = new THREE.TubeGeometry(curve, tubeSegments, tubeRadius, radialSegments, false);
    const posAttr = geometry.getAttribute('position');
    const vertexCount = posAttr.count;
    const colorArray = new Float32Array(vertexCount * 3);
    const startColor = new THREE.Color(isDarkMode ? 0x66b3ff : 0x0066cc);
    const endColor = new THREE.Color(isDarkMode ? 0xffaa44 : 0xff6600);
    for (let i = 0; i < vertexCount; i++) {
      const t = Math.floor(i / radialSegments) / tubeSegments;
      const r = startColor.r + (endColor.r - startColor.r) * t;
      const g = startColor.g + (endColor.g - startColor.g) * t;
      const b = startColor.b + (endColor.b - startColor.b) * t;
      colorArray[i * 3] = r;
      colorArray[i * 3 + 1] = g;
      colorArray[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    const tubeMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    const tube = new THREE.Mesh(geometry, tubeMaterial);
    tube.renderOrder = 10;

    const group = new THREE.Group();
    group.add(tube);

    const arrowCount = 5;
    const arrowRadius = 0.9;
    const arrowHeight = 2.2;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 1; i <= arrowCount; i++) {
      const t = i / (arrowCount + 1);
      const pos = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const arrowGeom = new THREE.ConeGeometry(arrowRadius, arrowHeight, 8);
      const arrowMat = new THREE.MeshBasicMaterial({
        color: isDarkMode ? 0xffaa44 : 0xff6600,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      });
      const arrow = new THREE.Mesh(arrowGeom, arrowMat);
      arrow.position.copy(pos);
      if (tangent.lengthSq() > 1e-6) {
        const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent);
        arrow.applyQuaternion(quat);
      }
      arrow.renderOrder = 11;
      group.add(arrow);
    }

    group.renderOrder = 10;
    sceneRef.current.add(group);
    trajectoryLineRef.current = group;
    return () => {
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
    };
  }, [trajectoryPoints, isDarkMode, filteredSamples4D.length, getCenter]);

  const trajectoryActive =
    Boolean(semanticState.advancedMode && semanticState.selectedFeature && trajectoryPoints?.length) ||
    Boolean(selectedSample && semanticState.projectedPosition);

  // Update visualization when samples or options change; fade points when trajectory/selection is active
  useEffect(() => {
    if (!sceneRef.current) return;
    if (!filteredSamples4D?.length) return;

    setPointCount(filteredSamples4D.length);
    if (pointsRef.current && sceneRef.current) {
      sceneRef.current.remove(pointsRef.current);
      pointsRef.current = null;
    }

    const center = getCenter();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(filteredSamples4D.length * 3);
    const colors = new Float32Array(filteredSamples4D.length * 3);
    const sizes = new Float32Array(filteredSamples4D.length);
    const fv = useFeatureColoring ? featureValues[semanticState.selectedFeature!] : null;
    const pointsOpacity = trajectoryActive ? 0.72 : (isDarkMode ? 1.0 : 0.9);
    const pointsSize = visualizerOptions.pointSize;

    filteredSamples4D.forEach((sample, i) => {
      positions[i * 3] = (sample.x - center.x) * SCALE_FACTOR;
      positions[i * 3 + 1] = (sample.y - center.y) * SCALE_FACTOR;
      positions[i * 3 + 2] = (sample.z - center.z) * SCALE_FACTOR;

      let color: THREE.Color;
      if (fv && i < fv.length) {
        const c = featureToColorLog1pSafe(fv[i], featureRange.min, featureRange.max);
        color = isDarkMode
          ? new THREE.Color(...Object.values(adaptColorForDarkTheme(c.r, c.g, c.b)))
          : new THREE.Color(c.r, c.g, c.b);
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
    semanticState.featureRange,
    semanticState.projectedPosition,
    featureValues,
    getCenter,
    useFeatureColoring,
    featureRange.min,
    featureRange.max,
    trajectoryActive,
    trajectoryPoints,
    selectedSample,
  ]);

  // Highlight position: projected (semantic, already in scene space from API) or selected sample
  useEffect(() => {
    const proj = semanticState.projectedPosition;
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
    const useFeature = useFeatureColoring && selectedSample && lastSelectedIndex != null;
    const fv = useFeature && semanticState.selectedFeature ? featureValues[semanticState.selectedFeature] : null;
    const val =
      fv && lastSelectedIndex != null && lastSelectedIndex < fv.length
        ? fv[lastSelectedIndex]
        : null;
    let color: THREE.Color;
    if (useFeature && val != null && semanticState.featureRange) {
      const c = featureToColorLog1pSafe(val, semanticState.featureRange.min, semanticState.featureRange.max);
      color = isDarkMode
        ? new THREE.Color(...Object.values(adaptColorForDarkTheme(c.r, c.g, c.b)))
        : new THREE.Color(c.r, c.g, c.b);
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
    semanticState.projectedPosition,
    selectedSample,
    semanticState.featureRange,
    semanticState.selectedFeature,
    featureValues,
    useFeatureColoring,
    lastSelectedIndex,
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
    (pointIndex: number, targetValue: number) => {
      const embeddingIndex = selectedSample
        ? samples4D.findIndex((s) => s.id === selectedSample.id)
        : pointIndex;
      const effectiveIndex = embeddingIndex >= 0 ? embeddingIndex : pointIndex;
      const maxIndex = apiEmbeddingCount ?? Infinity;
      if (effectiveIndex < 0 || effectiveIndex >= maxIndex) return;
      const feature = semanticState.selectedFeature ?? 'Optical Flow (fg)';
      const center = getCenter();
      const options = {
        centerX: center.x,
        centerY: center.y,
        centerZ: center.z,
        scaleFactor: SCALE_FACTOR,
      };
      const requestSampleId = selectedSample?.id ?? null;
      projectOnAxis(effectiveIndex, targetValue, feature, options)
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
    [selectedSample, samples4D, semanticState.selectedFeature, setSemanticState, apiEmbeddingCount, getCenter]
  );

  // Initial projection when slider first appears (or feature/point changes) - show golden sphere
  const lastProjKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !semanticState.advancedMode ||
      !semanticState.selectedFeature ||
      !semanticState.featureRange
    )
      return;
    const key = `${semanticState.selectedFeature}-${selectedPointIndex ?? 'n'}`;
    if (lastProjKeyRef.current === key) return;
    lastProjKeyRef.current = key;
    const val =
      semanticState.semanticSliderValue ??
      (semanticState.featureRange.min + semanticState.featureRange.max) / 2;
    const idx =
      selectedSample != null
        ? samples4D.findIndex((s) => s.id === selectedSample.id)
        : 0;
    handleSemanticSliderChange(idx >= 0 ? idx : 0, val);
  }, [
    semanticState.advancedMode,
    semanticState.selectedFeature,
    semanticState.featureRange,
    semanticState.semanticSliderValue,
    selectedPointIndex,
    selectedSample,
    samples4D,
    handleSemanticSliderChange,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    pointerMovedRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerDownRef.current && !pointerMovedRef.current) {
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) pointerMovedRef.current = true;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerDownRef.current = null;
  }, []);

  const handleClick = (event: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !pointsRef.current) return;
    if (isDragging || pointerMovedRef.current) {
      pointerMovedRef.current = false;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObject(pointsRef.current);
    if (intersects.length > 0) {
      const index = intersects[0].index;
      if (typeof index === 'number' && index < filteredSamples4D.length) {
        setLastSelectedIndex(index);
        setSelectedPointIndex(index);
        setSelectedSample(filteredSamples4D[index]);
        setSemanticState((s) => ({ ...s, projectedPosition: null, projectedConfidence: null }));
      }
    } else {
      if (dropdownCloseInProgressRef.current) {
        dropdownCloseInProgressRef.current = false;
      } else {
        setSelectedSample(null);
        setSelectedPointIndex(null);
        setSemanticState((s) => ({ ...s, projectedPosition: null, projectedConfidence: null }));
      }
    }
  };

  const handleResetView = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.set(25, 25, 25);
      cameraRef.current.lookAt(new THREE.Vector3(0, 0, 0));
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }
    }
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

  const handleCopyCoords = () => {
    if (!selectedSample) return;
    const s = selectedSample;
    const text = `(${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)})`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 1500);
    });
  };

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
        data-tour="controls-toolbar"
      >
        <VisualizerControls type="4d" onSemanticSliderChange={handleSemanticSliderChange} dark={isDarkMode} />
      </div>

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
            onClose={() =>
              setSemanticState((s) => ({ ...s, axisSamplesVisible: false }))
            }
            onSelectSample={setSelectedSample}
          />
        )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden"
        data-tour="visualizer-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
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
        
        {/* Copy coords - when sample selected */}
        {selectedSample && (
          <button
            onClick={handleCopyCoords}
            className="absolute top-4 left-4 bg-white/10 hover:bg-white/15 text-white/90 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors border border-white/10"
            title="Copy coordinates"
          >
            <Copy size={14} strokeWidth={2} />
            {copiedCoords ? 'Copied!' : 'Copy coordinates'}
          </button>
        )}
        
        {/* Bottom-left: legend or feature color bar + status */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          <ColorLegend visible={!useFeatureColoring} />
          <FeatureColorBar visible={!!useFeatureColoring} />
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
