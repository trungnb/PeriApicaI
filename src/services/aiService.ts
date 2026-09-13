import {
  ToothInfo,
  TechniqueType,
  ReceptorType,
  AIAnalysisResult,
  AIDetectedError,
  AIDetection,
  ErrorDomainId,
  ImageValidityResult,
  InferenceLineage,
  ValidityReceipt,
  ValidityAuditMetadata,
} from '../types/dental';
import { validateImageValidityOutput } from '../utils/imageValidity';
import { normalizeInferenceLineage } from '../utils/inferenceLineage';
import {
  PATHOLOGY_DICT,
  TECH_FAILURE_DICT,
  normalizeTechFailureKey,
  getPathologyLabel,
  getTreatmentText,
} from '../constants/dictionaries';
import {
  TAXONOMY_ERRORS,
  getTaxonomyLabel,
  getDomainMeta,
} from '../data/taxonomyData';
import {
  PATHOLOGY_TAXONOMY,
} from '../data/pathologyTaxonomyData';
import { reportAutoSystemError } from './apiService';

export interface PathologySegmentResult {
  overallSummary: string;
  overallSummaryEn?: string;
  observationChain?: string[];
  pathologies: Array<{
    id?: string;
    key: string;
    confidence?: number;
    modelAScore?: number;
    modelBScore?: number;
    polygon_points: [number, number][]; // [y, x] in 0-1000
    geometryStatus?: 'valid' | 'unavailable' | 'malformed';
    clinicalNote: string;
    treatmentRecommendation?: string;
    provenance?: 'matched_consensus' | 'model_a_only' | 'model_b_only' | 'single_mode';
    humanReviewed?: boolean;
  }>;
  inferenceLineage?: InferenceLineage;
  validityAudit?: ValidityAuditMetadata;
}

export interface RadiographAnalysisOptions {
  tooth?: ToothInfo;
  toothFdi?: string;
  technique?: TechniqueType | string;
  receptorType?: ReceptorType | string;
  language?: 'VI' | 'EN';
  apiKeyOption?: 'system' | 'custom';
  customApiKey?: string;
  selectedModelA?: string;
  selectedModelB?: string;
  analysisMode?: 'single' | 'consensus';
  onStatusUpdate?: (status: string) => void;
  onProgress?: (text: string) => void;
  externalSignal?: AbortSignal;
  maxRetries?: number;
  /** Covers request headers, body consumption, and response parsing. */
  requestTimeoutMs?: number;
  assessmentId?: string;
  validityReceipt?: ValidityReceipt;
}

export interface UnifiedAnalysisResult {
  success: boolean;
  type: 'classic' | 'pathology';
  analysis?: AIAnalysisResult;
  pathologyResult?: PathologySegmentResult;
  detections?: AIDetection[];
  usedModel?: string;
  isCached?: boolean;
  isFallback?: boolean;
  errorNotice?: string;
  isQuotaExhausted?: boolean;
  resetNotice?: string;
  isAllExhausted?: boolean;
  isCustomKeyFailed?: boolean;
  systemApiAvailable?: boolean;
  userMessage?: string;
}

/**
 * Normalizes classic radiograph quality analysis against TECH_FAILURE_DICT.
 * Transforms raw error codes (e.g., CONE_CUT, DBL_EXP) and flat findings into robust UI-ready structures.
 */
