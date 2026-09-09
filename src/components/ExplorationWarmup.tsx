import { useEffect, useRef } from 'react';
import { getAxisTrajectory, getFeatureStats, getFeatureValues, healthCheck } from '../api/client';
import { getInitialSemanticAxisFeature } from '../constants/features';
import { useSample } from '../context/SampleContext';
import { warmVideosInBackground } from '../utils/mediaPrefetch';

/**
 * After the critical strip is warm, quietly preload API payloads and a few
 * sample videos so semantic axis / selection feels instant.
 */
export default function ExplorationWarmup() {
  const {
    samples4D,
    datasetVersion,
    selectedSample,
    setFeatureValues,
    setApiEmbeddingCount,
  } = useSample();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!samples4D.length) return;
    started.current = true;

    const run = async () => {
      try {
        const health = await healthCheck(datasetVersion);
        if (typeof health.embedding_count === 'number') {
          setApiEmbeddingCount(health.embedding_count);
        }
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

      // Default / selected sample video(s) for the side panel
      const panelUrls: string[] = [];
      const preferred =
        selectedSample ??
        samples4D.find((s) => s.phenotype === 'control') ??
        samples4D[0];
      if (preferred?.videos?.length) {
        panelUrls.push(...preferred.videos.slice(0, 2));
      }

      // A few extra control / nearby samples so first clicks feel instant
      let extras = 0;
      for (const s of samples4D) {
        if (extras >= 8) break;
        const url = s.videos?.[0];
        if (!url || panelUrls.includes(url)) continue;
        if (s.phenotype === 'control' || extras < 4) {
          panelUrls.push(url);
          extras++;
        }
      }

      warmVideosInBackground(panelUrls, { concurrency: 3 });

      // Warm the About route chunk so navigation is instant
      void import('../components/About');
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        void run();
      }, { timeout: 2000 });
    } else {
      window.setTimeout(() => {
        void run();
      }, 500);
    }
  }, [
    samples4D,
    datasetVersion,
    selectedSample,
    setFeatureValues,
    setApiEmbeddingCount,
  ]);

  return null;
}
