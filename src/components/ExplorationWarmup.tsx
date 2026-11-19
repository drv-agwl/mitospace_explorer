import { useEffect, useRef } from 'react';
import { getAxisTrajectory, getFeatureStats, getFeatureValues, healthCheck } from '../api/client';
import { getInitialSemanticAxisFeature } from '../constants/features';
import { useSample } from '../context/SampleContext';

/**
 * After the critical strip is warm, quietly preload API payloads so the
 * semantic axis feels instant. Movies are not warmed here: extra downloads
 * would compete with the condition strip and the selected cell's movie.
 */
export default function ExplorationWarmup() {
  const {
    samples4D,
    datasetVersion,
    setFeatureValues,
    reportApiHealth,
  } = useSample();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!samples4D.length) return;
    started.current = true;

    const run = async () => {
      try {
        reportApiHealth(await healthCheck(datasetVersion));
      } catch {
        // offline / backend down — exploration still works for browsing points
      }

      const feature = getInitialSemanticAxisFeature(datasetVersion);
      if (feature) {
        try {
          const [values] = await Promise.all([
            getFeatureValues(feature, datasetVersion),
            getFeatureStats(feature, datasetVersion),
            getAxisTrajectory(feature, 80, { version: datasetVersion }),
          ]);
          setFeatureValues(feature, values);
        } catch {
          // ignore — VisualizerControls will fetch on demand
        }
      }

      // Warm the About route chunk so navigation is instant
      void import('../components/About');
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        void run();
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        void run();
      }, 500);
    }
  }, [
    samples4D,
    datasetVersion,
    setFeatureValues,
    reportApiHealth,
  ]);

  return null;
}