export function validateAndNormalizeClassicSchema(
  raw: any,
  language: 'VI' | 'EN' = 'VI'
): AIAnalysisResult {
  const isEn = language === 'EN';

  const isPeriapicalRadiograph =
    typeof raw?.isPeriapicalRadiograph === 'boolean'
      ? raw.isPeriapicalRadiograph
      : raw?.not_periapical === true
      ? false
      : true;

  const validQualities = ['Diagnostic', 'Needs Retake', 'Unsatisfactory'] as const;
  let overallQuality = raw?.overallQuality;
  if (!validQualities.includes(overallQuality)) {
    overallQuality = isPeriapicalRadiograph ? 'Diagnostic' : 'Unsatisfactory';
  }

  const domainDefs: { id: ErrorDomainId; nameVi: string; nameEn: string }[] = [
    { id: 'domain_1', nameVi: 'Miền 1: Lỗi đặt bộ nhận ảnh', nameEn: 'Domain 1: Receptor Placement Errors' },
    { id: 'domain_2', nameVi: 'Miền 2: Lỗi góc độ & Hình học', nameEn: 'Domain 2: Angulation & Geometric Errors' },
    { id: 'domain_3', nameVi: 'Miền 3: Lỗi phát tia & Xử lý phim', nameEn: 'Domain 3: Exposure, Processing & Artefacts' },
  ];

  const normalizeScore = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const normalizeProvenance = (value: unknown): AIDetectedError['provenance'] | undefined =>
    value === 'matched_consensus' || value === 'model_a_only' || value === 'model_b_only' || value === 'single_mode'
      ? value
      : undefined;
  const normalizeConsensusMeta = (value: unknown): AIAnalysisResult['consensusMeta'] | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const mode = candidate.mode === 'dual_consensus' ? candidate.mode : undefined;
    const status = candidate.status === 'consensus_synthesized' ? candidate.status : undefined;
    const models = Array.isArray(candidate.models) && candidate.models.every((model) => typeof model === 'string')
      ? [...candidate.models]
      : undefined;
    return mode || status || models ? { mode, status, models } : undefined;
  };

  // Extract raw error items from either raw.errors or existing findings.
  // Preserve only server-validated dual-model metadata; never invent a value when absent.
  const extractedErrors: Array<{
    errorKey: string;
    confidence?: number;
    clinicalObservation?: string;
    modelAScore?: number;
    modelBScore?: number;
    provenance?: AIDetectedError['provenance'];
  }> = [];

  if (Array.isArray(raw?.errors)) {
    raw.errors.forEach((err: any) => {
      const rawKey = typeof err === 'string' ? err : err?.errorKey || err?.key || '';
      const normalizedKey = normalizeTechFailureKey(rawKey);
      if (normalizedKey) {
        extractedErrors.push({
          errorKey: normalizedKey,
          confidence: (typeof err?.confidence === 'number' && Number.isFinite(err.confidence)) ? Math.min(100, Math.max(0, err.confidence)) : undefined,
          clinicalObservation: err?.clinicalObservation,
          modelAScore: normalizeScore(err?.modelAScore),
          modelBScore: normalizeScore(err?.modelBScore),
          provenance: normalizeProvenance(err?.provenance),
        });
      }
    });
  } else if (Array.isArray(raw?.findings)) {
    raw.findings.forEach((finding: any) => {
      if (Array.isArray(finding?.detectedErrors)) {
        finding.detectedErrors.forEach((err: any) => {
          const rawKey = err?.errorKey || err?.key || '';
          const normalizedKey = normalizeTechFailureKey(rawKey);
          if (normalizedKey) {
            extractedErrors.push({
              errorKey: normalizedKey,
              confidence: (typeof err?.confidence === 'number' && Number.isFinite(err.confidence)) ? Math.min(100, Math.max(0, err.confidence)) : undefined,
              clinicalObservation: err?.clinicalObservation,
              modelAScore: normalizeScore(err?.modelAScore),
              modelBScore: normalizeScore(err?.modelBScore),
              provenance: normalizeProvenance(err?.provenance),
            });
          }
        });
      }
    });
  }

  // Deduplicate errors by normalized key
  const uniqueErrorsMap = new Map<string, typeof extractedErrors[number]>();
  extractedErrors.forEach((err) => {
    if (!uniqueErrorsMap.has(err.errorKey)) {
      uniqueErrorsMap.set(err.errorKey, err);
    }
  });

  const uniqueErrors = Array.from(uniqueErrorsMap.values());
  const aiNotes = raw?.anomalyNote || raw?.ai_notes || '';

  // Construct standardized 3-domain findings using TECH_FAILURE_DICT
  const findings = domainDefs.map((dom) => {
    const meta = getDomainMeta(dom.id, language) || {
      name: isEn ? dom.nameEn : dom.nameVi,
      description: isEn ? 'Evaluation of domain criteria.' : 'Đánh giá các tiêu chí theo miền.',
    };

    const domErrors = uniqueErrors
      .filter((err) => {
        const item = TECH_FAILURE_DICT[err.errorKey] || TAXONOMY_ERRORS.find((t) => t.key === err.errorKey);
        return item && item.domainId === dom.id;
      })
      .map((err) => {
        const item = TECH_FAILURE_DICT[err.errorKey] || TAXONOMY_ERRORS.find((t) => t.key === err.errorKey);
        const localizedLabel = getTaxonomyLabel(err.errorKey, language) || (item ? (isEn ? item.labelEn || item.label : item.label) : err.errorKey);
        const localizedDesc = item ? (isEn ? item.descriptionEn || item.description : item.description) : '';
        const clinicalObs = err.clinicalObservation || (aiNotes ? `${localizedDesc} (${aiNotes})` : localizedDesc);

        return {
          errorKey: err.errorKey,
          errorName: localizedLabel,
          confidence: err.confidence,
          clinicalObservation: clinicalObs || (isEn ? 'Radiographic technical error.' : 'Phát hiện lỗi kỹ thuật phim.'),
          ...(err.modelAScore !== undefined ? { modelAScore: err.modelAScore } : {}),
          ...(err.modelBScore !== undefined ? { modelBScore: err.modelBScore } : {}),
          ...(err.provenance ? { provenance: err.provenance } : {}),
        };
      });

    const hasErrors = domErrors.length > 0;
    return {
      domainId: dom.id,
      domainName: meta.name,
      hasErrors,
      domainSummary: hasErrors
        ? (isEn ? 'Technical errors identified in this domain.' : 'Phát hiện lỗi kỹ thuật ở miền này.')
        : (isEn ? 'No technical errors identified in this domain.' : 'Không phát hiện lỗi kỹ thuật ở miền này.'),
      detectedErrors: domErrors,
    };
  });

  const consensusMeta = normalizeConsensusMeta(raw?.consensusMeta);
  const inferenceLineage = normalizeInferenceLineage(raw?.inferenceLineage, 'technical');

  return {
    isPeriapicalRadiograph,
    overallQuality,
    observationChain: Array.isArray(raw?.observationChain) ? raw.observationChain : [],
    findings,
    ...(consensusMeta ? { consensusMeta } : {}),
    ...(inferenceLineage ? { inferenceLineage } : {}),
    ...(raw?.validityAudit && typeof raw.validityAudit === 'object' ? { validityAudit: raw.validityAudit as ValidityAuditMetadata } : {}),
  };
}

