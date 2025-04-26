import * as THREE from 'three';

export const getPhenotypeColor = (phenotype: string): THREE.Color => {
  switch (phenotype) {
    case 'Normal':
      return new THREE.Color(0x3b82f6); // blue
    case 'Fragmented':
      return new THREE.Color(0xef4444); // red
    case 'Swollen':
      return new THREE.Color(0xf59e0b); // amber
    case 'Perinuclear':
      return new THREE.Color(0x10b981); // emerald
    case 'Hyperfused':
      return new THREE.Color(0x8b5cf6); // violet
    default:
      return new THREE.Color(0x6b7280); // gray
  }
};