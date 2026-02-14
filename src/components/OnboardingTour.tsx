import React, { useCallback, useEffect, useState } from 'react';
import Joyride, { CallBackProps, Step, ACTIONS, EVENTS } from 'react-joyride';

const STORAGE_KEY = 'mitospace_onboarding_completed';

export function hasCompletedOnboarding(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetOnboarding(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function setOnboardingCompleted(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, 'true');
}

const LANDING_STEPS: Step[] = [
  {
    target: 'body',
    content: 'Welcome to MitoSpace Explorer! This interactive platform lets you explore mitochondrial morphology and its response to drug treatments. Let\'s take a quick tour.',
    disableBeacon: true,
    placement: 'center',
  },
  {
    target: '[data-tour="landing-title"]',
    content: 'Choose between 4D or 2D MitoSpace. Each offers a different view of mitochondrial phenotypes from microscopy data.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="card-4d"]',
    content: '4D MitoSpace: AI-powered embedding from LLSM time-lapse movies. Explore drug clusters, phenotypic overlays, and semantic axis navigation.',
    disableBeacon: true,
    placement: 'top',
  },
  {
    target: '[data-tour="card-2d"]',
    content: '2D MitoSpace: Confocal microscopy embedding. Click either card to start exploring.',
    disableBeacon: true,
    placement: 'top',
  },
];

const EXPLORER_STEPS: Step[] = [
  {
    target: '[data-tour="header-tabs"]',
    content: 'Switch between 4D and 2D MitoSpace using these tabs.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="controls-toolbar"]',
    content: 'Use these controls: adjust point size, filter by condition, and change color mode (drug or phenotype).',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="semantic-axis-toggle"]',
    content: 'Enable Semantic axis—our most important feature. It lets you explore how mitochondrial properties vary across the embedding space.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="controls-toolbar"]',
    content: 'After enabling Semantic axis: select a feature (Motility, Segment Length, or Membrane Potential), then click any point in the 3D view. A slider will appear—drag it to see where cells with different values would lie. A golden sphere traces the learned axis through the cloud.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="visualizer-canvas"]',
    content: '3D visualization: Drag to rotate, scroll to zoom, click points to select. After enabling Semantic axis and selecting a feature, click a point to activate the axis slider. Press F for fullscreen, R to reset view, ? for help.',
    disableBeacon: true,
    placement: 'right',
  },
  {
    target: 'body',
    content: "Semantic axis tips: Use 'Visualize samples along axis' to see example cells spread from low to high values—great for comparing phenotypes. Use Render to display the sample closest to the current feature value.",
    disableBeacon: true,
    placement: 'center',
  },
  {
    target: '[data-tour="sample-panel"]',
    content: 'Sample panel: View details, videos, treatment data, and metadata for selected samples.',
    disableBeacon: true,
    placement: 'left',
  },
  {
    target: 'body',
    content: 'You\'re all set! Enable Semantic axis, click a point, and drag the slider to explore. You can restart this tour anytime from the Take tour button.',
    disableBeacon: true,
    placement: 'center',
  },
];

interface OnboardingTourProps {
  run: boolean;
  variant: 'landing' | 'explorer';
  onComplete?: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ run, variant, onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = variant === 'landing' ? LANDING_STEPS : EXPLORER_STEPS;

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type } = data;

      if (type === EVENTS.STEP_AFTER) {
        if (action === ACTIONS.NEXT && index === steps.length - 1) {
          if (variant === 'explorer') setOnboardingCompleted();
          onComplete?.();
        }
        setStepIndex(index + (action === ACTIONS.NEXT ? 1 : -1));
      } else if (type === EVENTS.TOUR_END || status === 'skipped') {
        if (variant === 'explorer') setOnboardingCompleted();
        onComplete?.();
      }
    },
    [steps.length, variant, onComplete]
  );

  useEffect(() => {
    if (run) setStepIndex(0);
  }, [run, variant]);

  if (!run) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      callback={handleCallback}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Done',
        next: 'Next',
        skip: 'Skip tour',
      }}
      styles={{
        options: {
          primaryColor: '#3b82f6',
          textColor: '#e5e5e5',
          backgroundColor: '#0a0a0a',
          overlayColor: 'rgba(0, 0, 0, 0.75)',
          arrowColor: '#0a0a0a',
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 12,
          padding: 20,
          fontSize: 14,
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonNext: {
          backgroundColor: '#3b82f6',
          color: '#ffffff',
        },
        buttonBack: {
          color: '#93c5fd',
        },
        buttonSkip: {
          color: '#94a3b8',
        },
      }}
    />
  );
};