/**
 * Normalizes pathology 2D segmentation result against PATHOLOGY_DICT.
 * Ensures polygon points are clamped in [0, 1000] and clinical recommendations are populated.
 */
export function validateAndNormalizePathologySchema(
  raw: any,
  language: 'VI' | 'EN' = 'VI'
): PathologySegmentResult {
  const isEn = language === 'EN';
  const pathologiesRaw = Array.isArray(raw?.pathologies) ? raw.pathologies : [];

  const validatedPathologies = pathologiesRaw
    .filter((item: any) => item && (item.key || item.pathologyKey))
    .map((item: any) => {
      const rawKey = String(item.key || item.pathologyKey).trim();
      const taxItem = PATHOLOGY_DICT[rawKey] || PATHOLOGY_TAXONOMY.find((p) => p.key === rawKey);

      // Validate polygon points
      let polygon_points: [number, number][] = [];
      let geometryStatus: 'valid' | 'unavailable' | 'malformed' = item.geometryStatus || 'unavailable';

      const rawPoints = item.polygon_points || item.polygonPoints;
      if (Array.isArray(rawPoints) && rawPoints.length > 0) {
        const cleaned: [number, number][] = [];
        for (const pt of rawPoints) {
          if (Array.isArray(pt) && pt.length >= 2) {
            const y = Number(pt[0]);
            const x = Number(pt[1]);
            if (Number.isFinite(y) && Number.isFinite(x) && !Number.isNaN(y) && !Number.isNaN(x)) {
              cleaned.push([
                Math.max(0, Math.min(1000, Math.round(y))),
                Math.max(0, Math.min(1000, Math.round(x))),
              ]);
            }
          }
        }
        if (cleaned.length >= 3) {
          polygon_points = cleaned;
          geometryStatus = 'valid';
        } else {
          polygon_points = [];
          geometryStatus = 'malformed';
        }
      } else {
        polygon_points = [];
        geometryStatus = 'unavailable';
      }

      const label = getPathologyLabel(rawKey, language);
      const treatment = item.treatmentRecommendation || (taxItem ? getTreatmentText(rawKey, language) : undefined);

      return {
        ...(typeof item.id === 'string' && item.id.trim() ? { id: item.id.trim() } : {}),
        key: rawKey,
        confidence: (typeof item.confidence === 'number' && Number.isFinite(item.confidence)) ? Math.min(100, Math.max(0, Math.round(item.confidence))) : undefined,
        modelAScore: typeof item.modelAScore === 'number' ? item.modelAScore : undefined,
        modelBScore: typeof item.modelBScore === 'number' ? item.modelBScore : undefined,
        polygon_points,
        geometryStatus,
        clinicalNote: item.clinicalNote || label,
        treatmentRecommendation: treatment,
        provenance: item.provenance,
        humanReviewed: item.humanReviewed,
      };
    });

  const inferenceLineage = normalizeInferenceLineage(raw?.inferenceLineage, 'pathology');
  return {
    overallSummary: raw?.overallSummary || (isEn ? 'Pathology segmentation completed.' : 'Đã hoàn tất phân đoạn tổn thương.'),
    overallSummaryEn: raw?.overallSummaryEn || raw?.overallSummary || 'Pathology segmentation completed.',
    observationChain: Array.isArray(raw?.observationChain) ? raw.observationChain : [],
    pathologies: validatedPathologies,
    ...(inferenceLineage ? { inferenceLineage } : {}),
    ...(raw?.validityAudit && typeof raw.validityAudit === 'object' ? { validityAudit: raw.validityAudit as ValidityAuditMetadata } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// STREAM PROCESSOR (SSE)
// ─────────────────────────────────────────────────────────────

function createAbortError(): Error {
  const error = new Error('Request was cancelled or timed out.');
  error.name = 'AbortError';
  return error;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw createAbortError();

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function processStreamData(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  type: 'classic' | 'pathology',
  onStatusUpdate?: (status: string) => void,
  onProgress?: (text: string) => void,
  signal?: AbortSignal,
): Promise<{
  success: boolean;
  data?: any;
  usedModel?: string;
  isAllExhausted?: boolean;
  isQuotaExhausted?: boolean;
  isCustomKeyFailed?: boolean;
  isMalformedOutput?: boolean;
  userMessage?: string;
  resetNotice?: string;
  errorNotice?: string;
  systemApiAvailable?: boolean;
}> {
  const decoder = new TextDecoder();
  let streamBuffer = '';
  let finalData: any = null;
  let usedModel: string | undefined = undefined;
  let customKeyError: any = null;
  let allExhaustedError: any = null;
  let errorMsg: string | null = null;
  let userErrMsg: string | null = null;
  let isCached = false;
  let isDone = false;

  try {
    while (!isDone) {
      const { done, value } = signal
        ? await readStreamChunk(reader, signal)
        : await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const rawData = trimmed.slice(6).trim();

        if (rawData === '[DONE]') {
          isDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(rawData);

        if (parsed.isCached) {
          isCached = true;
        }

        if (parsed.statusMessage) {
          onStatusUpdate?.(parsed.statusMessage);
        }

        if (parsed.usedModel) {
          usedModel = parsed.usedModel;
        }

        if (parsed.chunk && onProgress) {
          onProgress(parsed.chunk);
        }

        if (parsed.isCustomKeyFailed || parsed.errorType === 'CUSTOM_KEY_FAILED') {
          customKeyError = {
            isCustomKeyFailed: true,
            userMessage: parsed.userMessage || 'Custom API Key failed validation or exceeded quota.',
            errorNotice: parsed.errorNotice || parsed.error,
            systemApiAvailable: typeof parsed.systemApiAvailable === 'boolean' ? parsed.systemApiAvailable : undefined,
          };
        } else if (parsed.isQuotaExhausted || parsed.isAllExhausted || parsed.errorType === 'ALL_EXHAUSTED') {
          allExhaustedError = {
            isAllExhausted: true,
            userMessage: parsed.userMessage || 'System API trial limit exhausted.',
            resetNotice: parsed.resetNotice || '1 minute',
          };
        } else if (parsed.errorType === 'TRANSIENT' || parsed.success === false) {
          errorMsg = parsed.error || parsed.errorNotice || 'Analysis timed out or temporary connection error.';
          userErrMsg = parsed.userMessage || null;
        }

        if (parsed.success === false && !parsed.statusMessage && !errorMsg) {
          errorMsg = parsed.userMessage || parsed.error || parsed.errorNotice || 'Analysis failed.';
        }

        const candidatePayload = parsed.result || parsed.analysis ||
          (typeof parsed.text === 'string' ? JSON.parse(parsed.text) : parsed.text);
        if (candidatePayload && typeof candidatePayload === 'object' && !Array.isArray(candidatePayload)) {
          finalData = candidatePayload;
          if (parsed.usedModel) usedModel = parsed.usedModel;
        }
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }

    // Check remaining buffer
    if (!finalData && streamBuffer.trim().startsWith('data: ')) {
    const rawData = streamBuffer.trim().slice(6).trim();
    if (rawData !== '[DONE]') {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.isCached) isCached = true;
        const candidatePayload = parsed.result || parsed.analysis ||
          (typeof parsed.text === 'string' ? JSON.parse(parsed.text) : parsed.text);
        if (candidatePayload && typeof candidatePayload === 'object' && !Array.isArray(candidatePayload)) {
          finalData = candidatePayload;
        }
      } catch {
        // ignore
      }
    }
    }

    if (customKeyError) {
    return {
      success: false,
      isCustomKeyFailed: true,
      userMessage: customKeyError.userMessage,
      errorNotice: customKeyError.errorNotice,
      systemApiAvailable: customKeyError.systemApiAvailable,
    };
    }

    if (allExhaustedError) {
    return {
      success: false,
      isAllExhausted: true,
      isQuotaExhausted: true,
      userMessage: allExhaustedError.userMessage,
      resetNotice: allExhaustedError.resetNotice,
    };
    }

    if (finalData) {
    if (isCached && typeof finalData === 'object') {
      finalData.isCached = true;
    }
    return {
      success: true,
      data: finalData,
      usedModel: finalData.usedModel || usedModel,
    };
    }

    console.debug('[aiService] Debug: Stream finished without valid structured AI output. Buffer content:', streamBuffer);

    return {
      success: false,
      isMalformedOutput: true,
      userMessage: userErrMsg || undefined,
      errorNotice: errorMsg || 'No structured output received from AI.',
    };
  } finally {
    // A stream can end with [DONE], EOF, timeout, or external cancellation.
    // Releasing it in every case prevents a hung reader from retaining work.
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best-effort after a transport-level abort.
    }
    try {
      reader.releaseLock();
    } catch {
      // Reader may already have released its lock.
    }
  }
}

// ─────────────────────────────────────────────────────────────
// CENTRALIZED DISPATCHER: analyzeRadiograph
// ─────────────────────────────────────────────────────────────

/**
 * Unified radiograph analysis pipeline for Classic Quality Assessment or Pathology 2D Segmentation.
 * Encapsulates automatic retries, fallback handling, and stream parsing.
 */
export async function analyzeRadiograph(
  image: string,
  type: 'classic' | 'pathology',
  options: RadiographAnalysisOptions = {}
): Promise<UnifiedAnalysisResult> {
  const {
    tooth,
    toothFdi = tooth?.fdiNumber || '11',
    technique = 'Paralleling',
    receptorType = 'Digital Sensor',
    language = 'VI',
    apiKeyOption = 'system',
    customApiKey,
    selectedModelA,
    selectedModelB,
    analysisMode = 'single',
    onStatusUpdate,
    onProgress,
    externalSignal,
    maxRetries = 1,
    requestTimeoutMs = 65000,
    assessmentId,
    validityReceipt,
  } = options;

  const isEn = language === 'EN';
  const endpoint = type === 'classic' ? '/api/analyze-radiograph' : '/api/segment-pathology';
  const mimeType = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

  const requestPayload =
    type === 'classic'
      ? {
          imageBase64: image,
          tooth: tooth || { fdiNumber: toothFdi, arch: 'Maxilla', quadrant: 1, type: 'Incisor', name: `Tooth ${toothFdi}` },
          technique,
          receptorType,
          outputLanguage: isEn ? 'EN' : 'VI',
          language: isEn ? 'EN' : 'VI',
          apiKeyOption,
          customApiKey: apiKeyOption === 'custom' ? customApiKey : undefined,
          selectedModel: selectedModelA || undefined,
          selectedModelA: selectedModelA || undefined,
          analysisMode,
          selectedModelB: selectedModelB || undefined,
          assessmentId,
          validityReceipt,
        }
      : {
          imageBase64: image,
          mimeType,
          toothFdi,
          language: isEn ? 'EN' : 'VI',
          apiKeyOption,
          customApiKey: apiKeyOption === 'custom' ? customApiKey : undefined,
          selectedModel: selectedModelA || undefined,
          selectedModelA: selectedModelA || undefined,
          analysisMode,
          selectedModelB: selectedModelB || undefined,
          technique,
          receptorType,
          assessmentId,
          validityReceipt,
        };

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onAbort);
    }

    try {
      if (attempt > 1) {
        onStatusUpdate?.(
          isEn
            ? `🔄 Re-attempting connection (Attempt ${attempt}/${maxRetries + 1})...`
            : `🔄 Đang thử lại kết nối (Lần ${attempt}/${maxRetries + 1})...`
        );
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';

      // Handle streaming SSE response
      if (contentType.includes('text/event-stream') && response.body) {
        const streamRes = await processStreamData(
          response.body.getReader(),
          type,
          onStatusUpdate,
          onProgress,
          controller.signal,
        );

        if (!streamRes.success) {
          if (streamRes.isCustomKeyFailed || streamRes.isAllExhausted || streamRes.isQuotaExhausted) {
            return {
              success: false,
              type,
              isCustomKeyFailed: streamRes.isCustomKeyFailed,
              systemApiAvailable: streamRes.systemApiAvailable,
              isAllExhausted: streamRes.isAllExhausted,
              isQuotaExhausted: streamRes.isQuotaExhausted,
              userMessage: streamRes.userMessage,
              resetNotice: streamRes.resetNotice,
              errorNotice: streamRes.errorNotice,
            };
          }

          // Non-transient malformed stream: retry only once if budget allows
          if (attempt <= maxRetries) {
            onStatusUpdate?.(
              isEn
                ? `🔄 Retrying analysis...`
                : `🔄 Đang thử lại kết nối...`
            );
            await new Promise((res) => setTimeout(res, 500));
            continue;
          }

          return {
            success: false,
            type,
            userMessage: streamRes.userMessage,
            errorNotice: streamRes.errorNotice || 'Analysis failed',
          };
        } else {
          const rawData = streamRes.data;
          if (type === 'classic') {
            const validated = validateAndNormalizeClassicSchema(rawData, language);
            return {
              success: true,
              type: 'classic',
              analysis: validated,
              usedModel: streamRes.usedModel || rawData.usedModel,
              isCached: Boolean(rawData.isCached),
              isFallback: Boolean(rawData.isFallback),
            };
          } else {
            const validated = validateAndNormalizePathologySchema(rawData, language);
            return {
              success: true,
              type: 'pathology',
              pathologyResult: validated,
              usedModel: streamRes.usedModel || rawData.usedModel,
              isCached: Boolean(rawData.isCached),
            };
          }
        }
      }

      // Handle standard JSON response
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        const isCustomKeyFailed = Boolean(data.isCustomKeyFailed || data.errorType === 'CUSTOM_KEY_FAILED');
        const isAllExhausted = Boolean(data.isAllExhausted || data.errorType === 'ALL_EXHAUSTED' || response.status === 429);
        const isQuotaExhausted = Boolean(data.isQuotaExhausted || response.status === 429);

        // If it's a definitive key/quota/auth error, do not retry
        if (isCustomKeyFailed || isAllExhausted || response.status === 400 || response.status === 401 || response.status === 429) {
          return {
            success: false,
            type,
            isCustomKeyFailed,
            systemApiAvailable: typeof data.systemApiAvailable === 'boolean' ? data.systemApiAvailable : undefined,
            isAllExhausted,
            isQuotaExhausted,
            userMessage: data.userMessage,
            resetNotice: data.resetNotice,
            errorNotice: data.error || data.errorNotice,
          };
        }

        // Transient failure: trigger retry if attempts remain
        if (attempt <= maxRetries) {
          onStatusUpdate?.(
            isEn
              ? `🔄 Retrying server connection...`
              : `🔄 Đang thử lại kết nối máy chủ...`
          );
          await new Promise((res) => setTimeout(res, 500));
          continue;
        }

        return {
          success: false,
          type,
          errorNotice: data.userMessage || data.error || `HTTP ${response.status}`,
        };
      }

      const payloadCandidate = data.analysis || data.result || data;

      if (type === 'classic') {
        const validated = validateAndNormalizeClassicSchema(payloadCandidate, language);
        return {
          success: true,
          type: 'classic',
          analysis: validated,
          usedModel: data.usedModel,
          isCached: Boolean(data.isCached),
          isFallback: Boolean(data.isFallback),
        };
      } else {
        const validated = validateAndNormalizePathologySchema(payloadCandidate, language);
        return {
          success: true,
          type: 'pathology',
          pathologyResult: validated,
          usedModel: data.usedModel,
          isCached: Boolean(data.isCached),
        };
      }
    } catch (err: any) {
      lastError = err;

      if (err.name === 'AbortError') {
        return {
          success: false,
          type,
          errorNotice: isEn ? 'Request was cancelled or timed out.' : 'Yêu cầu đã bị hủy hoặc hết thời gian chờ.',
        };
      }

      // Retry transient network errors once
      if (attempt <= maxRetries) {
        console.debug(`[aiService] Debug: Transient network error on attempt ${attempt}:`, err?.message);
        await new Promise((res) => setTimeout(res, 500));
      }
    } finally {
      // Keep timeout and external cancellation alive through headers, SSE body
      // consumption, and JSON parsing. Clean them only after this attempt.
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  }

  // Automatic background system bug reporting for unexpected network failures
  reportAutoSystemError(
    `Network or schema failure in aiService.analyzeRadiograph: ${lastError?.message || 'No structured output received'}`,
    { type, toothFdi, analysisMode, apiKeyOption, stack: lastError?.stack }
  );

  return {
    success: false,
    type,
    errorNotice: lastError?.message || (isEn ? 'Analysis failed. Please try again.' : 'Phân tích thất bại. Vui lòng thử lại.'),
  };
}

