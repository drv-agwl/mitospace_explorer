import React from 'react';

import { useSample } from '../context/SampleContext';
import { getFeatureDisplayLabel } from '../constants/features';
import { plasmaGradientCss } from '../utils/featureColor';
import { formatFeatureValue } from '../utils/formatFeature';
import { estimatePlasmaParams } from '../utils/featureColorParams';

interface FeatureColorBarProps {
  visible: boolean;
}

/**
 * Bottom-left legend that explains the cloud's plasma gradient.
 *
 * It uses the exact same `plasmaGradientCss` that drives `featureToColorPlasmaAdaptive`,
 * so the bar visually matches every cloud point and the trajectory tube. The
 * marker tracks the semantic-axis slider so users can read off the current
 * value position on the gradient.
 */
const FeatureColorBar: React.FC<FeatureColorBarProps> = ({ visible }) => {
  const { semanticState, coloringFeature, datasetVersion, featureValues } = useSample();

  const plasmaParams = React.useMemo(() => {
    const fname = coloringFeature;
    if (!fname) return { gamma: undefined, contrast: undefined } as const;
    const fv = featureValues[fname];
    if (!fv) return { gamma: undefined, contrast: undefined } as const;
    const p = estimatePlasmaParams(fv);
    return { gamma: p.gamma, contrast: p.contrast } as const;
  }, [coloringFeature, featureValues]);

  const gradientCss = React.useMemo(
    () => plasmaGradientCss(11, plasmaParams.gamma, plasmaParams.contrast),
    [plasmaParams.gamma, plasmaParams.contrast]
  );

  if (!visible) return null;

  const featureLabel = getFeatureDisplayLabel(coloringFeature, datasetVersion);
  const range = semanticState.featureRange;
  const sliderValue = typeof semanticState.semanticSliderValue === 'number'
    ? semanticState.semanticSliderValue
    : null;

  let markerPercent: number | null = null;
  if (range && sliderValue != null && Number.isFinite(sliderValue)) {
    const span = range.max - range.min;
    if (span > 0) {
      const t = (sliderValue - range.min) / span;
      markerPercent = Math.max(0, Math.min(1, t)) * 100;
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/70 backdrop-blur-sm overflow-hidden px-4 py-2.5 min-w-[240px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-white/85 tracking-wide truncate">
            {featureLabel || 'Feature value'}
          </span>
          {sliderValue != null && (
            <span className="text-[11px] tabular-nums text-white/70 shrink-0">
              {formatFeatureValue(sliderValue)}
            </span>
          )}
        </div>
        <div className="relative h-3 rounded border border-white/20" style={{ background: gradientCss }}>
          {markerPercent != null && (
            <div
              className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)] pointer-events-none"
              style={{ left: `${markerPercent}%`, transform: 'translateX(-50%)' }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] tabular-nums text-white/55">
          <span>{range ? formatFeatureValue(range.min) : 'Low'}</span>
          <span>{range ? formatFeatureValue(range.max) : 'High'}</span>
        </div>
      </div>
    </div>
  );
};

export default FeatureColorBar;
