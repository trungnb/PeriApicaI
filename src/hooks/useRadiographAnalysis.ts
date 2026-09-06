import { useCallback } from 'react';
import { useTranslation } from "react-i18next";
import { useAppStore } from '../store/appStore';
import { analyzeRadiograph, confirmValidityReceipt, validateRadiographImage } from '../services/aiService';
import { canProceedWithValidity, evaluateValidityDecision } from '../utils/imageValidity';
import { AssessmentLogPayload } from '../types/dental';
import { useAssessmentSession } from './useAssessmentSession';
import { usePathologyAnalysis } from './usePathologyAnalysis';
import { prepareAnalysisImage, DEFAULT_ANALYSIS_IMAGE_OPTIONS } from '../utils/imageCompressor';
import { handleAnalysisFlowError } from '../utils/errorBoundary';

function computeRequestHash(
  image: string,
  toothNumber: string,
  technique: string,
  receptor: string,
  lang: string,
  mode: string,
  modelA: string,
  modelB: string,
  apiKeyOpt: string,
  customKey: string
): string {
  let hash = 5381;
  const len = image.length;
  // Sample up to 1024 chars evenly across the string + length for near-instant hash
  const step = Math.max(1, Math.floor(len / 1024));
  for (let i = 0; i < len; i += step) {
    hash = (hash * 33) ^ image.charCodeAt(i);
  }
  hash = (hash * 33) ^ len;
  const imgHash = (hash >>> 0).toString(16);
  const keyIdentifier = apiKeyOpt === 'custom' ? `byok_${customKey.trim()}` : 'system';
  return `${imgHash}_${toothNumber}_${technique}_${receptor}_${lang}_${mode}_${modelA}_${modelB}_${keyIdentifier}`;
}

type ValidityOwnershipToken = {
  generation: number;
  toothFdi: string;
  imageDataUrl: string | null;
  assessmentId: string;
  technique: string;
  receptor: string;
  mode: string;
};

let inFlightValidityPromise: Promise<boolean> | null = null;
let inFlightValidityToken: ValidityOwnershipToken | null = null;

function captureValidityOwnership(store = useAppStore.getState()): ValidityOwnershipToken {
  return {
    generation: store.analysisGeneration,
    toothFdi: store.selectedTooth.fdiNumber,
    imageDataUrl: store.imageDataUrl,
    assessmentId: store.currentAssessmentId,
    technique: store.selectedTechnique,
    receptor: store.selectedReceptor,
    mode: store.appEngineMode,
  };
}

function isValidityOwnershipCurrent(token: ValidityOwnershipToken): boolean {
  const current = useAppStore.getState();
  return current.analysisGeneration === token.generation
    && current.selectedTooth.fdiNumber === token.toothFdi
    && current.imageDataUrl === token.imageDataUrl
    && current.currentAssessmentId === token.assessmentId
    && current.selectedTechnique === token.technique
    && current.selectedReceptor === token.receptor
    && current.appEngineMode === token.mode;
}