// ─── R4: Pre-Analysis Image Validity Client Dispatcher ───────────

export interface ValidateImageOptions {
  image: string;
  toothFdi: string;
  language?: 'VI' | 'EN';
  apiKeyOption?: 'system' | 'custom';
  customApiKey?: string;
  preferredModel?: string;
  onStatusUpdate?: (status: string) => void;
  externalSignal?: AbortSignal;
  assessmentId: string;
  technique: TechniqueType;
  receptorType: ReceptorType;
}

export interface UnifiedValidityResponse {
  success: boolean;
  validity?: ImageValidityResult;
  usedModel?: string;
  durationMs?: number;
  isUnavailable?: boolean;
  isCustomKeyFailed?: boolean;
  isQuotaExhausted?: boolean;
  errorType?: string;
  errorNotice?: string;
  userMessage?: string;
  validityReceipt?: ValidityReceipt;
  validityConfirmationToken?: string;
}

/**
 * Dispatches pre-flight image validity and FDI alignment check before main analysis.
 */
export async function validateRadiographImage(
  options: ValidateImageOptions
): Promise<UnifiedValidityResponse> {
  const {
    image,
    toothFdi,
    language = 'VI',
    apiKeyOption = 'system',
    customApiKey,
    preferredModel,
    onStatusUpdate,
    externalSignal,
    assessmentId,
    technique,
    receptorType,
  } = options;

  const isEn = language === 'EN';
  onStatusUpdate?.(
    isEn ? '🔍 Verifying image validity and tooth alignment...' : '🔍 Đang kiểm tra tính hợp lệ của ảnh và vị trí răng...'
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 40000);

  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort);
  }

  try {
    const response = await fetch('/api/validate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: image,
        toothFdi,
        assessmentId,
        technique,
        receptorType,
        language: isEn ? 'EN' : 'VI',
        apiKeyOption,
        customApiKey: apiKeyOption === 'custom' ? customApiKey : undefined,
        ...(preferredModel ? { preferredModel } : {}),
      }),
      signal: controller.signal,
    });


    const data = await new Promise<any>((resolve, reject) => {
      if (controller.signal.aborted) { reject(createAbortError()); return; }
      const abort = () => reject(createAbortError());
      controller.signal.addEventListener('abort', abort, { once: true });
      response.json().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    });
    if (controller.signal.aborted) throw createAbortError();

    if (!response.ok || data.success === false) {
      return {
        success: false,
        isUnavailable: true,
        isCustomKeyFailed: Boolean(data.errorType === 'CUSTOM_KEY_FAILED' || data.isCustomKeyFailed),
        isQuotaExhausted: Boolean(data.errorType === 'QUOTA_EXHAUSTED' || data.isQuotaExhausted || response.status === 429),
        errorType: data.errorType || 'VALIDITY_SERVICE_UNAVAILABLE',
        errorNotice: data.error || data.errorNotice || 'Validity service error',
        userMessage: data.userMessage || (isEn ? 'Unable to verify image validity at this time.' : 'Không thể kiểm tra tính hợp lệ của ảnh lúc này.'),
      };
    }

    const validated = validateImageValidityOutput(data.validity);
    if (!validated) {
      return {
        success: false,
        isUnavailable: true,
        errorType: 'MALFORMED_OUTPUT',
        errorNotice: 'Malformed validity output from model',
        userMessage: isEn ? 'Validity model returned unexpected format.' : 'Mô hình AI kiểm tra ảnh trả về định dạng không đúng.',
      };
    }

    return {
      success: true,
      validity: validated,
      usedModel: data.usedModel,
      durationMs: data.durationMs,
      validityReceipt: typeof data.validityReceipt === 'string' ? data.validityReceipt : undefined,
      validityConfirmationToken: typeof data.validityConfirmationToken === 'string' ? data.validityConfirmationToken : undefined,
    };
  } catch (err: any) {

    if (err.name === 'AbortError') {
      return {
        success: false,
        isUnavailable: true,
        errorType: 'ABORTED',
        errorNotice: isEn ? 'Image validation request cancelled or timed out.' : 'Yêu cầu kiểm tra ảnh đã bị hủy hoặc quá thời gian.',
        userMessage: isEn ? 'Validation request timed out.' : 'Hết thời gian chờ kiểm tra ảnh.',
      };
    }

    return {
      success: false,
      isUnavailable: true,
      errorType: 'NETWORK_ERROR',
      errorNotice: err?.message || 'Network error during validity pre-flight',
      userMessage: isEn ? 'Network error during image validation.' : 'Lỗi kết nối mạng khi kiểm tra tính hợp lệ của ảnh.',
    };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

export async function confirmValidityReceipt(options: {
  image: string;
  toothFdi: string;
  assessmentId: string;
  technique: TechniqueType;
  receptorType: ReceptorType;
  action: 'user_confirmed' | 'prototype_override';
  validityConfirmationToken?: string;
  externalSignal?: AbortSignal;
}): Promise<{ success: boolean; validityReceipt?: ValidityReceipt }> {
  try {
    const response = await fetch('/api/confirm-validity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: options.externalSignal,
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.success === true && typeof data.validityReceipt === 'string'
      ? { success: true, validityReceipt: data.validityReceipt }
      : { success: false };
  } catch {
    return { success: false };
  }
}
