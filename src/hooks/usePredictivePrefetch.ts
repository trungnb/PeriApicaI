import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { warmupImageDecoder } from '../utils/imageCompressor';

let step2PrefetchDone = false;

/**
 * Proactively prefetches and warms up all Step 3 (UploadScreen), Step 4 (AI Analysis),
 * base64 image decoding engines, Web Workers, and AI diagnostic chunks in the background.
 * Call this as soon as the user enters the Configuration screen (Step 2).
 */
export async function prefetchStep2AIModules(): Promise<void> {
  if (step2PrefetchDone) return;
  step2PrefetchDone = true;

  try {
    // 1. Proactively warm up and initialize the base64 image decoding engine,
    // WebP support check, OffscreenCanvas, and Web Worker thread.
    // This removes the ~300ms first-run compilation and thread startup penalty.
    warmupImageDecoder().catch((err) => {
      console.debug('[PredictivePrefetch] Background image decoder warmup notice:', err);
    });

    // 2. Prefetch Lazy Route Chunks (Step 3, 4, 5 and Modals)
    await Promise.allSettled([
      import('../components/UploadScreen'),
      import('../components/AIAnalysisScreen'),
      import('../components/PathologyAnalysisScreen'),
      import('../components/ValidationScreen'),
      import('../components/TreatmentRecommendationScreen'),
      import('../components/AdminPortalModal'),
    ]);

    console.log('[PredictivePrefetch] Step 2 -> Step 3/4 AI diagnostic chunks and image decoder primed successfully.');
  } catch (err) {
    // Silently handle any prefetch errors; runtime imports will fetch normally if needed
    console.debug('[PredictivePrefetch] Non-blocking prefetch info:', err);
  }
}

export function usePredictivePrefetch() {
  const currentStep = useAppStore((state) => state.currentStep);
  const appEngineMode = useAppStore((state) => state.appEngineMode);

  useEffect(() => {
    // Advanced Predictive Prefetching & Engine Warm-up Strategy:
    // Anticipates the user's workflow to load assets, JS chunks, and spin up
    // background processing threads (Web Workers, OffscreenCanvas) before they are needed.
    const prefetchNextStep = async () => {
      try {
        switch (currentStep) {
          case 1:
            // Being on Welcome, user will go to Config next
            await import('../components/ConfigurationScreen');
            break;

          case 2:
            // Being on Config (Step 2), immediately run full prefetch and base64 engine warmup
            await prefetchStep2AIModules();
            break;

          case 3:
            // Being on Upload, user will trigger analysis next
            if (appEngineMode === 'pathology_segmentation') {
              await import('../components/PathologyAnalysisScreen');
              await import('../components/TreatmentRecommendationScreen');
            } else {
              await import('../components/AIAnalysisScreen');
              await import('../components/ValidationScreen');
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
