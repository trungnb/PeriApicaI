import {
  ToothInfo,
  TechniqueType,
  ReceptorType,
  AIAnalysisResult,
  AIDetection,
  ErrorDomainId,
} from '../types/dental';
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
    key: string;
    confidence: number;
    polygon_points: [number, number][]; // [y, x] in 0-1000
    clinicalNote: string;
    treatmentRecommendation?: string;
  }>;
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
  userMessage?: string;
}

// ─────────────────────────────────────────────────────────────
// SCHEMA VALIDATION & CLIENT-SIDE TAXONOMY MAPPING
// ─────────────────────────────────────────────────────────────

/**
 * Explicitly checks if a string or object contains a valid JSON structure (object or array) before parsing.
 */
export function isValidJsonStructure(input: any): boolean {
  if (!input) return false;
  if (typeof input === 'object') return true;
  if (typeof input !== 'string') return false;

  let cleaned = input.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  if (cleaned.length === 0) return false;

  // Quick structural check
  const hasValidBrackets =
    (cleaned.startsWith('{') && cleaned.endsWith('}')) ||
    (cleaned.startsWith('[') && cleaned.endsWith(']')) ||
    /\{[\s\S]*\}|\[[\s\S]*\]/.test(cleaned);

  if (!hasValidBrackets) return false;

  try {
    const parsed = JSON.parse(cleaned);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return parsed !== null && typeof parsed === 'object';
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Safely parses string or object payload into a raw JSON object.
 * Strips markdown formatting (```json ... ```) and handles regex extraction if needed.
 */
export function extractJsonObject(input: any): any | null {
  if (!input) return null;
  if (typeof input === 'object') return input;
  if (!isValidJsonStructure(input)) return null;

  let cleaned = (input as string).trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validates that an object strictly adheres to DENTAL_ANALYSIS_SCHEMA structure.
 */
export function validateDentalAnalysisSchema(data: any): { isValid: boolean; parsedData?: any; errorReason?: string } {
  const obj = extractJsonObject(data);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { isValid: false, errorReason: 'AI response is not a valid JSON object' };
  }

  const analysisCandidate = obj.analysis || obj.result || obj;
  if (!analysisCandidate || typeof analysisCandidate !== 'object') {
    return { isValid: false, errorReason: 'Missing analysis object body' };
  }

  const hasPeriapical =
    typeof analysisCandidate.isPeriapicalRadiograph === 'boolean' ||
    typeof analysisCandidate.not_periapical === 'boolean' ||
    typeof analysisCandidate.isPeriapicalRadiograph === 'string';

  const hasQuality =
    typeof analysisCandidate.overallQuality === 'string' &&
    ['Diagnostic', 'Needs Retake', 'Unsatisfactory'].includes(analysisCandidate.overallQuality.trim());

  const hasErrors = Array.isArray(analysisCandidate.errors) || Array.isArray(analysisCandidate.findings);

  if (!hasPeriapical && !hasQuality && !hasErrors) {
    return {
      isValid: false,
      errorReason: 'Output lacks essential DENTAL_ANALYSIS_SCHEMA fields (isPeriapicalRadiograph, overallQuality, errors/findings)',
    };
  }

  return { isValid: true, parsedData: analysisCandidate };
}

/**
 * Validates that an object adheres to PathologySegmentResult structure.
 */
export function validatePathologySchema(data: any): { isValid: boolean; parsedData?: any; errorReason?: string } {
  const obj = extractJsonObject(data);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { isValid: false, errorReason: 'Pathology response is not a valid JSON object' };
  }

  const resultCandidate = obj.result || obj.pathologyResult || obj;
  if (!resultCandidate || typeof resultCandidate !== 'object') {
    return { isValid: false, errorReason: 'Missing pathology result body' };
  }

  const hasPathologies = Array.isArray(resultCandidate.pathologies);
  const hasSummary = typeof resultCandidate.overallSummary === 'string' || typeof resultCandidate.overallSummaryEn === 'string';

  if (!hasPathologies && !hasSummary) {
    return { isValid: false, errorReason: 'Output lacks essential Pathology schema fields (pathologies, overallSummary)' };
  }

  return { isValid: true, parsedData: resultCandidate };
}

/**
 * Validates and normalizes classic radiograph quality analysis against TECH_FAILURE_DICT.
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

  // Extract raw error items from either raw.errors or existing findings
  const extractedErrors: Array<{ errorKey: string; confidence: number; clinicalObservation?: string }> = [];

  if (Array.isArray(raw?.errors)) {
    raw.errors.forEach((err: any) => {
      const rawKey = typeof err === 'string' ? err : err?.errorKey || err?.key || '';
      const normalizedKey = normalizeTechFailureKey(rawKey);
      if (normalizedKey) {
        extractedErrors.push({
          errorKey: normalizedKey,
          confidence: typeof err?.confidence === 'number' ? Math.min(100, Math.max(0, err.confidence)) : 85,
          clinicalObservation: err?.clinicalObservation,
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
              confidence: typeof err?.confidence === 'number' ? Math.min(100, Math.max(0, err.confidence)) : 85,
              clinicalObservation: err?.clinicalObservation,
            });
          }
        });
      }
    });
  }

  // Deduplicate errors by normalized key
  const uniqueErrorsMap = new Map<string, { errorKey: string; confidence: number; clinicalObservation?: string }>();
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

  return {
    isPeriapicalRadiograph,
    overallQuality,
    observationChain: Array.isArray(raw?.observationChain) ? raw.observationChain : [],
    findings,
  };
}

/**
 * Validates and normalizes pathology 2D segmentation result against PATHOLOGY_DICT.
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
      if (Array.isArray(item.polygon_points)) {
        polygon_points = item.polygon_points
          .filter((pt: any) => Array.isArray(pt) && pt.length >= 2)
          .map((pt: [number, number]) => {
            const y = Math.max(0, Math.min(1000, Math.round(Number(pt[0]) || 0)));
            const x = Math.max(0, Math.min(1000, Math.round(Number(pt[1]) || 0)));
            return [y, x] as [number, number];
          });
      }

      // Fallback box points if polygon_points is invalid
      if (polygon_points.length < 3 && Array.isArray(item.box_2d) && item.box_2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = item.box_2d;
        polygon_points = [
          [ymin, xmin],
          [ymin, xmax],
          [ymax, xmax],
          [ymax, xmin],
        ];
      }

      const label = getPathologyLabel(rawKey, language);
      const treatment = item.treatmentRecommendation || (taxItem ? getTreatmentText(rawKey, language) : undefined);

      return {
        key: rawKey,
        confidence: typeof item.confidence === 'number' ? Math.min(100, Math.max(0, Math.round(item.confidence))) : 90,
        polygon_points,
        clinicalNote: item.clinicalNote || label,
        treatmentRecommendation: treatment,
      };
    });

  return {
    overallSummary: raw?.overallSummary || (isEn ? 'Pathology segmentation completed.' : 'Đã hoàn tất phân đoạn tổn thương.'),
    overallSummaryEn: raw?.overallSummaryEn || raw?.overallSummary || 'Pathology segmentation completed.',
    observationChain: Array.isArray(raw?.observationChain) ? raw.observationChain : [],
    pathologies: validatedPathologies,
  };
}

// ─────────────────────────────────────────────────────────────
// STREAM PROCESSOR (SSE)
// ─────────────────────────────────────────────────────────────

async function processStreamData<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  type: 'classic' | 'pathology',
  onStatusUpdate?: (status: string) => void,
  onProgress?: (text: string) => void
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

  while (!isDone) {
    const { done, value } = await reader.read();
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

        // Extract and validate candidate payload against schema
        const candidatePayload = parsed.result || parsed.analysis || parsed.text || parsed;
        const validation =
          type === 'classic'
            ? validateDentalAnalysisSchema(candidatePayload)
            : validatePathologySchema(candidatePayload);

        if (validation.isValid && validation.parsedData) {
          finalData = validation.parsedData;
          if (parsed.usedModel) usedModel = parsed.usedModel;
        } else if (parsed.text || parsed.result || parsed.analysis) {
          console.debug('[aiService] Debug: Malformed SSE payload received:', {
            reason: validation.errorReason,
            rawPayload: candidatePayload,
          });
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
        const candidatePayload = parsed.result || parsed.analysis || parsed.text || parsed;
        const validation =
          type === 'classic'
            ? validateDentalAnalysisSchema(candidatePayload)
            : validatePathologySchema(candidatePayload);
        if (validation.isValid && validation.parsedData) {
          finalData = validation.parsedData;
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
}

// ─────────────────────────────────────────────────────────────
// CENTRALIZED DISPATCHER: analyzeRadiograph
// ─────────────────────────────────────────────────────────────

/**
 * Unified radiograph analysis pipeline for Classic Quality Assessment or Pathology 2D Segmentation.
 * Encapsulates automatic retries, fallback handling, stream parsing, and schema validation.
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
          selectedModel: selectedModelA,
          selectedModelA,
          analysisMode,
          selectedModelB,
        }
      : {
          imageBase64: image,
          mimeType,
          toothFdi,
          language: isEn ? 'EN' : 'VI',
          apiKeyOption,
          customApiKey: apiKeyOption === 'custom' ? customApiKey : undefined,
          selectedModel: selectedModelA,
          selectedModelA,
          analysisMode,
          selectedModelB,
        };

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65000);

    const onAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort);
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

      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }

      const contentType = response.headers.get('content-type') || '';

      // Handle streaming SSE response
      if (contentType.includes('text/event-stream') && response.body) {
        const streamRes = await processStreamData(
          response.body.getReader(),
          type,
          onStatusUpdate,
          onProgress
        );

        if (!streamRes.success) {
          if (streamRes.isCustomKeyFailed || streamRes.isAllExhausted || streamRes.isQuotaExhausted) {
            return {
              success: false,
              type,
              isCustomKeyFailed: streamRes.isCustomKeyFailed,
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

      // Validate JSON payload
      const payloadCandidate = data.analysis || data.result || data;
      const jsonValidation =
        type === 'classic'
          ? validateDentalAnalysisSchema(payloadCandidate)
          : validatePathologySchema(payloadCandidate);

      if (!jsonValidation.isValid && attempt <= maxRetries) {
        onStatusUpdate?.(
          isEn
            ? `🔄 Retrying analysis...`
            : `🔄 Đang tự động thử lại...`
        );
        await new Promise((res) => setTimeout(res, 500));
        continue;
      }

      if (type === 'classic') {
        const validated = validateAndNormalizeClassicSchema(jsonValidation.parsedData || data.analysis || data, language);
        return {
          success: true,
          type: 'classic',
          analysis: validated,
          usedModel: data.usedModel,
          isCached: Boolean(data.isCached),
          isFallback: Boolean(data.isFallback),
        };
      } else {
        const validated = validateAndNormalizePathologySchema(jsonValidation.parsedData || data.result || data, language);
        return {
          success: true,
          type: 'pathology',
          pathologyResult: validated,
          usedModel: data.usedModel,
          isCached: Boolean(data.isCached),
        };
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
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
