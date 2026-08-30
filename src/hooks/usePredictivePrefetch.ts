import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { warmupImageDecoder } from '../utils/imageCompressor';
import { AppEngineMode } from '../types/dental';

// Track prefetched modules by name to allow switching modes without missing prefetches
const prefetchedModules = new Set<string>();

/**
 * Proactively prefetches and warms up Step 3 (UploadScreen), Step 4 (AI Analysis),
 * base64 image decoding engines, Web Workers, and AI diagnostic chunks in the background.
 * Call this as soon as the user enters the Configuration screen (Step 2).
 */
export async function prefetchStep2AIModules(mode: AppEngineMode = 'classic'): Promise<void> {
  try {
    // 1. Proactively warm up and initialize the base64 image decoding engine
    if (!prefetchedModules.has('imageDecoder')) {
      prefetchedModules.add('imageDecoder');
      warmupImageDecoder().catch((err) => {
        console.debug('[PredictivePrefetch] Background image decoder warmup notice:', err);
      });
    }

    // 2. Prefetch Lazy Route Chunks relevant to current mode (never prefetch admin portal early)
    if (!prefetchedModules.has('UploadScreen')) {
      prefetchedModules.add('UploadScreen');
      import('../components/UploadScreen').catch(() => {});
    }

    if (mode === 'pathology_segmentation') {
      if (!prefetchedModules.has('pathology_flow')) {
        prefetchedModules.add('pathology_flow');
        await Promise.allSettled([
          import('../components/PathologyAnalysisScreen'),
          import('../components/TreatmentRecommendationScreen'),
        ]);
      }
    } else {
      if (!prefetchedModules.has('classic_flow')) {
        prefetchedModules.add('classic_flow');
        await Promise.allSettled([
          import('../components/AIAnalysisScreen'),
          import('../components/ValidationScreen'),
        ]);
      }
    }
  } catch (err) {
    // Silently handle any prefetch errors; runtime imports will fetch normally if needed
    console.debug('[PredictivePrefetch] Non-blocking prefetch info:', err);
  }
}

export function usePredictivePrefetch() {
  const currentStep = useAppStore((state) => state.currentStep);
  const appEngineMode = useAppStore((state) => state.appEngineMode);

  useEffect(() => {
    // Advanced Predictive Prefetching Strategy:
    // Anticipates the user's workflow to load assets & JS chunks before they are needed.
    const prefetchNextStep = async () => {
      try {
        switch (currentStep) {
          case 1:
            // Being on Welcome, user will go to Config next
            if (!prefetchedModules.has('ConfigurationScreen')) {
              prefetchedModules.add('ConfigurationScreen');
              await import('../components/ConfigurationScreen');
            }
            break;

          case 2:
            // Being on Config (Step 2), immediately run mode-aware prefetch and base64 engine warmup
            await prefetchStep2AIModules(appEngineMode);
            break;

          case 3:
            // Being on Upload, user will trigger analysis next
            if (appEngineMode === 'pathology_segmentation') {
              if (!prefetchedModules.has('pathology_flow')) {
                prefetchedModules.add('pathology_flow');
                await Promise.allSettled([
                  import('../components/PathologyAnalysisScreen'),
                  import('../components/TreatmentRecommendationScreen'),
                ]);
              }
            } else {
              if (!prefetchedModules.has('classic_flow')) {
                prefetchedModules.add('classic_flow');
                await Promise.allSettled([
                  import('../components/AIAnalysisScreen'),
                  import('../components/ValidationScreen'),
                ]);
              }
            }
            break;

          case 4:
            // Being on Analysis, user will go to Validation / Treatment next
            if (appEngineMode === 'pathology_segmentation') {
              await import('../components/TreatmentRecommendationScreen');
            } else {
              await import('../components/ValidationScreen');
            }
            break;

          default:
            break;
        }
      } catch {
        // Silently ignore prefetch errors
      }
    };

    // For Step 2 (Configuration Screen), execute prefetch immediately without artificial delay
    if (currentStep === 2) {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => prefetchNextStep(), { timeout: 300 });
      } else {
        setTimeout(prefetchNextStep, 0);
      }
      return;
    }

    // For other steps, delay prefetching slightly to let initial animations finish smoothly
    const timer = setTimeout(() => {
      prefetchNextStep();
    }, 400);

    return () => clearTimeout(timer);
  }, [currentStep, appEngineMode]);
}
