import { useCallback } from 'react';
import { useTranslation } from "react-i18next";
import { useAppStore } from '../store/appStore';
import { analyzeRadiograph } from '../services/aiService';
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
      setGlobalError,
    } = store;

    if (!imageDataUrl || !imageFile) return;

    if (apiKeyOption === 'custom' && !customApiKey.trim()) {
      setGlobalError(t('upload:byokEmptyKeyError'));
      return;
    }

    if (useAppStore.getState().appEngineMode === 'pathology_segmentation') {
      const selectedModel = useAppStore.getState().selectedModelA || 'gemini-flash';
      useAppStore.setState({
        isAnalyzing: true,
        analyzingStatusMessage: i18n.language === 'en' 
          ? `Initializing Pathology Segmentation (${selectedModel})...` 
          : `Đang khởi tạo luồng phân tích tổn thương (${selectedModel})...`,
      });
      await runPathologyAnalysis();
      
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

    const startTotalTime = performance.now();
    let clientCompressTimeMs = store.lastCompressionMetrics?.processingTimeMs || 0;
    let aiBase64 = compressedImageBase64;

    if (!aiBase64) {
      try {
        const prep = await prepareAnalysisImage(
          imageFile || imageDataUrl,
          DEFAULT_ANALYSIS_IMAGE_OPTIONS,
          store.lastCompressionMetrics
        );
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
      } catch (e) {
        setGlobalError(t('upload:compressError'));
        return;
      }
    }

    const modelA = useAppStore.getState().selectedModelA || 'gemini-flash-latest';
    const modelB = useAppStore.getState().selectedModelB || 'gemini-flash-lite-latest';

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

    const selectedModel = useAppStore.getState().selectedModelA || 'gemini-flash';
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
          useAppStore.setState({ analyzingStatusMessage: status });
        },
        apiKeyOption,
        customApiKey,
        analysisMode,
        selectedModelA: useAppStore.getState().selectedModelA,
        selectedModelB: useAppStore.getState().selectedModelB,
      });

      const apiDurationMs = Math.round(performance.now() - apiStart);
      const totalTimeMs = Math.round(performance.now() - startTotalTime);
      const wasCached = Boolean(data.isCached);
      // No more fake network capping
      const networkTimeMs = 0;
      const geminiTimeMs = apiDurationMs;

      if (!data.success || !data.analysis) {
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
          }
        );
        return;
      }

      if (data.analysis.isPeriapicalRadiograph === false) {
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
          }
        );
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
          modelUsed: analysisMode === 'consensus' ? 'Consensus (Flash+Lite)' : (useAppStore.getState().selectedModelA || 'gemini-flash')
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
      handleAnalysisFlowError(unknownError, 'classic', {
        language: language as 'VI' | 'EN',
        context: { tooth: selectedTooth.fdiNumber, mode: analysisMode },
      });
    } finally {
      useAppStore.setState({
        isAnalyzing: false,
        analyzingStatusMessage: null,
      });
    }
  }, [t, saveAssessment, runPathologyAnalysis]);

  return {
    handleAnalyzeRadiograph,
  };
}