export async function triggerProactiveValidityCheck(explicitImageBase64?: string): Promise<boolean> {
  const store = useAppStore.getState();
  const {
    imageDataUrl,
    selectedTooth,
    compressedImageBase64,
    apiKeyOption,
    customApiKey,
    language,
    currentAssessmentId,
    analysisGeneration,
    validityGateState,
    validityConfirmedSnapshot,
    validityReceipt,
  } = store;

  const targetImageBase64 = explicitImageBase64 || compressedImageBase64;
  if (!imageDataUrl || !targetImageBase64) return false;
  if (apiKeyOption === 'custom' && !customApiKey.trim()) return false;

  const isAlreadyConfirmed = canProceedWithValidity({
    validityGateState,
    validityReceipt,
    validityConfirmedSnapshot,
    imageDataUrl,
    toothFdi: selectedTooth.fdiNumber,
    assessmentId: currentAssessmentId,
    technique: store.selectedTechnique,
    receptor: store.selectedReceptor,
    mode: store.appEngineMode,
  });

  if (isAlreadyConfirmed) {
    return true;
  }

  // If identical in-flight check exists, return same promise
  if (
    inFlightValidityPromise &&
    inFlightValidityToken &&
    inFlightValidityToken.generation === analysisGeneration &&
    inFlightValidityToken.toothFdi === selectedTooth.fdiNumber &&
    inFlightValidityToken.imageDataUrl === imageDataUrl &&
    inFlightValidityToken.assessmentId === currentAssessmentId
  ) {
    return inFlightValidityPromise;
  }

  const token = captureValidityOwnership(store);
  inFlightValidityToken = token;

  const isEn = language === 'EN';
  useAppStore.setState({
    validityGateState: 'checking',
    validityResult: null,
    validityConfirmedSnapshot: null,
    validityReceipt: null,
    validityConfirmationToken: null,
    validityModal: null,
  });

  const promise = (async (): Promise<boolean> => {
    const validitySnapshot = {
      generation: token.generation,
      requestId: `validity-${token.generation}`,
      mode: store.appEngineMode,
      assessmentId: token.assessmentId,
      toothFdi: token.toothFdi,
      technique: store.selectedTechnique,
      receptor: store.selectedReceptor,
      imageDataUrl: token.imageDataUrl,
    };

    const confirmProceed = (action: 'user_confirmed' | 'prototype_override', confirmationToken?: string) => {
      void (async () => {
        if (!isValidityOwnershipCurrent(token)) return;
        const confirmation = await confirmValidityReceipt({
          image: targetImageBase64,
          toothFdi: token.toothFdi,
          assessmentId: token.assessmentId,
          technique: store.selectedTechnique,
          receptorType: store.selectedReceptor,
          action,
          validityConfirmationToken: confirmationToken,
        });
        if (!confirmation.success || !confirmation.validityReceipt || !isValidityOwnershipCurrent(token)) return;
        useAppStore.getState().confirmValidityForCurrentSnapshot(validitySnapshot, confirmation.validityReceipt);
      })();
    };

    const setUnavailable = () => {
      useAppStore.setState({
        validityGateState: 'unavailable',
        validityResult: null,
        validityConfirmedSnapshot: null,
        validityReceipt: null,
        validityConfirmationToken: null,
        validityModal: {
          isOpen: true,
          type: 'unavailable',
          message: isEn ? 'Could not verify image suitability at this time.' : 'Không thể kiểm tra tính hợp lệ của ảnh lúc này.',
          onRetry: () => {
            if (!isValidityOwnershipCurrent(token)) return;
            useAppStore.getState().resetValidityState();
            void triggerProactiveValidityCheck(targetImageBase64);
          },
          onConfirm: () => confirmProceed('prototype_override'),
          onCancel: () => useAppStore.getState().setValidityModal(null),
        },
      });
    };

    try {
      const valResponse = await validateRadiographImage({
        image: targetImageBase64,
        toothFdi: selectedTooth.fdiNumber,
        language: isEn ? 'EN' : 'VI',
        apiKeyOption,
        customApiKey,
        preferredModel: store.selectedModelA || undefined,
        assessmentId: currentAssessmentId,
        technique: store.selectedTechnique,
        receptorType: store.selectedReceptor,
      });

      // R2 Stale Result Protection
      if (!isValidityOwnershipCurrent(token)) {
        return false;
      }

      if (!valResponse.success || valResponse.isUnavailable || !valResponse.validity) {
        setUnavailable();
        return false;
      }

      const decision = evaluateValidityDecision(valResponse.validity);
      useAppStore.setState({
        validityResult: valResponse.validity,
        validityReceipt: null,
        validityConfirmationToken: valResponse.validityConfirmationToken ?? null,
      });

      if (decision.state === 'invalid') {
        let invalidMsg = isEn
          ? 'The uploaded image is not suitable for clinical analysis.'
          : 'Ảnh tải lên chưa phù hợp để phân tích lâm sàng.';
        if (decision.issue === 'not_periapical') {
          invalidMsg = isEn
            ? 'The uploaded image does not appear to be an intraoral periapical radiograph. Please replace with a valid periapical image.'
            : 'Ảnh không phải là phim chụp quanh chóp (cận chóp). Vui lòng chọn ảnh phim quanh chóp chuẩn.';
        } else if (decision.issue === 'not_assessable') {
          invalidMsg = isEn
            ? 'The image is not assessable due to severe blur, blankness, or corruption. Please upload a clear radiograph.'
            : 'Ảnh không thể đánh giá được do quá mờ, trống hoặc bị hỏng. Vui lòng chọn ảnh chụp rõ nét hơn.';
        } else if (decision.issue === 'target_absent') {
          invalidMsg = isEn
            ? `The target tooth region (Tooth ${selectedTooth.fdiNumber}) is absent or out of frame. Please select another tooth or replace the image.`
            : `Vùng răng mục tiêu (Răng ${selectedTooth.fdiNumber}) không có trong ảnh. Vui lòng chọn lại răng hoặc đổi ảnh.`;
        } else if (decision.issue === 'mismatch') {
          invalidMsg = isEn
            ? `Visible tooth anatomy contradicts selected Tooth ${selectedTooth.fdiNumber}. Please verify tooth selection or replace the image.`
            : `Giải phẫu răng trong ảnh không khớp với Răng ${selectedTooth.fdiNumber} đã chọn. Vui lòng kiểm tra lại răng đã chọn hoặc đổi ảnh.`;
        }

        useAppStore.setState({
          validityGateState: 'invalid',
          validityConfirmedSnapshot: null,
          validityModal: {
            isOpen: true,
            type: 'invalid',
            issue: decision.issue,
            result: valResponse.validity,
            message: invalidMsg,
            onCancel: () => useAppStore.getState().setValidityModal(null),
          },
        });
        return false;
      }

      if (decision.state === 'warning') {
        useAppStore.setState({
          validityGateState: 'warning',
          validityConfirmedSnapshot: null,
          validityModal: {
            isOpen: true,
            type: 'warning',
            issue: 'uncertain',
            result: valResponse.validity,
            message: isEn
              ? `The AI cannot verify with certainty that Tooth ${selectedTooth.fdiNumber} matches the visible anatomy. Please confirm to proceed.`
              : `AI chưa thể xác minh chắc chắn rằng Răng ${selectedTooth.fdiNumber} khớp với hình ảnh. Vui lòng xác nhận nếu bạn muốn tiếp tục.`,
            onConfirm: () => confirmProceed('user_confirmed', valResponse.validityConfirmationToken),
            onCancel: () => useAppStore.getState().setValidityModal(null),
          },
        });
        return false;
      }

      // Valid: Record confirmed validity snapshot
      if (!valResponse.validityReceipt) {
        setUnavailable();
        return false;
      }
      useAppStore.setState({
        validityGateState: 'valid',
        validityConfirmedSnapshot: validitySnapshot,
        validityReceipt: valResponse.validityReceipt,
        validityConfirmationToken: null,
      });
      return true;
    } catch {
      if (isValidityOwnershipCurrent(token)) {
        setUnavailable();
      }
      return false;
    } finally {
      if (inFlightValidityToken === token) {
        inFlightValidityPromise = null;
        inFlightValidityToken = null;
      }
    }
  })();

  inFlightValidityPromise = promise;
  return promise;
}

