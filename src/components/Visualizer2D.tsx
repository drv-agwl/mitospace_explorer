import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import { adaptColorForDarkTheme } from '../utils/colorUtils';

const Visualizer2D: React.FC = () => {
  const { 
    filteredSamples2D, 
    selectedSample, 
    setSelectedSample,
    visualizerOptions 
  } = useSample();
  
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  
  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(46);
  const [fps, setFps] = useState(0);
  const [pointCount, setPointCount] = useState(0);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [selectedPointMesh, setSelectedPointMesh] = useState<THREE.Mesh | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleHelp = () => {
    setShowHelp(!showHelp);
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Create highlight mesh for selected point
  const createHighlightMesh = (position: THREE.Vector3, color: THREE.Color) => {
    if (!sceneRef.current) return null;
    
    // Remove previous highlight if it exists
    if (selectedPointMesh && sceneRef.current) {
      sceneRef.current.remove(selectedPointMesh);
    }
    
    // Create a larger sphere for the highlight
    const geometry = new THREE.SphereGeometry(1.0, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      wireframe: true,
      wireframeLinewidth: 2
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    sceneRef.current.add(mesh);
    setSelectedPointMesh(mesh);
    
    return mesh;
  };

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

  // Initialize scene and renderer - ONLY run once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(visualizerOptions.backgroundColor);
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
    
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
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

  // Update visualization when samples or options change
  useEffect(() => {
    if (!sceneRef.current) return;
    
    if (!filteredSamples2D || !Array.isArray(filteredSamples2D) || filteredSamples2D.length === 0) return;
    
    setPointCount(filteredSamples2D.length);
    
    // Remove previous visualizations
    if (pointsRef.current && sceneRef.current) {
      sceneRef.current.remove(pointsRef.current);
      pointsRef.current = null;
    }
    
    const scaleFactor = 4;
    
    // Calculate center of the point cloud
    const center = new THREE.Vector3();
    filteredSamples2D.forEach(sample => {
      center.add(new THREE.Vector3(sample.x, sample.y, sample.z));
    });
    center.divideScalar(filteredSamples2D.length);
    
    // Always use points for rendering
    const geometry = new THREE.BufferGeometry();
    
    const positions = new Float32Array(filteredSamples2D.length * 3);
    const colors = new Float32Array(filteredSamples2D.length * 3);
    const sizes = new Float32Array(filteredSamples2D.length);
    
    filteredSamples2D.forEach((sample, i) => {
      // Position relative to center
      positions[i * 3] = (sample.x - center.x) * scaleFactor;
      positions[i * 3 + 1] = (sample.y - center.y) * scaleFactor;
      positions[i * 3 + 2] = (sample.z - center.z) * scaleFactor;
      
      // Use color based on the selected coloring mode
      const cr = visualizerOptions.coloringMode === 'phenotype'
        ? (sample.color_phenotypic?.r ?? 0)
        : (sample.color?.r ?? 0);
      const cg = visualizerOptions.coloringMode === 'phenotype'
        ? (sample.color_phenotypic?.g ?? 0)
        : (sample.color?.g ?? 0);
      const cb = visualizerOptions.coloringMode === 'phenotype'
        ? (sample.color_phenotypic?.b ?? 0)
        : (sample.color?.b ?? 0);
      const color = isDarkMode
        ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
        : new THREE.Color(cr, cg, cb);
      
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      sizes[i] = visualizerOptions.pointSize;
    });
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: visualizerOptions.pointSize,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: isDarkMode ? 1.0 : 0.9,
      alphaTest: 0.5,
      map: generatePointTexture(isDarkMode)
    });
    
    const points = new THREE.Points(geometry, material);
    sceneRef.current.add(points);
    pointsRef.current = points;
    
    // Update highlight position if there's a selected point
    if (selectedSample) {
      const position = new THREE.Vector3(
        (selectedSample.x - center.x) * scaleFactor,
        (selectedSample.y - center.y) * scaleFactor,
        (selectedSample.z - center.z) * scaleFactor
      );

      const cr = visualizerOptions.coloringMode === 'phenotype'
        ? (selectedSample.color_phenotypic?.r ?? 0)
        : (selectedSample.color?.r ?? 0);
      const cg = visualizerOptions.coloringMode === 'phenotype'
        ? (selectedSample.color_phenotypic?.g ?? 0)
        : (selectedSample.color?.g ?? 0);
      const cb = visualizerOptions.coloringMode === 'phenotype'
        ? (selectedSample.color_phenotypic?.b ?? 0)
        : (selectedSample.color?.b ?? 0);
      const color = isDarkMode
        ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
        : new THREE.Color(cr, cg, cb);
      createHighlightMesh(position, color);
    }
    
  }, [filteredSamples2D, visualizerOptions, selectedSample, isDarkMode]);

  // Set default selected sample with "control" when the component mounts
  useEffect(() => {
    if (filteredSamples2D.length > 0 && !selectedSample) {
      const defaultSample = filteredSamples2D.find(sample => sample.phenotype === 'control');
      if (defaultSample) {
        setSelectedSample(defaultSample);
      }
    }
  }, [filteredSamples2D]);

  // Handle point selection with raycaster
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
      if (typeof index === 'number' && index < filteredSamples2D.length) {
        setLastSelectedIndex(index);
        const selectedSample = filteredSamples2D[index];
        setSelectedSample(selectedSample);

        const center = new THREE.Vector3();
        filteredSamples2D.forEach(sample => {
          center.add(new THREE.Vector3(sample.x, sample.y, sample.z));
        });
        center.divideScalar(filteredSamples2D.length);
        
        const position = new THREE.Vector3(
          (selectedSample.x - center.x) * 4,
          (selectedSample.y - center.y) * 4,
          (selectedSample.z - center.z) * 4
        );

        const cr = visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.r ?? 0)
          : (selectedSample.color?.r ?? 0);
        const cg = visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.g ?? 0)
          : (selectedSample.color?.g ?? 0);
        const cb = visualizerOptions.coloringMode === 'phenotype'
          ? (selectedSample.color_phenotypic?.b ?? 0)
          : (selectedSample.color?.b ?? 0);
        const color = isDarkMode
          ? new THREE.Color(...Object.values(adaptColorForDarkTheme(cr, cg, cb)))
          : new THREE.Color(cr, cg, cb);
        createHighlightMesh(position, color);
      }
    }
  };

  return (
    <div className={`${isDarkMode ? 'bg-black' : 'bg-white'} overflow-hidden h-full flex flex-col`}>
      <div className={`lg:hidden shrink-0 ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'} border-l-4 px-4 py-3`} role="alert">
        <p className="font-medium text-sm">Desktop recommended for best experience</p>
      </div>

      <div className={`shrink-0 px-6 py-4 border-b ${isDarkMode ? 'bg-black/80 border-white/10' : 'bg-white border-gray-200'}`}>
        <VisualizerControls type="2d" dark={isDarkMode} />
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
        
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button 
            onClick={toggleDarkMode}
            className={`${isDarkMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-ink-700 hover:bg-ink-800'} text-white p-2.5 rounded-xl shadow-elevated w-11 h-11 flex items-center justify-center transition-colors`}
            title={isDarkMode ? 'Light mode' : 'Dark mode'}
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
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
            className="bg-white/90 hover:bg-white text-ink-800 p-2.5 rounded-xl shadow-elevated w-11 h-11 flex items-center justify-center transition-colors backdrop-blur-sm"
            title="Reset view"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
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
            className="bg-white/90 hover:bg-white text-ink-800 p-2.5 rounded-xl shadow-elevated w-11 h-11 flex items-center justify-center transition-colors backdrop-blur-sm"
            title="Zoom in"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
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
            className="bg-white/90 hover:bg-white text-ink-800 p-2.5 rounded-xl shadow-elevated w-11 h-11 flex items-center justify-center transition-colors backdrop-blur-sm"
            title="Zoom out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          
          <div className={`${isDarkMode ? 'bg-black/80 text-white/90' : 'bg-white/90 text-gray-700'} px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm`}>
            Zoom {zoomLevel}%
          </div>
          
          <button 
            onClick={toggleHelp}
            className="bg-white/90 hover:bg-white text-ink-800 p-2.5 rounded-xl shadow-elevated w-11 h-11 flex items-center justify-center transition-colors backdrop-blur-sm"
            title="Controls"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </button>
        </div>
        
        <div className={`absolute bottom-4 left-4 px-3 py-2 rounded-xl text-xs font-medium backdrop-blur-sm ${isDarkMode ? 'bg-black/80 text-white/90' : 'bg-white/90 text-gray-700'} shadow-elevated`}>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${fps > 30 ? 'bg-emerald-500' : fps > 15 ? 'bg-amber-500' : 'bg-red-500'}`} />
            {fps} FPS · {pointCount.toLocaleString()} points
          </div>
        </div>
        
        {showHelp && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={toggleHelp}>
            <div className="bg-white rounded-2xl shadow-elevated p-6 w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Controls</h3>
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex justify-between"><span className="font-medium text-gray-600">Left drag</span> Rotate</div>
                <div className="flex justify-between"><span className="font-medium text-gray-600">Middle / Right drag</span> Pan</div>
                <div className="flex justify-between"><span className="font-medium text-gray-600">Scroll / Pinch</span> Zoom</div>
                <div className="flex justify-between"><span className="font-medium text-gray-600">Click</span> Select point</div>
              </div>
              <button className="btn-primary mt-6 w-full" onClick={toggleHelp}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Visualizer2D;
