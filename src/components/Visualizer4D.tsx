import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useSample } from '../context/SampleContext';
import VisualizerControls from './VisualizerControls';
import { groupSamplesByTime } from '../data/sampleData';
import { getPhenotypeColor } from '../utils/colorUtils';

const Visualizer4D: React.FC = () => {
  const { 
    filteredSamples4D, 
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
  
  const [currentTimepoint] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [timeGroupedSamples, setTimeGroupedSamples] = useState<Record<number, THREE.Points>>({});
  
  const currentSamples = filteredSamples4D.filter(
    sample => sample.t === currentTimepoint
  );

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
    camera.position.z = 25;
    camera.position.y = 25;
    camera.position.x = 25;
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    cameraRef.current = camera;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 10;
    controls.maxDistance = 100;
    controlsRef.current = controls;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);
    
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
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
    
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      if (pointsRef.current && sceneRef.current) {
        sceneRef.current.remove(pointsRef.current);
      }
    };
  }, [visualizerOptions.backgroundColor]);
  
  useEffect(() => {
    if (!sceneRef.current) return;
    
    if (pointsRef.current && sceneRef.current) {
      sceneRef.current.remove(pointsRef.current);
    }
    
    const groupedSamples = groupSamplesByTime(filteredSamples4D);
    const pointsGroups: Record<number, THREE.Points> = {};
    
    const scaleFactor = 4;
    
    Object.entries(groupedSamples).forEach(([timeStr, samples]) => {
      const time = parseInt(timeStr);
      
      const geometry = new THREE.BufferGeometry();
      
      const positions = new Float32Array(samples.length * 3);
      const colors = new Float32Array(samples.length * 3);
      
      samples.forEach((sample, i) => {
        positions[i * 3] = sample.x * scaleFactor;
        positions[i * 3 + 1] = sample.y * scaleFactor;
        positions[i * 3 + 2] = sample.z * scaleFactor;
        
        let color;
        if (visualizerOptions.coloringMode === 'phenotype') {
          color = getPhenotypeColor(sample.phenotype);
        } else {
          color = new THREE.Color(
            sample.color.r,
            sample.color.g,
            sample.color.b
          );
        }
        
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      });
      
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      
      const material = new THREE.PointsMaterial({
        size: visualizerOptions.pointSize,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        alphaTest: 0.5
      });
      
      const points = new THREE.Points(geometry, material);
      points.visible = time === currentTimepoint;
      sceneRef.current?.add(points);
      
      pointsGroups[time] = points;
    });
    
    setTimeGroupedSamples(pointsGroups);
    
    if (pointsGroups[currentTimepoint]) {
      pointsRef.current = pointsGroups[currentTimepoint];
    }
    
  }, [filteredSamples4D, visualizerOptions, currentTimepoint]);
  
  useEffect(() => {
    Object.values(timeGroupedSamples).forEach(points => {
      points.visible = false;
    });
    
    if (timeGroupedSamples[currentTimepoint]) {
      timeGroupedSamples[currentTimepoint].visible = true;
      pointsRef.current = timeGroupedSamples[currentTimepoint];
    }
  }, [currentTimepoint, timeGroupedSamples]);
  
  const handleClick = (event: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !pointsRef.current || !currentSamples) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
    
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    const intersects = raycasterRef.current.intersectObject(pointsRef.current);
    
    if (intersects.length > 0) {
      const index = intersects[0].index;
      if (index !== undefined && index < currentSamples.length) {
        const selectedSample = currentSamples[index];
        setSelectedSample(selectedSample);
      }
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-4 bg-gray-50 border-b">
        <VisualizerControls type="4d" />
      </div>
      
      <div 
        ref={containerRef} 
        className="w-full h-[500px] relative"
        onClick={handleClick}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-75">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Visualizer4D;