export function useRadiographAnalysis() {
  const { t, i18n } = useTranslation();
  const { saveAssessment } = useAssessmentSession();
  const { runAnalysis: runPathologyAnalysis } = usePathologyAnalysis();

  const handleAnalyzeRadiograph = useCallback(async () => {
    const store = useAppStore.getState();
    const {
      language,
      imageDataUrl,
      imageFile,
      selectedTooth,
      selectedTechnique,
      selectedReceptor,
      currentAssessmentId,
      analysisResult,
      lastAnalyzedRequestHash,
      compressedImageBase64,
      apiKeyOption,
      customApiKey,
      analysisMode,
      validityGateState,
      validityConfirmedSnapshot,
      validityReceipt,
      setGlobalError,
    } = store;

    if (!imageDataUrl || !imageFile) return;

    if (apiKeyOption === 'custom' && !customApiKey.trim()) {
      setGlobalError(t('upload:byokEmptyKeyError'));
      return;
    }

    // The visible Analyze button is disabled until this is true. Keep the
    // same guard in the action path so a direct/stale callback cannot bypass
    // proactive validity or R29's server-side receipt check.
    if (!canProceedWithValidity({
      validityGateState,
      validityReceipt,
      validityConfirmedSnapshot,
      imageDataUrl,
      toothFdi: selectedTooth.fdiNumber,
      assessmentId: currentAssessmentId,
      technique: selectedTechnique,
      receptor: selectedReceptor,
      mode: store.appEngineMode,
    })) {
      return;
    }

    const startTotalTime = performance.now();
    let clientCompressTimeMs = store.lastCompressionMetrics?.processingTimeMs || 0;
    let aiBase64 = compressedImageBase64;

    if (!aiBase64) {
      try {
        const capturedGeneration = store.analysisGeneration;
        const prep = await prepareAnalysisImage(
          imageFile || imageDataUrl,
          DEFAULT_ANALYSIS_IMAGE_OPTIONS,
          store.lastCompressionMetrics
        );
        if (useAppStore.getState().analysisGeneration !== capturedGeneration) {
          console.debug('[useRadiographAnalysis] Stale image compression during analyze catch-up, aborting');
          return;
        }
        clientCompressTimeMs = prep.processingTimeMs;
        aiBase64 = prep.dataUrl;
        useAppStore.setState({ 
          compressedImageBase64: aiBase64,
          lastCompressionMetrics: {
            dataUrl: prep.dataUrl,
            width: prep.width,
            height: prep.height,
            originalWidth: prep.originalWidth,
            originalHeight: prep.originalHeight,
            scaleX: prep.width / (prep.originalWidth || prep.width || 1),
            scaleY: prep.height / (prep.originalHeight || prep.height || 1),
            processingTimeMs: prep.processingTimeMs,
            outputMime: prep.mimeType,
            wasAccelerated: false,
            originalSizeKB: undefined,
            compressedSizeKB: undefined,
            compressionRatio: undefined,
            qualityUsed: undefined,
          }
        });
      } catch {
        setGlobalError(t('upload:compressError'));
        return;
      }
    }

    // ─── R10 / R4: Pre-Analysis Image Validity Gate ──────────────────────
    const isEn = i18n.language === 'en';
    const validityOwnership = captureValidityOwnership(store);
    const isAlreadyConfirmed = canProceedWithValidity({
      validityGateState,
      validityReceipt,
      validityConfirmedSnapshot,
      imageDataUrl,
      toothFdi: selectedTooth.fdiNumber,
      assessmentId: currentAssessmentId,
      technique: selectedTechnique,
      receptor: selectedReceptor,
      mode: store.appEngineMode,
    });

    if (!isAlreadyConfirmed) {
      if (validityGateState === 'checking') {
        useAppStore.setState({
          isAnalyzing: true,
          analyzingStatusMessage: isEn
            ? '🔍 Verifying image suitability...'
            : '🔍 Đang kiểm tra tính phù hợp của ảnh...',
        });

        await (inFlightValidityPromise || triggerProactiveValidityCheck(aiBase64));
      } else if (validityGateState === 'idle') {
        useAppStore.setState({
          isAnalyzing: true,
          analyzingStatusMessage: isEn
            ? '🔍 Verifying image suitability...'
            : '🔍 Đang kiểm tra tính phù hợp của ảnh...',
        });

        await triggerProactiveValidityCheck(aiBase64);
      }

      // This waiter must not clear or open UI for a newer workspace/request.
      // The validity response guard alone is insufficient because the old
      // analysis continuation resumes after the await.
      if (!isValidityOwnershipCurrent(validityOwnership)) {
        return;
      }

      const postCheckStore = useAppStore.getState();
      const currentValState = postCheckStore.validityGateState;
      const currentValSnapshot = postCheckStore.validityConfirmedSnapshot;
      const isNowConfirmed = Boolean(
        (currentValState === 'valid' || currentValState === 'user_confirmed') &&
        Boolean(postCheckStore.validityReceipt) &&
        currentValSnapshot &&
        currentValSnapshot.toothFdi === selectedTooth.fdiNumber &&
        currentValSnapshot.imageDataUrl === imageDataUrl &&
        currentValSnapshot.assessmentId === currentAssessmentId
      );

      if (!isNowConfirmed) {
        useAppStore.setState({
          isAnalyzing: false,
          analyzingStatusMessage: null,
        });

        if (currentValState === 'invalid') {
          return;
        }

        if (currentValState === 'warning') {
          const warningMsg = isEn
            ? `The AI cannot verify with certainty that Tooth ${selectedTooth.fdiNumber} matches the visible anatomy. Please confirm to proceed.`
            : `AI chưa thể xác minh chắc chắn rằng Răng ${selectedTooth.fdiNumber} khớp với hình ảnh. Vui lòng xác nhận nếu bạn muốn tiếp tục.`;

          const validitySnapshot = {
            generation: postCheckStore.analysisGeneration,
            requestId: `validity-${postCheckStore.analysisGeneration}`,
            mode: postCheckStore.appEngineMode,
            assessmentId: currentAssessmentId,
            toothFdi: selectedTooth.fdiNumber,
            technique: selectedTechnique,
            receptor: selectedReceptor,
            imageDataUrl,
          };

          useAppStore.setState({
            validityModal: {
              isOpen: true,
              type: 'warning',
              issue: 'uncertain',
              result: postCheckStore.validityResult,
              message: warningMsg,
              onConfirm: () => {
                void (async () => {
                  if (!isValidityOwnershipCurrent(validityOwnership)) return;
                  const confirmation = await confirmValidityReceipt({
                    image: aiBase64,
                    toothFdi: selectedTooth.fdiNumber,
                    assessmentId: currentAssessmentId,
                    technique: selectedTechnique,
                    receptorType: selectedReceptor,
                    action: 'user_confirmed',
                    validityConfirmationToken: useAppStore.getState().validityConfirmationToken || undefined,
                  });
                  if (!confirmation.success || !confirmation.validityReceipt || !isValidityOwnershipCurrent(validityOwnership)) return;
                  useAppStore.getState().confirmValidityForCurrentSnapshot(validitySnapshot, confirmation.validityReceipt);
                  handleAnalyzeRadiograph();
                })();
              },
              onCancel: () => useAppStore.getState().setValidityModal(null),
            },
          });
          return;
        }

        if (currentValState === 'unavailable') {
          const validitySnapshot = {
            generation: postCheckStore.analysisGeneration,
            requestId: `validity-${postCheckStore.analysisGeneration}`,
            mode: postCheckStore.appEngineMode,
            assessmentId: currentAssessmentId,
            toothFdi: selectedTooth.fdiNumber,
            technique: selectedTechnique,
            receptor: selectedReceptor,
            imageDataUrl,
          };

          useAppStore.setState({
            validityModal: {
              isOpen: true,
              type: 'unavailable',
              message: isEn ? 'Could not verify image suitability at this time.' : 'Không thể kiểm tra tính hợp lệ của ảnh lúc này.',
              onRetry: () => {
                if (!isValidityOwnershipCurrent(validityOwnership)) return;
                // Retry is a new validity operation for the current snapshot.
                // Resetting first prevents handleAnalyzeRadiograph from merely
                // reopening this unavailable modal.
                useAppStore.setState({
                  validityGateState: 'idle',
                  validityResult: null,
                  validityConfirmedSnapshot: null,
                  validityReceipt: null,
                  validityConfirmationToken: null,
                  validityModal: null,
                });
                void (async () => {
                  const didValidate = await triggerProactiveValidityCheck();
                  if (didValidate && isValidityOwnershipCurrent(validityOwnership)) {
                    await handleAnalyzeRadiograph();
                  }
                })();
              },
              onConfirm: () => {
                void (async () => {
                  if (!isValidityOwnershipCurrent(validityOwnership)) return;
                  const override = await confirmValidityReceipt({
                    image: aiBase64,
                    toothFdi: selectedTooth.fdiNumber,
                    assessmentId: currentAssessmentId,
                    technique: selectedTechnique,
                    receptorType: selectedReceptor,
                    action: 'prototype_override',
                  });
                  if (!override.success || !override.validityReceipt || !isValidityOwnershipCurrent(validityOwnership)) return;
                  useAppStore.getState().confirmValidityForCurrentSnapshot(validitySnapshot, override.validityReceipt);
                  handleAnalyzeRadiograph();
                })();
              },
              onCancel: () => useAppStore.getState().setValidityModal(null),
            },
          });
          return;
        }

        return;
      }
    }

    // ─── Downstream Pipelines (Preserved Intact) ───────────────────
    if (useAppStore.getState().appEngineMode === 'pathology_segmentation') {
      const snapshot = useAppStore.getState().startAnalysisRequest('pathology_segmentation');
      const selectedModel = useAppStore.getState().selectedModelA || 'Automatic';
      useAppStore.setState({
        isAnalyzing: true,
        analyzingStatusMessage: i18n.language === 'en' 
          ? `Initializing Pathology Segmentation (${selectedModel})...` 
          : `Đang khởi tạo luồng phân tích tổn thương (${selectedModel})...`,
      });
      const committed = await runPathologyAnalysis(snapshot);
      
      if (!committed || !useAppStore.getState().isAnalysisCurrent(snapshot)) {
        return;
      }

      const status = useAppStore.getState().pathologyAnalysisStatus;
      if (status === 'error') {
        useAppStore.setState({
          isAnalyzing: false,
          analyzingStatusMessage: null,
          globalError: useAppStore.getState().pathologyStatusMessage || (t('common:spatialSegmentationFailed')),
        });
        return;
      }

      useAppStore.setState({
        isAnalyzing: false,
        analyzingStatusMessage: null,
        currentStep: 4,
      });
      return;
    }

    const modelA = useAppStore.getState().selectedModelA || '';
    const modelB = useAppStore.getState().selectedModelB || '';

    const currentHash = computeRequestHash(
      aiBase64,
      selectedTooth.fdiNumber,
      selectedTechnique,
      selectedReceptor,
      language,
      analysisMode,
      modelA,
      modelB,
      apiKeyOption,
      customApiKey
    );

    // Session Deduplication Cache
    if (lastAnalyzedRequestHash === currentHash && analysisResult) {
      useAppStore.setState({
        isAnalyzing: false,
        analyzingStatusMessage: null,
        currentStep: 4,
      });
      return;
    }

    // Acquire request snapshot and register active request with incremented generation
    const snapshot = useAppStore.getState().startAnalysisRequest('classic');

    const selectedModel = useAppStore.getState().selectedModelA || 'Automatic';
    const initialStatus = analysisMode === 'consensus'
      ? (i18n.language === 'en' ? `Initializing Dual-Model Consensus (${selectedModel})...` : `Đang khởi tạo Hội chẩn Song song (${selectedModel})...`)
      : (i18n.language === 'en' ? `Analyzing with ${selectedModel}...` : `Đang phân tích với model ${selectedModel}...`);

    useAppStore.setState({
      isAnalyzing: true,
      analyzingStatusMessage: initialStatus,
    });

    const apiStart = performance.now();
    try {
      const data = await analyzeRadiograph(aiBase64, 'classic', {
        tooth: selectedTooth,
        technique: selectedTechnique,
        receptorType: selectedReceptor,
        language,
        onStatusUpdate: (status) => {
          if (useAppStore.getState().isAnalysisCurrent(snapshot)) {
            useAppStore.setState({ analyzingStatusMessage: status });
          }
        },
        apiKeyOption,
        customApiKey,
        analysisMode,
        selectedModelA: useAppStore.getState().selectedModelA,
        selectedModelB: useAppStore.getState().selectedModelB,
        assessmentId: currentAssessmentId,
        validityReceipt: useAppStore.getState().validityReceipt || undefined,
      });

      // Generation Guard Check: Check if user changed inputs or invalidated this request
      if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
        return;
      }

      const apiDurationMs = Math.round(performance.now() - apiStart);
      const totalTimeMs = Math.round(performance.now() - startTotalTime);
      const wasCached = Boolean(data.isCached);
      // No more fake network capping
      const networkTimeMs = 0;
      const geminiTimeMs = apiDurationMs;

      if (!data.success || !data.analysis) {
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) return;
        handleAnalysisFlowError(
          {
            errorNotice: data.errorNotice,
            userMessage: data.userMessage,
            isCustomKeyFailed: data.isCustomKeyFailed,
            isAllExhausted: data.isAllExhausted,
            isQuotaExhausted: data.isQuotaExhausted,
            resetNotice: data.resetNotice,
            type: 'classic',
          },
          'classic',
          {
            language: language as 'VI' | 'EN',
            context: {
              tooth: selectedTooth.fdiNumber,
              mode: analysisMode,
              modelA: useAppStore.getState().selectedModelA,
            },
            snapshot,
          }
        );
        return;
      }

      if (data.analysis.isPeriapicalRadiograph === false) {
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) return;
        const isEn = language === 'EN';
        const invalidPayload: AssessmentLogPayload = {
          assessmentId: currentAssessmentId,
          timestamp: new Date().toISOString(),
          tooth: selectedTooth,
          technique: selectedTechnique,
          receptorType: selectedReceptor,
          sessionStatus: 'FAILED_NON_DENTAL',
          lastCompletedStep: 3,
          stage: isEn ? 'Step 3: Invalid image (Not a periapical radiograph)' : 'Bước 3: Ảnh không hợp lệ (Không phải phim cận chóp)',
          stepStatus: { step3: true, step4: false, step5: false },
          aiAnalysis: data.analysis,
          userValidation: {
            concurred: false,
            overriddenErrors: ['not_periapical'],
            userNotes: isEn ? '[Auto-detected] Uploaded image is not a periapical radiograph.' : '[Tự động nhận diện] Hình ảnh tải lên không phải là phim X-quang cận chóp.',
          },
          finalConfirmedErrors: ['not_periapical'],
        };

        saveAssessment(invalidPayload, aiBase64);
        handleAnalysisFlowError(
          {
            errorCode: 'NOT_PERIAPICAL',
            userMessage: t('common:nonDentalImage'),
            type: 'classic',
          },
          'classic',
          {
            language: language as 'VI' | 'EN',
            context: { tooth: selectedTooth.fdiNumber, mode: analysisMode },
            snapshot,
          }
        );
        return;
      }

      // Generation Guard Check before state commit
      if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
        return;
      }

      // CONCURRENT NAV TRANSITION: Immediate step change 4 for zero-latency screen navigation
      useAppStore.setState({
        lastAnalyzedRequestHash: currentHash,
        analysisResult: data.analysis,
        isFallbackAnalysis: Boolean(data.isFallback),
        currentStep: 4,
        lastAnalysisMetrics: {
          clientCompressTimeMs,
          networkTimeMs,
          geminiTimeMs,
          totalTimeMs,
          wasCached,
          pipeline: 'classic',
          modelUsed: analysisMode === 'consensus' ? 'Consensus' : (useAppStore.getState().selectedModelA || 'Automatic')
        }
      });

      const aiKeys: string[] = [];
      data.analysis.findings?.forEach((f) => {
        f.detectedErrors?.forEach((e) => {
          if (e.errorKey && !aiKeys.includes(e.errorKey)) {
            aiKeys.push(e.errorKey);
          }
        });
      });

      const isEn = language === 'EN';
      const step4Payload: AssessmentLogPayload = {
        assessmentId: currentAssessmentId,
        timestamp: new Date().toISOString(),
        tooth: selectedTooth,
        technique: selectedTechnique,
        receptorType: selectedReceptor,
        sessionStatus: 'INCOMPLETE',
        lastCompletedStep: 4,
        stage: isEn ? 'Step 4: AI completed error detection' : 'Bước 4: AI đã phân tích lỗi kỹ thuật',
        stepStatus: { step3: true, step4: true, step5: false },
        aiAnalysis: data.analysis,
        userValidation: {
          concurred: false,
          overriddenErrors: aiKeys,
          userNotes: isEn ? 'AI analysis complete (Step 4), awaiting clinical validation' : 'Đã hoàn thành phân tích AI (Bước 4), chờ xác minh lâm sàng',
        },
        finalConfirmedErrors: aiKeys,
      };

      // Background Logging and state cleanup runs concurrently without blocking page transition
      Promise.all([
        saveAssessment(step4Payload, aiBase64),
        useAppStore.setState({ compressedImageBase64: null })
      ]).catch((logErr) => {
        console.warn('[AutoLog Step 4 Background Log Error]:', logErr);
      });
    } catch (unknownError: unknown) {
      if (!useAppStore.getState().isAnalysisCurrent(snapshot)) return;
      handleAnalysisFlowError(unknownError, 'classic', {
        language: language as 'VI' | 'EN',
        context: { tooth: selectedTooth.fdiNumber, mode: analysisMode },
        snapshot,
      });
    } finally {
      if (useAppStore.getState().isAnalysisCurrent(snapshot)) {
        useAppStore.setState({
          isAnalyzing: false,
          analyzingStatusMessage: null,
        });
      }
    }
  }, [t, saveAssessment, runPathologyAnalysis]);

  const retryWithSystemKey = useCallback(async () => {
    useAppStore.getState().setApiKeyOption('system');
    useAppStore.getState().setCustomKeyErrorModal(null);
    return handleAnalyzeRadiograph();
  }, [handleAnalyzeRadiograph]);

  return {
    handleAnalyzeRadiograph,
    retryWithSystemKey,
  };
}
