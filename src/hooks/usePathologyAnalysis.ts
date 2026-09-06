/**
 * usePathologyAnalysis — Hook orchestrating Pathology Segmentation
 * Directly calls Gemini 2D Spatial Polygon Grounding API (100% Free API)
 */
import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { AIDetection, AnalysisWorkspaceSnapshot } from '../types/dental';
import { mapServerFindingToAIDetection } from '../utils/polygonAdapter';
import { analyzeRadiograph } from '../services/aiService';
import { useAssessmentSession } from './useAssessmentSession';
import { handleAnalysisFlowError } from '../utils/errorBoundary';
import { prepareAnalysisImage, DEFAULT_ANALYSIS_IMAGE_OPTIONS, getImageDimensionsFromDataUrl } from '../utils/imageCompressor';
import { makeConfirmedPathology } from '../utils/pathologyReviewWorkflow';
import { canProceedWithValidity } from '../utils/imageValidity';

export function usePathologyAnalysis() {
  const abortRef = useRef<AbortController | null>(null);
  const activeSnapshotRef = useRef<AnalysisWorkspaceSnapshot | null>(null);
  const { autoLogPathologyStep4 } = useAssessmentSession();

  const imageDataUrl = useAppStore((s) => s.imageDataUrl);
  const compressedImageBase64 = useAppStore((s) => s.compressedImageBase64);
  const selectedTooth = useAppStore((s) => s.selectedTooth);
  const language = useAppStore((s) => s.language);
  const customApiKey = useAppStore((s) => s.customApiKey);
  const apiKeyOption = useAppStore((s) => s.apiKeyOption);
  const setAiDetections = useAppStore((s) => s.setAiDetections);
  const setConfirmedPathologies = useAppStore((s) => s.setConfirmedPathologies);
  const setPathologyGeminiResult = useAppStore((s) => s.setPathologyGeminiResult);
  const setPathologyValidityAudit = useAppStore((s) => s.setPathologyValidityAudit);
  const setPathologyInferenceLineage = useAppStore((s) => s.setPathologyInferenceLineage);
  const setPathologyAnalysisStatus = useAppStore((s) => s.setPathologyAnalysisStatus);
  const setPathologyStatusMessage = useAppStore((s) => s.setPathologyStatusMessage);
  const setAnalyzingStatusMessage = useAppStore((s) => s.setAnalyzingStatusMessage);

  const updateStatus = useCallback(
    (msg: string) => {
      if (activeSnapshotRef.current && !useAppStore.getState().isAnalysisCurrent(activeSnapshotRef.current)) {
        return;
      }
      setPathologyStatusMessage(msg);
      setAnalyzingStatusMessage(msg);
    },
    [setPathologyStatusMessage, setAnalyzingStatusMessage]
  );

  const runAnalysis = useCallback(
    async (existingSnapshot?: AnalysisWorkspaceSnapshot): Promise<boolean> => {
      const currentStore = useAppStore.getState();
      if (!canProceedWithValidity({
        validityGateState: currentStore.validityGateState,
        validityReceipt: currentStore.validityReceipt,
        validityConfirmedSnapshot: currentStore.validityConfirmedSnapshot,
        imageDataUrl: currentStore.imageDataUrl,
        toothFdi: currentStore.selectedTooth.fdiNumber,
        assessmentId: currentStore.currentAssessmentId,
        technique: currentStore.selectedTechnique,
        receptor: currentStore.selectedReceptor,
        mode: currentStore.appEngineMode,
      })) {
        return false;
      }
      if (!imageDataUrl) return false;

      const snapshot = existingSnapshot || useAppStore.getState().startAnalysisRequest('pathology_segmentation');
      activeSnapshotRef.current = snapshot;

      abortRef.current = new AbortController();
      const startTotalTime = performance.now();
      const isEn = language === 'EN';

      setPathologyAnalysisStatus('analyzing');
      useAppStore.setState({ isAnalyzing: true });

      const appState = useAppStore.getState();
      const isConsensus = appState.analysisMode === 'consensus';
      const modelA = appState.selectedModelA || 'Automatic';
      const modelB = appState.selectedModelB || 'Automatic';

      if (isConsensus) {
        updateStatus(
          isEn
            ? `👥 Initializing Parallel Consensus Vision Pipeline (${modelA} + ${modelB})...`
            : `👥 Đang khởi chạy Luồng Phân tích Song song (${modelA} + ${modelB})...`
        );
      } else {
        updateStatus(
          isEn
            ? `🔬 Initializing Single AI Vision Pipeline (${modelA})...`
            : `🔬 Đang khởi chạy Mô hình AI đơn lẻ (${modelA})...`
        );
      }

      try {
        const lastCompressionMetrics = appState.lastCompressionMetrics;
        // 1. Prepare image in unified pipeline (reuses existing compressed image & dimensions without re-compressing)
        const prep = await prepareAnalysisImage(
          compressedImageBase64 || imageDataUrl,
          DEFAULT_ANALYSIS_IMAGE_OPTIONS,
          lastCompressionMetrics
        );

        // Guard check after async image compression
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
          return false;
        }

        const imageBase64 = prep.dataUrl;

        // Determine true reference dimensions of the displayed radiograph
        let refW = prep.originalWidth || prep.width;
        let refH = prep.originalHeight || prep.height;
        if (!refW || !refH || (refW === prep.width && lastCompressionMetrics?.originalWidth && lastCompressionMetrics.originalWidth !== prep.width)) {
          if (lastCompressionMetrics?.originalWidth && lastCompressionMetrics?.originalHeight) {
            refW = lastCompressionMetrics.originalWidth;
            refH = lastCompressionMetrics.originalHeight;
          } else if (imageDataUrl) {
            try {
              const dims = await getImageDimensionsFromDataUrl(imageDataUrl);
              refW = dims.width;
              refH = dims.height;
            } catch {
              refW = prep.width || 640;
              refH = prep.height || 480;
            }
          }
        }
        refW = refW || 640;
        refH = refH || 480;

        // Update store with compressed base64 if not already set
        if (!compressedImageBase64 || !lastCompressionMetrics?.width) {
          useAppStore.setState({
            compressedImageBase64: imageBase64,
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
            },
          });
        }

        const apiStart = performance.now();

        // Unified centralized AI service invocation
        const res = await analyzeRadiograph(imageBase64, 'pathology', {
          toothFdi: selectedTooth.fdiNumber,
          language: isEn ? 'EN' : 'VI',
          apiKeyOption,
          customApiKey,
          selectedModelA: appState.selectedModelA,
          analysisMode: appState.analysisMode,
          selectedModelB: appState.selectedModelB,
          technique: appState.selectedTechnique,
          receptorType: appState.selectedReceptor,
          assessmentId: appState.currentAssessmentId,
          validityReceipt: appState.validityReceipt || undefined,
          onStatusUpdate: (msg) => {
            if (useAppStore.getState().isAnalysisCurrent(snapshot)) {
              updateStatus(msg);
            }
          },
          externalSignal: abortRef.current?.signal,
        });

        // Guard check after async AI analysis
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
          return false;
        }

        if (!res.success || !res.pathologyResult) {
          if (!useAppStore.getState().isAnalysisCurrent(snapshot)) return false;
          handleAnalysisFlowError(
            {
              errorNotice: res.errorNotice,
              userMessage: res.userMessage,
              isCustomKeyFailed: res.isCustomKeyFailed,
              isAllExhausted: res.isAllExhausted,
              isQuotaExhausted: res.isQuotaExhausted,
              resetNotice: res.resetNotice,
              type: 'pathology',
            },
            'pathology',
            {
              language: isEn ? 'EN' : 'VI',
              context: {
                tooth: selectedTooth.fdiNumber,
                mode: appState.analysisMode,
                modelA,
              },
              snapshot,
            }
          );
          return false;
        }

        const rawPathologies = res.pathologyResult.pathologies || [];

        // Convert [y, x] normalized coordinates (0-1000) to [x, y] pixel coordinates
        const detections: AIDetection[] = rawPathologies.map((p, idx) => {
          return mapServerFindingToAIDetection(p, idx, refW, refH);
        });

        // Guard check immediately prior to mutating state
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
          return false;
        }

        const aiPredictionSnapshot = structuredClone(detections);
        setPathologyInferenceLineage(res.pathologyResult.inferenceLineage ?? null);
        setPathologyValidityAudit(res.pathologyResult.validityAudit ?? null);
        setAiDetections(aiPredictionSnapshot);
        const confirmed = detections.map((d, i) =>
          makeConfirmedPathology(structuredClone(d), { geminiVerified: true, geminiNote: rawPathologies[i]?.clinicalNote })
        );
        setConfirmedPathologies(confirmed);
        setPathologyGeminiResult({
          confirmedIds: detections.map((d) => d.id),
          rejectedIds: [],
          additionalNotes: {},
          overallSummary: res.pathologyResult.overallSummary,
          overallSummaryEn: res.pathologyResult.overallSummaryEn || res.pathologyResult.overallSummary,
        });

        const apiDurationMs = Math.round(performance.now() - apiStart);
        const totalTimeMs = Math.round(performance.now() - startTotalTime);
        const wasCached = Boolean(res.isCached);
        // No more fake network capping
        const networkTimeMs = 0;
        const geminiTimeMs = apiDurationMs;
        const clientCompressTimeMs = useAppStore.getState().lastCompressionMetrics?.processingTimeMs || 0;

        useAppStore.setState({
          lastAnalysisMetrics: {
            clientCompressTimeMs,
            networkTimeMs,
            geminiTimeMs,
            totalTimeMs,
            wasCached,
            pipeline: 'pathology',
            modelUsed: res.usedModel || (isConsensus ? 'Consensus' : modelA),
          },
        });

        setPathologyAnalysisStatus('complete');
        updateStatus('');

        // Background logging runs concurrently without blocking UI updates
        autoLogPathologyStep4(detections, confirmed).catch((logErr) => {
          console.warn('[AutoLog Pathology Step 4 Background Log Error]:', logErr);
        });
        return true;
      } catch (unknownError: unknown) {
        if (!useAppStore.getState().isAnalysisCurrent(snapshot)) {
          return false;
        }
        handleAnalysisFlowError(unknownError, 'pathology', {
          language: isEn ? 'EN' : 'VI',
          context: { tooth: selectedTooth.fdiNumber, mode: appState.analysisMode },
          snapshot,
        });
        return false;
      } finally {
        if (useAppStore.getState().isAnalysisCurrent(snapshot)) {
          const currentStatus = useAppStore.getState().pathologyAnalysisStatus;
          if (currentStatus === 'analyzing') {
            setPathologyAnalysisStatus('idle');
          }
          useAppStore.setState({
            isAnalyzing: false,
            analyzingStatusMessage: null,
          });
        }
      }
    },
    [
      imageDataUrl,
      compressedImageBase64,
      selectedTooth,
      language,
      customApiKey,
      apiKeyOption,
      setPathologyAnalysisStatus,
      updateStatus,
      setAiDetections,
      setConfirmedPathologies,
      setPathologyGeminiResult,
      setPathologyValidityAudit,
      setPathologyInferenceLineage,
      autoLogPathologyStep4,
    ]
  );

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    useAppStore.getState().invalidateActiveAnalysis();
    setPathologyAnalysisStatus('idle');
    setPathologyStatusMessage(null);
  }, [setPathologyAnalysisStatus, setPathologyStatusMessage]);

  return { runAnalysis, cancelAnalysis };
}
