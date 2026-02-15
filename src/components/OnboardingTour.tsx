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
    title: '👋 Welcome to MitoSpace Explorer',
    content: 'This interactive platform lets you explore mitochondrial morphology and how it responds to drug treatments. Let\'s take a quick tour!',
    disableBeacon: true,
    placement: 'center',
  },
  {
    target: '[data-tour="landing-title"]',
    title: '🔬 Choose Your View',
    content: 'Select between 4D or 2D MitoSpace. Each offers a unique perspective on mitochondrial phenotypes from microscopy data.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="card-4d"]',
    title: '✨ 4D MitoSpace',
    content: 'AI-powered embedding from LLSM time-lapse movies. Explore drug clusters, phenotypic overlays, and semantic axis navigation—our most powerful feature.',
    disableBeacon: true,
    placement: 'top',
  },
  {
    target: '[data-tour="card-2d"]',
    title: '📊 2D MitoSpace',
    content: 'Confocal microscopy embedding with traditional visualization. Click either card to start exploring!',
    disableBeacon: true,
    placement: 'top',
  },
];

const EXPLORER_STEPS: Step[] = [
  {
    target: '[data-tour="header-tabs"]',
    title: '🔄 Switch Views',
    content: 'Use these tabs to switch between 4D and 2D MitoSpace visualizations.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="controls-toolbar"]',
    title: '🎛️ Basic Controls',
    content: 'Adjust point size for better visibility, filter cells by drug treatment condition, and change color coding between drug and phenotype modes.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="semantic-axis-toggle"]',
    title: '✨ Semantic Axis - Our Key Feature',
    content: 'Enable this to explore how mitochondrial features like motility, length, and membrane potential vary across the space. This is what makes MitoSpace unique!',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: '[data-tour="visualizer-canvas"]',
    title: '🎮 Interactive 3D Visualization',
    content: 'Drag to rotate the view, scroll to zoom in/out, and click any point to view that cell\'s details. Use the floating buttons on the right for quick controls.',
    disableBeacon: true,
    placement: 'left',
  },
  {
    target: '[data-tour="semantic-axis-toggle"]',
    title: '🎯 How to Use Semantic Axis',
    content: 'Enable the toggle, then select a feature (Motility, Segment Length, or Membrane Potential). A slider will appear instantly—drag it to explore how cells change along that feature axis. A golden trajectory shows the learned path through the space.',
    disableBeacon: true,
    placement: 'bottom',
  },
  {
    target: 'body',
    title: '💡 Pro Tips',
    content: 'Click "Visualize samples along axis" to see representative cells from low to high feature values—perfect for comparing phenotypes. Use the "Render" button to jump to a specific cell at any slider position.',
    disableBeacon: true,
    placement: 'center',
  },
  {
    target: '[data-tour="sample-panel"]',
    title: '📋 Sample Details Panel',
    content: 'When you select a point, this panel shows 4D cell movies, treatment conditions, phenotype classifications, and detailed metadata. Play videos to see mitochondrial dynamics!',
    disableBeacon: true,
    placement: 'left',
  },
  {
    target: 'body',
    title: '🎉 You\'re Ready to Explore!',
    content: 'Start by enabling Semantic axis, select a feature, and drag the slider to discover patterns. Press F for fullscreen, R to reset view, or ? for keyboard shortcuts. You can restart this tour anytime from the menu.',
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
        if (action === ACTIONS.NEXT) {
          // Move to next step
          if (index === steps.length - 1) {
            // Completed the tour
            if (variant === 'explorer') setOnboardingCompleted();
            setStepIndex(0); // Reset for next time
            onComplete?.();
          } else {
            setStepIndex(index + 1);
          }
        } else if (action === ACTIONS.PREV) {
          // Only go back if explicitly clicking Back button
          setStepIndex(index - 1);
        }
        // Don't change step for CLOSE or other actions
      } else if (type === EVENTS.TOUR_END) {
        // Tour ended (via close/skip/complete)
        if (status === 'finished' || status === 'skipped') {
          if (variant === 'explorer') setOnboardingCompleted();
        }
        setStepIndex(0); // Reset for next time
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
      spotlightClicks={false}
      disableOverlayClose={true}
      disableScrolling={true}
      disableScrollParentFix={true}
      hideCloseButton={false}
      spotlightPadding={0}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish Tour',
        next: 'Next',
        skip: 'Skip Tour',
      }}
      floaterProps={{
        disableAnimation: false,
        styles: {
          arrow: {
            length: 8,
            spread: 16,
          },
        },
      }}
      styles={{
        options: {
          primaryColor: '#3b82f6',
          textColor: '#e5e5e5',
          backgroundColor: '#0f0f0f',
          overlayColor: 'rgba(0, 0, 0, 0.85)',
          arrowColor: '#0f0f0f',
          zIndex: 10000,
          width: 400,
        },
        overlay: {
          transition: 'opacity 0.3s ease-in-out',
        },
        spotlight: {
          borderRadius: 8,
          transition: 'all 0.3s ease-in-out',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.85), 0 0 24px 8px rgba(59, 130, 246, 0.4)',
        },
        tooltip: {
          borderRadius: 16,
          padding: 24,
          fontSize: 15,
          lineHeight: 1.6,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
          transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        tooltipTitle: {
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 8,
        },
        tooltipContent: {
          padding: '8px 0',
        },
        buttonNext: {
          backgroundColor: '#3b82f6',
          color: '#ffffff',
          borderRadius: 8,
          padding: '10px 20px',
          fontSize: 14,
          fontWeight: 600,
          transition: 'all 0.2s ease',
        },
        buttonBack: {
          color: '#93c5fd',
          marginRight: 12,
          fontSize: 14,
          transition: 'all 0.2s ease',
        },
        buttonSkip: {
          color: '#94a3b8',
          fontSize: 14,
          transition: 'all 0.2s ease',
        },
        buttonClose: {
          color: '#94a3b8',
          fontSize: 24,
          padding: 8,
          right: 8,
          top: 8,
          transition: 'all 0.2s ease',
        },
      }}
    />
  );
};
