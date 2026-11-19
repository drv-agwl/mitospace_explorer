import * as THREE from 'three';

/**
 * Pass-through for dark theme - returns colors unchanged for best distinguishability.
 */
export function adaptColorForDarkTheme(r: number, g: number, b: number): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.min(1, r)),
    g: Math.max(0, Math.min(1, g)),
    b: Math.max(0, Math.min(1, b)),
  };
}

/** CSS color for a 0..1 RGB triple (a cell's condition color). */
export function rgbCss({ r, g, b }: { r?: number; g?: number; b?: number }): string {
  const to255 = (v?: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

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