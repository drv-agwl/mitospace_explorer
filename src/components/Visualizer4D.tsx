import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sun, Moon, Home, ZoomIn, ZoomOut, HelpCircle } from 'lucide-react';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import { projectOnAxis, getAxisTrajectory } from '../api/client';
import { featureToColorLog1pSafe } from '../utils/featureColor';
import { adaptColorForDarkTheme } from '../utils/colorUtils';

const SCALE_FACTOR = 4;

const Visualizer4D: React.FC = () => {
  const {
    filteredSamples4D,
    samples4D,
    selectedSample,
    setSelectedSample,
    setSelectedPointIndex,
    visualizerOptions,
    semanticState,
    featureValues,
    setSemanticState,
    apiEmbeddingCount,
  } = useSample();

  const containerRef = useRef<HTMLDivElement>(null);
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

  const [trajectoryPoints, setTrajectoryPoints] = useState<Array<{ x: number; y: number; z: number }> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(34);
  const [showHelp, setShowHelp] = useState(false);
  const [fps, setFps] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleHelp = () => {
    setShowHelp(!showHelp);
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
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
    scene.background = new THREE.Color('#1a1a1a');
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
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    
    // Set initial camera position
    camera.position.set(73.5, 73.5, 73.5);
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
    
    controls.addEventListener('change', () => {
      // Update zoom level for UI
      if (cameraRef.current) {
        const distance = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
        const maxDistance = 300;
        const minDistance = 1;
        const normalizedDistance = (distance - minDistance) / (maxDistance - minDistance);
        const zoomPercentage = 100 - Math.min(Math.round(normalizedDistance * 100), 95);
        setZoomLevel(zoomPercentage);
      }
    });
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    
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
      
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    
    window.addEventListener('resize', handleResize);
    
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
          
          const distance = cameraRef.current.position.distanceTo(new THREE.Vector3(0, 0, 0));
          const maxDistance = 300;
          const minDistance = 1;
          const normalizedDistance = (distance - minDistance) / (maxDistance - minDistance);
          const zoomPercentage = 100 - Math.min(Math.round(normalizedDistance * 100), 95);
          setZoomLevel(zoomPercentage);
        }
      }
    };
    
    containerRef.current.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('resize', handleResize);
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
    };
  }, []);

  // Update scene background and lighting when dark mode changes
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(isDarkMode ? '#1a1a1a' : visualizerOptions.backgroundColor);
      
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
    (_pointIndex: number, targetValue: number) => {
      if (!selectedSample) return;
      const embeddingIndex = samples4D.findIndex((s) => s.id === selectedSample.id);
      if (embeddingIndex < 0) return;
      const maxIndex = apiEmbeddingCount ?? Infinity;
      if (embeddingIndex >= maxIndex) return;
      const feature = semanticState.selectedFeature ?? 'Fragment Length';
      const center = getCenter();
      const options = {
        centerX: center.x,
        centerY: center.y,
        centerZ: center.z,
        scaleFactor: SCALE_FACTOR,
      };
      const requestSampleId = selectedSample.id;
      projectOnAxis(embeddingIndex, targetValue, feature, options)
        .then((res) => {
          if (selectedSampleIdRef.current !== requestSampleId) return;
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

  const handleClick = (event: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !pointsRef.current) return;
    if (isDragging) return;
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
    }
  };

  return (
    <div className={`${isDarkMode ? 'bg-black' : 'bg-white'} overflow-hidden h-full flex flex-col`}>
      {/* Mobile Warning */}
      <div className={`lg:hidden shrink-0 ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'} border-l-4 px-4 py-3`} role="alert">
        <p className="font-medium text-sm">Desktop recommended for best experience</p>
      </div>

      {/* Toolbar */}
      <div className={`shrink-0 px-6 py-4 border-b ${isDarkMode ? 'bg-black/90 border-white/[0.08]' : 'bg-white border-gray-200'}`}>
        <VisualizerControls type="4d" onSemanticSliderChange={handleSemanticSliderChange} dark={isDarkMode} />
      </div>
      
      <div 
        ref={containerRef} 
        className="flex-1 min-h-0 relative"
        onClick={handleClick}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/50">
            <div className="w-10 h-10 border-2 border-mito-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        
        {/* Floating controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button
            onClick={toggleDarkMode}
            className={`${isDarkMode ? 'bg-amber-500/90 hover:bg-amber-500' : 'bg-white/10 hover:bg-white/15'} text-white p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10`}
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
          </button>
          <button
            onClick={() => {
              if (cameraRef.current) {
                cameraRef.current.position.set(25, 25, 25);
                cameraRef.current.lookAt(new THREE.Vector3(0, 0, 0));
                if (controlsRef.current) {
                  controlsRef.current.target.set(0, 0, 0);
                  controlsRef.current.update();
                }
              }
            }}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Reset view"
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
          <div className={`${isDarkMode ? 'bg-black/70 text-white/80' : 'bg-white/90 text-gray-700'} px-3 py-2 rounded-xl text-xs font-medium border border-white/10 backdrop-blur-sm`}>
            Zoom {zoomLevel}%
          </div>
          <button
            onClick={toggleHelp}
            className="bg-white/10 hover:bg-white/15 text-white/90 p-2.5 rounded-xl w-10 h-10 flex items-center justify-center transition-colors border border-white/10"
            title="Controls"
          >
            <HelpCircle size={18} strokeWidth={2} />
          </button>
        </div>
        
        {/* Status */}
        <div className={`absolute bottom-4 left-4 px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm border border-white/10 ${isDarkMode ? 'bg-black/70 text-white/80' : 'bg-white/90 text-gray-700'}`}>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${fps > 30 ? 'bg-emerald-500' : fps > 15 ? 'bg-amber-500' : 'bg-red-500'}`} />
            {fps} FPS · {pointCount.toLocaleString()} points
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
