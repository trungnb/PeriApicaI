/**
 * usePathologyAnalysis — Hook orchestrating Pathology Segmentation
 * Directly calls Gemini 2D Spatial Polygon Grounding API (100% Free API)
 */
import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { AIDetection, ConfirmedPathology, PathologyKey } from '../types/dental';
import { PATHOLOGY_DICT } from '../constants/dictionaries';
import { analyzeRadiograph } from '../services/aiService';
import { useAssessmentSession } from './useAssessmentSession';
import { handleAnalysisFlowError } from '../utils/errorBoundary';
import { prepareAnalysisImage } from '../utils/imageCompressor';

function makeConfirmedPathology(det: AIDetection, clinicalNote?: string): ConfirmedPathology {
  const taxItem = PATHOLOGY_DICT[det.pathologyKey];
  return {
    ...det,
    label: taxItem?.label ?? det.pathologyKey,
    labelEn: taxItem?.labelEn ?? det.pathologyKey,
    description: taxItem?.description ?? '',
    descriptionEn: taxItem?.descriptionEn ?? '',
    geminiVerified: true,
    geminiNote: clinicalNote,
    isUserEdited: false,
  };
}

export function usePathologyAnalysis() {
  const abortRef = useRef<AbortController | null>(null);
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
  const setPathologyAnalysisStatus = useAppStore((s) => s.setPathologyAnalysisStatus);
  const setPathologyStatusMessage = useAppStore((s) => s.setPathologyStatusMessage);
  const setAnalyzingStatusMessage = useAppStore((s) => s.setAnalyzingStatusMessage);

  const updateStatus = useCallback(
    (msg: string) => {
      setPathologyStatusMessage(msg);
      setAnalyzingStatusMessage(msg);
    },
    [setPathologyStatusMessage, setAnalyzingStatusMessage]
  );

  const runAnalysis = useCallback(async () => {
    if (!imageDataUrl) return;

    abortRef.current = new AbortController();
    const startTotalTime = performance.now();
    const isEn = language === 'EN';

    setPathologyAnalysisStatus('analyzing');

    const appState = useAppStore.getState();
    const isConsensus = appState.analysisMode === 'consensus';
    const modelA = appState.selectedModelA || 'gemini-flash-latest';
    const modelB = appState.selectedModelB || 'gemini-flash-lite-latest';

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
        {
          maxWidth: 1200,
          maxHeight: 1200,
          quality: 0.88,
        },
        lastCompressionMetrics
      );

      const imgW = prep.width || 640;
      const imgH = prep.height || 480;
      const imageBase64 = prep.dataUrl;

      // Update store with compressed base64 if not already set
      if (!compressedImageBase64 || !lastCompressionMetrics?.width) {
        useAppStore.setState({
          compressedImageBase64: imageBase64,
          lastCompressionMetrics: {
            processingTimeMs: prep.processingTimeMs,
            width: prep.width,
            height: prep.height,
            originalWidth: prep.originalWidth,
            originalHeight: prep.originalHeight,
            outputMime: prep.mimeType,
          } as any,
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
        onStatusUpdate: updateStatus,
        externalSignal: abortRef.current.signal,
      });

      if (!res.success || !res.pathologyResult) {
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
          }
        );
        return;
      }

      const rawPathologies = res.pathologyResult.pathologies || [];

      // Convert [y, x] normalized coordinates (0-1000) to [x, y] pixel coordinates
      const detections: AIDetection[] = rawPathologies.map((p, idx) => {
        const key = p.key as PathologyKey;
        const taxItem = PATHOLOGY_DICT[key] ?? {
          domainId: 'domain_p1',
          color: '#94a3b8',
          fillColor: 'rgba(148,163,184,0.22)',
        };

        const pixelPoints: [number, number][] = (p.polygon_points || []).map(([normY, normX]) => [
          Math.round((normX / 1000) * imgW),
          Math.round((normY / 1000) * imgH),
        ]);

        // Calculate bounding box from polygon points
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        pixelPoints.forEach(([x, y]) => {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        });

        const bbox: [number, number, number, number] = [
          minX === Infinity ? 0 : minX,
          minY === Infinity ? 0 : minY,
          maxX === -Infinity ? imgW : maxX,
          maxY === -Infinity ? imgH : maxY,
        ];

        return {
          id: `pathology_${key}_${Date.now()}_${idx}`,
          pathologyKey: key,
          domainId: taxItem.domainId,
          confidence: Math.round(p.confidence || 90),
          bbox,
          polygonPoints: pixelPoints,
          areaMm2: Math.round((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) * 0.0625),
          color: taxItem.color,
          fillColor: taxItem.fillColor,
          treatmentRecommendation: p.treatmentRecommendation,
        };
      });

      setAiDetections(detections);
      const confirmed = detections.map((d, i) =>
        makeConfirmedPathology(d, rawPathologies[i]?.clinicalNote)
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
      // NOTE (Telemetry & Quality Gate): networkTimeMs is an approximate estimate kept for UI visualization breakdown.
      // Real benchmarking must evaluate totalTimeMs and apiDurationMs.
      const networkTimeMs = wasCached ? apiDurationMs : Math.min(apiDurationMs, 1400);
      const geminiTimeMs = wasCached ? 0 : Math.max(100, apiDurationMs - networkTimeMs);
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
    } catch (unknownError: unknown) {
      handleAnalysisFlowError(unknownError, 'pathology', {
        language: isEn ? 'EN' : 'VI',
        context: { tooth: selectedTooth.fdiNumber, mode: appState.analysisMode },
      });
    }
  }, [
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
    autoLogPathologyStep4,
  ]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    setPathologyAnalysisStatus('idle');
    setPathologyStatusMessage(null);
  }, [setPathologyAnalysisStatus, setPathologyStatusMessage]);

  return { runAnalysis, cancelAnalysis };
}

