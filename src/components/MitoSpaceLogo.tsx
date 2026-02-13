import React from 'react';

interface MitoSpaceLogoProps {
  /** Size in pixels */
  size?: number;
  /** Use for dark backgrounds (e.g. header logo box is white) */
  variant?: 'light' | 'dark';
  className?: string;
}

/**
 * MitoSpace Explorer logo: minimal neural network motif.
 * Professional, AI-themed icon for mitochondrial phenotype visualization.
 */
const MitoSpaceLogo: React.FC<MitoSpaceLogoProps> = ({ size = 24, variant = 'dark', className = '' }) => {
  const stroke = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.7)';
  const fill = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.7)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* Neural network: input (3) -> hidden (3) -> output (2) */}
      <circle cx="6" cy="6" r="1.6" fill={fill} />
      <circle cx="16" cy="6" r="1.6" fill={fill} />
      <circle cx="26" cy="6" r="1.6" fill={fill} />
      <circle cx="8" cy="16" r="1.4" fill={fill} />
      <circle cx="16" cy="16" r="1.4" fill={fill} />
      <circle cx="24" cy="16" r="1.4" fill={fill} />
      <circle cx="11" cy="26" r="1.5" fill={fill} />
      <circle cx="21" cy="26" r="1.5" fill={fill} />
      {/* Vertical connections */}
      <path d="M6 7.6v5.8M16 7.6v5.8M26 7.6v5.8" stroke={stroke} strokeWidth="0.7" strokeLinecap="round" />
      <path d="M8 17.4v6.1M16 17.4v6.1M24 17.4v6.1" stroke={stroke} strokeWidth="0.7" strokeLinecap="round" />
      {/* Diagonal connections between layers */}
      <path d="M6 6l6 8M16 6l0 8M26 6l-6 8M8 16l5 8M16 16l0 8M24 16l-5 8" stroke={stroke} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
};

export default MitoSpaceLogo;
