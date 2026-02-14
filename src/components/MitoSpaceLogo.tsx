import React from 'react';

interface MitoSpaceLogoProps {
  /** Size in pixels */
  size?: number;
  /** Use for dark backgrounds (e.g. header logo box is white) */
  variant?: 'light' | 'dark';
  className?: string;
}

/**
 * MitoSpace Explorer logo: neural network motif forming an "M".
 * Mitochondria silhouette in background; input → hidden → output layers.
 */
const MitoSpaceLogo: React.FC<MitoSpaceLogoProps> = ({ size = 24, variant = 'dark', className = '' }) => {
  const stroke = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.85)';
  const node = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.96)';
  const nodeSecondary = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.9)';
  const mito = variant === 'dark' ? 'currentColor' : 'rgba(255,255,255,0.15)';

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
      {/* Mitochondria silhouette — translucent, behind M */}
      <ellipse cx="16" cy="16" rx="9" ry="5.5" stroke={mito} strokeWidth="0.35" fill="none" opacity="0.85" />
      <path d="M 13 14.5 Q 16 16 13 17.5 M 16 13 Q 19 16 16 19 M 19 14.5 Q 22 16 19 17.5" stroke={mito} strokeWidth="0.25" fill="none" opacity="0.6" />
      {/* M structure — thicker legs, V slightly lighter */}
      <path d="M 6 6 L 6 16 L 6 26 M 26 6 L 26 16 L 26 26" stroke={stroke} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 6 6 L 11 12.5 L 16 19 L 21 12.5 L 26 6" stroke={stroke} strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
      {/* Primary nodes */}
      <circle cx="6" cy="6" r="1.25" fill={node} />
      <circle cx="26" cy="6" r="1.25" fill={node} />
      <circle cx="16" cy="19" r="1.35" fill={node} />
      <circle cx="6" cy="26" r="1.1" fill={node} />
      <circle cx="26" cy="26" r="1.1" fill={node} />
      {/* Hidden layer nodes */}
      <circle cx="6" cy="16" r="1" fill={nodeSecondary} opacity="0.9" />
      <circle cx="26" cy="16" r="1" fill={nodeSecondary} opacity="0.9" />
      <circle cx="11" cy="12.5" r="0.95" fill={nodeSecondary} opacity="0.88" />
      <circle cx="21" cy="12.5" r="0.95" fill={nodeSecondary} opacity="0.88" />
    </svg>
  );
};

export default MitoSpaceLogo;
