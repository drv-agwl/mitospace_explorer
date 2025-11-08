import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';

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
  const [isDarkMode, setIsDarkMode] = useState(false);

  const toggleHelp = () => {
    setShowHelp(!showHelp);
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Helper function to clamp color values
  const clampColor = (color: THREE.Color) => {
    color.r = Math.max(0, Math.min(1, color.r));
    color.g = Math.max(0, Math.min(1, color.g));
    color.b = Math.max(0, Math.min(1, color.b));
    return color;
  };

  // Add this function to create a highlight mesh
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
      // Brighter gradient for dark mode
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.95)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
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
      let color;
      if (visualizerOptions.coloringMode === 'phenotype') {
        color = new THREE.Color(
          sample.color_phenotypic?.r ?? 0,
          sample.color_phenotypic?.g ?? 0,
          sample.color_phenotypic?.b ?? 0
        );
      } else {
        color = new THREE.Color(
          sample.color?.r ?? 0,
          sample.color?.g ?? 0,
          sample.color?.b ?? 0
        );
      }
      
      // Enhance colors for dark mode
      if (isDarkMode) {
        color.multiplyScalar(1.5);
        clampColor(color);
      }
      
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

      let color;
      if (visualizerOptions.coloringMode === 'phenotype') {
        color = new THREE.Color(
          selectedSample.color_phenotypic?.r ?? 0,
          selectedSample.color_phenotypic?.g ?? 0,
          selectedSample.color_phenotypic?.b ?? 0
        );
      } else {
        color = new THREE.Color(
          selectedSample.color?.r ?? 0,
          selectedSample.color?.g ?? 0,
          selectedSample.color?.b ?? 0
        );
      }
      
      if (isDarkMode) {
        color.multiplyScalar(1.5);
        clampColor(color);
      }
      
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

        let color;
        if (visualizerOptions.coloringMode === 'phenotype') {
          color = new THREE.Color(
            selectedSample.color_phenotypic?.r ?? 0,
            selectedSample.color_phenotypic?.g ?? 0,
            selectedSample.color_phenotypic?.b ?? 0
          );
        } else {
          color = new THREE.Color(
            selectedSample.color?.r ?? 0,
            selectedSample.color?.g ?? 0,
            selectedSample.color?.b ?? 0
          );
        }
        
        if (isDarkMode) {
          color.multiplyScalar(1.5);
          clampColor(color);
        }
        
        createHighlightMesh(position, color);
      }
    }
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-900' : 'bg-white'} shadow-md overflow-hidden h-full border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
      {/* Mobile Warning Message */}
      <div className={`lg:hidden ${isDarkMode ? 'bg-yellow-900 border-yellow-600 text-yellow-200' : 'bg-yellow-100 border-yellow-500 text-yellow-700'} border-l-4 p-4 sticky top-0 z-50`} role="alert">
        <p className="font-bold text-base">Desktop Recommended</p>
        <p className="text-sm">For the best experience, please view this visualization on a desktop device.</p>
      </div>

      <div className={`p-3 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-b`}>
        <VisualizerControls type="2d" />
      </div>
      
      <div 
        ref={containerRef} 
        className="w-full h-[calc(100vh-120px)] relative"
        onClick={handleClick}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        )}
        
        {/* Zoom Controls */}
        <div className="absolute top-4 right-4 flex flex-col space-y-2 group">
          {/* Dark Mode Toggle */}
          <button 
            onClick={toggleDarkMode}
            className={`${isDarkMode ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-600 hover:bg-gray-700'} text-white p-3 rounded-lg shadow-lg w-12 h-12 flex items-center justify-center transition-all border-2 ${isDarkMode ? 'border-yellow-400' : 'border-gray-400'}`}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
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
            className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-lg w-10 h-10 flex items-center justify-center transition-all"
            title="Reset Camera"
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
            className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-lg w-10 h-10 flex items-center justify-center transition-all"
            title="Zoom In"
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
            className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-lg w-10 h-10 flex items-center justify-center transition-all"
            title="Zoom Out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          
          <div className={`${isDarkMode ? 'bg-gray-800 bg-opacity-90 text-gray-200' : 'bg-white bg-opacity-80 text-gray-700'} p-2 rounded-lg shadow-lg text-center text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
            <span>Zoom: {zoomLevel}%</span>
          </div>
          
          <button 
            onClick={toggleHelp}
            className="bg-gray-600 hover:bg-gray-700 text-white p-2 rounded-lg shadow-lg w-10 h-10 flex items-center justify-center transition-all"
            title="Navigation Help"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </button>
        </div>
        
        {/* Status Panel */}
        <div className={`absolute bottom-4 left-4 ${isDarkMode ? 'bg-gray-800 bg-opacity-90 text-gray-200 border-gray-600' : 'bg-white bg-opacity-90 text-gray-800 border-gray-300'} text-xs p-2 border rounded shadow`}>
          <div className="flex items-center space-x-2">
            <div className={`h-2 w-2 rounded-full ${fps > 30 ? 'bg-green-500' : fps > 15 ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
            <span>{fps} FPS</span>
          </div>
          
          <div className="mt-1">
            {pointCount.toLocaleString()} points
          </div>
        </div>
        
        {/* Help Overlay */}
        {showHelp && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4" onClick={toggleHelp}>
            <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-800'} p-4 md:p-6 rounded-xl shadow-2xl w-full max-w-md`} onClick={e => e.stopPropagation()}>
              <h3 className="text-lg md:text-xl font-bold text-white mb-4">Navigation Controls</h3>
              
              <div className="text-gray-300 space-y-3">
                <div className="flex items-start">
                  <div className="w-24 font-medium">Left Mouse</div>
                  <div>Rotate the view</div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-24 font-medium">Middle Mouse</div>
                  <div>Pan the view</div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-24 font-medium">Wheel/Pinch</div>
                  <div>Zoom in/out (use two fingers on trackpad)</div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-24 font-medium">Click</div>
                  <div>Select a point</div>
                </div>
                
                <div className="flex items-start">
                  <div className="w-24 font-medium">Home Button</div>
                  <div>Reset camera to home position</div>
                </div>
              </div>
              
              <button 
                className="mt-6 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded transition-colors w-full"
                onClick={toggleHelp}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Visualizer2D;
