import { compressImage as defaultCompressImage, DEFAULT_ANALYSIS_IMAGE_OPTIONS } from './imageCompressor';
import { AssessmentLogPayload } from '../types/dental';
import { useAppStore } from '../store/appStore';

export async function executeImageCompressionAndLog(
  file: File,
  capturedGeneration: number,
  savePathologyFn: (payload: any, imagePayloadUrl?: string) => Promise<void>,
  saveClassicFn: (payload: AssessmentLogPayload, imagePayloadUrl?: string) => Promise<void>,
  compressFn: typeof defaultCompressImage = defaultCompressImage
): Promise<void> {
  try {
    // 1. Immediately kick off compression as high priority
    const compressResult = await compressFn(file, DEFAULT_ANALYSIS_IMAGE_OPTIONS);

    // R11 Guard: drop stale compression results
    if (useAppStore.getState().analysisGeneration !== capturedGeneration) {
      console.debug('[uploadTask] Stale compression resolved, dropping side effects.', { capturedGeneration });
      return;
    }

    useAppStore.setState({ 
      compressedImageBase64: compressResult.dataUrl,
      lastCompressionMetrics: compressResult
    });

    // 2. Perform step 3 auto-logging in background (non-blocking)
    const {
      language,
      currentAssessmentId,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      appEngineMode,
      shareConsent,
    } = useAppStore.getState();
    const isEn = language === 'EN';
    const imagePayloadUrl = shareConsent ? compressResult.dataUrl : undefined;

    if (appEngineMode === 'pathology_segmentation') {
      const step3PathologyPayload = {
        assessmentId: currentAssessmentId,
        timestamp: new Date().toISOString(),
        tooth: selectedTooth,
        technique: selectedTechnique,
        receptorType: selectedReceptor,
        analysisMode: 'pathology_segmentation',
        sessionStatus: 'INCOMPLETE',
        lastCompletedStep: 3,
        stage: isEn ? 'Step 3: Image uploaded' : 'Bước 3: Đã tải ảnh lên',
        stepStatus: { step3: true, step4: false, step5: false },
        detectedPathologies: [],
        confirmedPathologies: [],
        userNotes: isEn ? 'Image uploaded (Step 3)' : 'Đang ở bước tải ảnh (Bước 3)',
      };
      savePathologyFn(step3PathologyPayload, imagePayloadUrl).catch((err) => {
        console.debug('[uploadTask] Step 3 background pathology log notice:', err);
      });
    } else {
      const step3Payload: AssessmentLogPayload = {
        assessmentId: currentAssessmentId,
        timestamp: new Date().toISOString(),
        tooth: selectedTooth,
        technique: selectedTechnique,
        receptorType: selectedReceptor,
        sessionStatus: 'INCOMPLETE',
        lastCompletedStep: 3,
        stage: isEn ? 'Step 3: Image uploaded' : 'Bước 3: Đã tải ảnh lên',
        stepStatus: { step3: true, step4: false, step5: false },
        aiAnalysis: {
          overallQuality: 'Needs Retake',
          findings: [],
        },
        userValidation: {
          concurred: false,
          overriddenErrors: [],
          userNotes: isEn ? 'Image uploaded (Step 3)' : 'Đang ở bước tải ảnh (Bước 3)',
        },
        finalConfirmedErrors: [],
      };
      saveClassicFn(step3Payload, imagePayloadUrl).catch((err) => {
        console.debug('[uploadTask] Step 3 background classic log notice:', err);
      });
    }
  } catch (e) {
    console.error('[AutoLog Step 3 Image Error]:', e);
  }
}
