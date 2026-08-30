import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { AssessmentLogPayload, ConfirmedPathology, AIDetection } from '../types/dental';
import { saveAssessmentLog, savePathologyAssessmentLog } from '../services/apiService';
import { getOrCreateUserId } from '../utils/userUtils';
import { compressImage } from '../utils/imageCompressor';

export function useAssessmentSession() {
  const saveAssessment = useCallback(async (payload: AssessmentLogPayload, imageDataUrlParam?: string) => {
    const { shareConsent, addLog } = useAppStore.getState();
    try {
      const currentUserId = payload.userId || getOrCreateUserId();

      const fullPayload: AssessmentLogPayload = {
        shareConsent,
        ...payload,
        userId: currentUserId,
        imageUrl: shareConsent ? payload.imageUrl : undefined,
      };

      const finalImageDataUrl = shareConsent ? imageDataUrlParam : undefined;

      const data = await saveAssessmentLog(fullPayload, finalImageDataUrl);
      if (data?.success) {
        addLog({
          ...fullPayload,
          imageUrl: data.imageUrl || fullPayload.imageUrl,
        });
      }
    } catch (err) {
      console.error('[Save Assessment Error]:', err);
    }
  }, []);

  const savePathologyAssessment = useCallback(async (payload: any, imageDataUrlParam?: string) => {
    const { shareConsent } = useAppStore.getState();
    try {
      const currentUserId = payload.userId || getOrCreateUserId();
      const finalImageDataUrl = shareConsent ? imageDataUrlParam : undefined;
      const fullPayload = {
        shareConsent,
        ...payload,
        userId: currentUserId,
        imageUrl: shareConsent ? payload.imageUrl : undefined,
        imageDataUrl: finalImageDataUrl,
      };
      await savePathologyAssessmentLog(fullPayload, finalImageDataUrl);
    } catch (err) {
      console.error('[Save Pathology Assessment Error]:', err);
    }
  }, []);


  const handleImageSelectedAndAutoLog = useCallback(async (file: File) => {
    const {
      language,
      currentAssessmentId,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      appEngineMode,
      setImageDataUrl,
      shareConsent,
    } = useAppStore.getState();
    const isEn = language === 'EN';
    const objectUrl = URL.createObjectURL(file);
    setImageDataUrl(objectUrl, file);

    try {
      // 1. Immediately kick off compression as high priority
      const compressResult = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.88 });
      useAppStore.setState({ 
        compressedImageBase64: compressResult.dataUrl,
        lastCompressionMetrics: compressResult
      });

      // 2. Perform step 3 auto-logging in background (non-blocking) with explicit catch
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
        savePathologyAssessment(step3PathologyPayload, imagePayloadUrl).catch((err) => {
          console.debug('[useAssessmentSession] Step 3 background pathology log notice:', err);
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
        saveAssessment(step3Payload, imagePayloadUrl).catch((err) => {
          console.debug('[useAssessmentSession] Step 3 background classic log notice:', err);
        });
      }
    } catch (e) {
      console.error('[AutoLog Step 3 Image Error]:', e);
    }
  }, [savePathologyAssessment, saveAssessment]);

  const savePathologyStep4 = useCallback(async () => {
    const {
      language,
      currentAssessmentId,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      aiDetections,
      confirmedPathologies,
      userNotes,
      compressedImageBase64,
      imageDataUrl,
      shareConsent,
    } = useAppStore.getState();

    const isEn = language === 'EN';
    const step4PathologyPayload = {
      assessmentId: currentAssessmentId,
      timestamp: new Date().toISOString(),
      tooth: selectedTooth,
      technique: selectedTechnique,
      receptorType: selectedReceptor,
      analysisMode: 'pathology_segmentation',
      sessionStatus: 'INCOMPLETE',
      lastCompletedStep: 4,
      stage: isEn ? 'Step 4: Clinical Review Complete' : 'Bước 4: Bác sĩ đã xem xét & chỉnh sửa tổn thương',
      stepStatus: { step3: true, step4: true, step5: false },
      detectedPathologies: aiDetections,
      confirmedPathologies,
      userNotes: userNotes.trim()
        ? `${isEn ? 'Step 4 Review Notes' : 'Ghi chú Bước 4'}: ${userNotes.trim()}`
        : (isEn ? 'Step 4 clinical review complete' : 'Đã hoàn thành xem xét bất thường (Bước 4)'),
    };
    const imagePayload = shareConsent ? (compressedImageBase64 || imageDataUrl || undefined) : undefined;
    return savePathologyAssessment(step4PathologyPayload, imagePayload);
  }, [savePathologyAssessment]);

  const autoLogPathologyStep4 = useCallback(async (_detections?: AIDetection[], _confirmed?: ConfirmedPathology[]) => {
    savePathologyStep4().catch((err) => {
      console.debug('[useAssessmentSession] autoLogPathologyStep4 background notice:', err);
    });
  }, [savePathologyStep4]);

  const completeValidationAndSave = useCallback(async () => {
    const {
      language,
      currentAssessmentId,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      analysisResult,
      confirmedErrorKeys,
      userNotes,
      compressedImageBase64,
      imageDataUrl,
      shareConsent,
      startNewSession,
    } = useAppStore.getState();

    if (!analysisResult) {
      startNewSession();
      return;
    }

    const isEn = language === 'EN';
    const initialAiErrorKeys: string[] = [];
    analysisResult.findings?.forEach((f) => {
      f.detectedErrors?.forEach((e) => {
        if (e.errorKey && !initialAiErrorKeys.includes(e.errorKey)) {
          initialAiErrorKeys.push(e.errorKey);
        }
      });
    });

    const payload: AssessmentLogPayload = {
      assessmentId: currentAssessmentId || `perio_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      tooth: selectedTooth,
      technique: selectedTechnique,
      receptorType: selectedReceptor,
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      stage: isEn ? 'Step 5: Assessment & Remediation Complete' : 'Bước 5: Hoàn tất đối chiếu & đánh giá',
      stepStatus: { step3: true, step4: true, step5: true },
      aiAnalysis: analysisResult,
      userValidation: {
        concurred: JSON.stringify(initialAiErrorKeys.sort()) === JSON.stringify(confirmedErrorKeys.sort()),
        overriddenErrors: confirmedErrorKeys,
        userNotes: userNotes.trim()
          ? `${isEn ? 'Session completed | Notes' : 'Hoàn tất phiên | Ghi chú'}: ${userNotes.trim()}`
          : (isEn ? 'Session completed' : 'Hoàn tất phiên'),
      },
      finalConfirmedErrors: confirmedErrorKeys,
    };
    const imagePayload = shareConsent ? (compressedImageBase64 || imageDataUrl || undefined) : undefined;

    // Reset UI immediately for instant responsive UX
    startNewSession();

    // Persist assessment asynchronously in background
    saveAssessment(payload, imagePayload).catch((err) => {
      console.debug('[useAssessmentSession] Background classic assessment save notice:', err);
    });
  }, [saveAssessment]);

  const completePathologySessionAndSave = useCallback(async () => {
    const {
      language,
      currentAssessmentId,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      aiDetections,
      confirmedPathologies,
      userNotes,
      compressedImageBase64,
      imageDataUrl,
      shareConsent,
      startNewSession,
    } = useAppStore.getState();
    const isEn = language === 'EN';

    const payload = {
      assessmentId: currentAssessmentId,
      timestamp: new Date().toISOString(),
      tooth: selectedTooth,
      technique: selectedTechnique,
      receptorType: selectedReceptor,
      analysisMode: 'pathology_segmentation',
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      stage: isEn ? 'Step 5: Pathology & Treatment Complete' : 'Bước 5: Hoàn tất chẩn đoán & phác đồ',
      stepStatus: { step3: true, step4: true, step5: true },
      detectedPathologies: aiDetections,
      confirmedPathologies,
      userNotes: userNotes.trim()
        ? `${isEn ? 'Session completed | Notes' : 'Hoàn tất phiên | Ghi chú'}: ${userNotes.trim()}`
        : (isEn ? 'Session completed' : 'Hoàn tất phiên'),
    };
    const imagePayload = shareConsent ? (compressedImageBase64 || imageDataUrl || undefined) : undefined;

    // Reset UI immediately for instant responsive UX
    startNewSession();

    // Persist pathology assessment asynchronously in background
    savePathologyAssessment(payload, imagePayload).catch((err) => {
      console.debug('[useAssessmentSession] Background pathology assessment save notice:', err);
    });
  }, [savePathologyAssessment]);

  return {
    saveAssessment,
    savePathologyAssessment,
    handleImageSelectedAndAutoLog,
    savePathologyStep4,
    autoLogPathologyStep4,
    completeValidationAndSave,
    completePathologySessionAndSave,
  };
}
