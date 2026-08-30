import { GoogleGenAI, Type } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { serverLog } from '../config/env';
import { normalizeTechFailureKey, TECH_FAILURE_DICT } from '../../constants/dictionaries';
import { TAXONOMY_ERRORS } from '../../data/taxonomyData';

// Analysis LRU Cache to avoid duplicate Gemini API calls for identical requests
export const analysisCache = new LRUCache<string, any>({
  max: 200,
  ttl: 1000 * 60 * 60 * 24, // 24 Hours TTL
});

export function getApiKeySources(): { key: string; isBackup: boolean }[] {
  const sources: { key: string; isBackup: boolean }[] = [];
  
  let zknjghtKey = process.env.zknjght_key ? process.env.zknjght_key.trim() : '';
  if ((zknjghtKey.startsWith("'") && zknjghtKey.endsWith("'")) || (zknjghtKey.startsWith('"') && zknjghtKey.endsWith('"'))) {
    zknjghtKey = zknjghtKey.slice(1, -1).trim();
  }

  let geminiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  if (!geminiKey && process.env.API_KEY) {
    geminiKey = process.env.API_KEY.trim();
  }
  if ((geminiKey.startsWith("'") && geminiKey.endsWith("'")) || (geminiKey.startsWith('"') && geminiKey.endsWith('"'))) {
    geminiKey = geminiKey.slice(1, -1).trim();
  }

  // Priority 1: Primary secret key zknjght_key
  if (zknjghtKey) {
    sources.push({ key: zknjghtKey, isBackup: false });
  }

  // Priority 2: Fallback GEMINI_API_KEY
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY' && geminiKey !== zknjghtKey) {
    sources.push({ key: geminiKey, isBackup: sources.length > 0 });
  }

  return sources;
}

export function createAiClient(apiKey: string): GoogleGenAI {
  // Set explicit 55s timeout so that requests don't hang indefinitely while staying safely under client abort (65s)
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 55000 } });
}

// Nguồn thông tin chuẩn duy nhất (Single Source of Truth) cho các mô hình chẩn đoán nha khoa khả dụng
export const AVAILABLE_MODELS = [
  { id: 'gemini-flash-latest', displayName: 'Gemini Flash (Tiêu chuẩn - Ưu tiên 1)' },
  { id: 'gemini-pro-latest', displayName: 'Gemini Pro (Lý luận sâu - Ưu tiên 2)' },
  { id: 'gemini-flash-lite-latest', displayName: 'Gemini Flash-Lite (Tốc độ cao & Tiết kiệm)' },
];

// Hàm này được giữ lại dưới dạng bất đồng bộ (async) để không phá vỡ logic các API Router/UI đang kết nối
export async function getAvailableVisionModels(customApiKey?: string): Promise<Array<{ id: string; displayName: string }>> {
  return AVAILABLE_MODELS;
}

export function isRateLimitOrQuotaError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.status || err.statusCode || err.error?.code || err.error?.status;
  if (code === 429 || code === '429' || code === 'RESOURCE_EXHAUSTED') return true;
  const str = (err.message || err.error?.message || String(err) || JSON.stringify(err)).toLowerCase();
  return (
    str.includes('429') ||
    str.includes('quota') ||
    str.includes('resource_exhausted') ||
    str.includes('rate limit') ||
    str.includes('exceeded your current quota')
  );
}

export function isInvalidApiKeyError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.status || err.statusCode || err.error?.code || err.error?.status;
  if (code === 401 || code === '401' || code === 'UNAUTHENTICATED') return true;
  const str = (err.message || err.error?.message || String(err) || JSON.stringify(err)).toLowerCase();
  return (
    str.includes('api_key_invalid') ||
    str.includes('api key not valid') ||
    str.includes('unauthenticated') ||
    (code === 400 && str.includes('key'))
  );
}

export function isTransientError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.status || err.statusCode || err.error?.code || err.error?.status;
  if (
    code === 503 ||
    code === '503' ||
    code === 502 ||
    code === '502' ||
    code === 504 ||
    code === '504' ||
    code === 'UNAVAILABLE' ||
    code === 'OVERLOADED' ||
    code === 'DEADLINE_EXCEEDED'
  ) {
    return true;
  }
  const str = (err.message || err.error?.message || String(err) || JSON.stringify(err)).toLowerCase();
  return (
    str.includes('503') ||
    str.includes('502') ||
    str.includes('504') ||
    str.includes('high demand') ||
    str.includes('deadline') ||
    str.includes('unavailable') ||
    str.includes('overloaded') ||
    str.includes('temporarily') ||
    str.includes('timeout')
  );
}

async function executeRunnerWithRetry<T>(
  runner: (aiClient: GoogleGenAI, modelName: string) => Promise<T>,
  aiClient: GoogleGenAI,
  model: string,
  maxAttempts = 2,
  onStatusUpdate?: (status: string) => void
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await runner(aiClient, model);
    } catch (err: any) {
      attempt++;
      const isInvalidKey = isInvalidApiKeyError(err);
      const isQuota = isRateLimitOrQuotaError(err);
      // Immediately throw on 401 unauthenticated or 429 quota errors to failover to next key/model
      if (isInvalidKey || isQuota || attempt >= maxAttempts) {
        throw err;
      }
      const jitterMs = 200 + Math.floor(Math.random() * 200);
      const msg = `⚠️ Model [${model}] tạm bận, thử lại lần ${attempt}...`;
      serverLog('WARN', 'GeminiService', `Transient error on model [${model}] (Attempt ${attempt}/${maxAttempts}). Retrying in ${jitterMs}ms...`);
      onStatusUpdate?.(msg);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }
  }
}

export async function executeWithFailover<T>(
  runner: (aiClient: GoogleGenAI, modelName: string) => Promise<T>,
  preferredModel?: string,
  customApiKey?: string,
  onStatusUpdate?: (status: string) => void
): Promise<{ result: T; usedModel: string; usedKeyType: string }> {
  if (customApiKey && customApiKey.trim()) {
    const cleanCustomKey = customApiKey.trim();
    const aiClient = createAiClient(cleanCustomKey);
    const modelsToTry = Array.from(new Set([
      preferredModel,
      ...AVAILABLE_MODELS.map(m => m.id)
    ].filter(Boolean) as string[]));

    let lastError: any = null;
    let wasQuota = false;
    let wasInvalidKey = false;
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        onStatusUpdate?.(`🔬 Đang phân tích bằng API Key cá nhân [${model}]...`);
        const result = await executeRunnerWithRetry(runner, aiClient, model, 2, onStatusUpdate);
        return { result, usedModel: model, usedKeyType: 'custom_byok' };
      } catch (err: any) {
        lastError = err;
        serverLog('WARN', 'GeminiService', `BYOK call failed on model ${model}:`, err?.message || err);
        if (isInvalidApiKeyError(err)) {
          wasInvalidKey = true;
          break;
        }
        if (isRateLimitOrQuotaError(err)) {
          wasQuota = true;
          const nextModel = modelsToTry[i + 1];
          if (nextModel) {
            onStatusUpdate?.(`🔄 Model [${model}] chạm hạn mức, chuyển sang [${nextModel}]...`);
          }
        }
      }
    }
    const customErrMsg = wasInvalidKey
      ? 'CUSTOM_KEY_INVALID: API Key cá nhân không hợp lệ.'
      : wasQuota
      ? 'CUSTOM_KEY_QUOTA_EXHAUSTED: API Key cá nhân của bạn đã vượt quá hạn mức (Quota).'
      : `Custom API Key failed: ${lastError?.message || 'Quota or permission error'}`;
    const customErr: any = new Error(customErrMsg);
    customErr.isCustomKeyFailed = true;
    customErr.isQuotaExhausted = wasQuota;
    customErr.isInvalidKey = wasInvalidKey;
    customErr.isTransient = isTransientError(lastError);
    customErr.originalError = lastError;
    throw customErr;
  }

  const keySources = getApiKeySources();
  if (keySources.length === 0) {
    throw new Error('No system API keys configured (zknjght_key or GEMINI_API_KEY).');
  }

  const modelsToTry = Array.from(new Set([
    preferredModel,
    ...AVAILABLE_MODELS.map(m => m.id)
  ].filter(Boolean) as string[]));

  let lastError: any = null;
  let allQuotaExhausted = true;

  for (let k = 0; k < keySources.length; k++) {
    const source = keySources[k];
    const aiClient = createAiClient(source.key);
    const keyLabel = source.isBackup ? 'GEMINI_API_KEY (Backup)' : 'zknjght_key (Primary)';
    let keyQuotaExhausted = false;
    let keyInvalid = false;
    let anyModelSucceeded = false;

    if (source.isBackup) {
      onStatusUpdate?.(`🔑 Chuyển sang Khóa API hệ thống dự phòng...`);
    }

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        serverLog('INFO', 'GeminiService', `Executing AI request with key [${keyLabel}] on model [${model}]`);
        onStatusUpdate?.(`🔬 Đang kết nối tới AI Model [${model}]...`);
        const result = await executeRunnerWithRetry(runner, aiClient, model, 2, onStatusUpdate);
        anyModelSucceeded = true;
        return { result, usedModel: model, usedKeyType: keyLabel };
      } catch (err: any) {
        lastError = err;
        const isQuota = isRateLimitOrQuotaError(err);
        const isInvalidKey = isInvalidApiKeyError(err);
        
        if (isQuota || isInvalidKey) {
          serverLog('INFO', 'GeminiService', `Key [${keyLabel}] unavailable on model [${model}] (quotaExhausted=${isQuota}, invalidKey=${isInvalidKey}). Failing over...`);
        } else {
          serverLog('WARN', 'GeminiService', `Execution failed with key [${keyLabel}] on model [${model}]:`, err?.message || err);
        }

        if (isInvalidKey) {
          keyInvalid = true;
          break;
        }

        if (isQuota) {
          keyQuotaExhausted = true;
          const nextModel = modelsToTry[i + 1];
          if (nextModel) {
            onStatusUpdate?.(`🔄 Model [${model}] chạm hạn mức, tự động chuyển sang [${nextModel}]...`);
          }
        } else {
          allQuotaExhausted = false;
          const nextModel = modelsToTry[i + 1];
          if (nextModel) {
            onStatusUpdate?.(`🔄 Model [${model}] không phản hồi, tự động chuyển sang [${nextModel}]...`);
          }
        }
      }
    }

    if (!anyModelSucceeded && !keyQuotaExhausted && !keyInvalid) {
      allQuotaExhausted = false;
    }
  }

  const isLastTransient = isTransientError(lastError);
  const overallMsg = allQuotaExhausted
    ? 'ALL_SYSTEM_KEYS_QUOTA_EXHAUSTED: Tất cả các khóa API hệ thống đều đã chạm ngưỡng hạn mức (Quota).'
    : `All system API keys and model fallbacks exhausted. Last error: ${lastError?.message || 'Unknown error'}`;

  const overallErr: any = new Error(overallMsg);
  overallErr.isAllExhausted = allQuotaExhausted;
  overallErr.isQuotaExhausted = allQuotaExhausted;
  overallErr.isTransient = !allQuotaExhausted && isLastTransient;
  overallErr.originalError = lastError;
  throw overallErr;
}

export const DENTAL_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isPeriapicalRadiograph: {
      type: Type.BOOLEAN,
      description: 'True if genuine periapical radiograph.',
    },
    overallQuality: {
      type: Type.STRING,
      enum: ['Diagnostic', 'Needs Retake', 'Unsatisfactory'],
      description: 'Diagnostic rating: Diagnostic, Needs Retake, or Unsatisfactory.',
    },
    errors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          errorKey: {
            type: Type.STRING,
            enum: [
              'missing_apical',
              'missing_coronal_mesial_distal',
              'wrong_target_tooth',
              'tilted_occlusal',
              'elongation',
              'foreshortening',
              'overlapping',
              'cone_cut',
              'underexposed_overexposed',
              'motion_blur',
              'reversed_receptor',
              'double_exposure',
            ],
            description: 'Taxonomy error key.',
          },
          confidence: {
            type: Type.INTEGER,
            description: 'Confidence score (0-100).',
          },
        },
        required: ['errorKey', 'confidence'],
      },
      description: 'Detected technical positioning/exposure errors with confidence.',
    },
    anomalyNote: {
      type: Type.STRING,
      description: 'Brief anomaly note (<15 words) or empty string.',
    },
  },
  required: ['isPeriapicalRadiograph', 'overallQuality', 'errors'],
};

export function buildSystemInstruction(tooth: any, technique: string, receptorType: string, outputLanguage: string): string {
  return `You are an expert Oral and Maxillofacial Radiologist evaluating dental periapical radiographs.

CONTEXT:
- Target Tooth: FDI ${tooth.fdiNumber} (${tooth.nameVi || tooth.name || ''} / ${tooth.nameEn || tooth.name || ''})
- Target Arch & Group: ${tooth.arch || ''} - ${tooth.type || 'Dental Unit'}
- Exposure Technique: ${technique}
- Receptor Type: ${receptorType}

EVALUATION CRITERIA:
1. Apex & Target: Verify FDI ${tooth.fdiNumber} is centered and >= 2.0mm periapical bone margin is visible ('missing_apical', 'wrong_target_tooth').
2. Vertical/Horizontal Angles: Check elongation, foreshortening, occlusal tilt > 5° ('tilted_occlusal', 'elongation', 'foreshortening').
3. Contacts: Check for interproximal enamel overlaps ('overlapping').
4. Exposure & Handling: Check cone-cut, underexposure/overexposure, motion blur, double exposure, reversed receptor ('cone_cut', 'underexposed_overexposed', 'motion_blur', 'double_exposure', 'reversed_receptor').

QUALITY RULES (ADA/EADMFR):
- Critical faults ('missing_apical', 'wrong_target_tooth', 'cone_cut', 'double_exposure', 'reversed_receptor') -> overallQuality = "Needs Retake".
- 0 faults or minor non-critical faults only -> overallQuality = "Diagnostic".
- Non-dental image -> overallQuality = "Unsatisfactory".

CRITICAL INSTRUCTION: Return ONLY errorKey codes and confidence numbers. DO NOT write descriptions or error names — server dictionary handles all text translations and clinical descriptions.`;
}

// Critical fault keys that compromise periapical diagnosis and trigger "Needs Retake"
const CRITICAL_FAULT_KEYS = new Set([
  'missing_apical',
  'wrong_target_tooth',
  'cone_cut',
  'double_exposure',
  'reversed_receptor',
]);

/**
 * Maps the flat optimized schema response from Gemini back to the legacy nested schema structure expected by the app frontend.
 * This ensures 100% backward compatibility with no UI regressions or code breaks.
 */
export function mapOptimizedResultToLegacy(optimized: any, language: string): any {
  if (!optimized) return null;
  const isEn = language === 'EN' || language === 'English';
  
  const rawErrors = Array.isArray(optimized.errors) ? optimized.errors : [];
  const aiNotes = optimized.anomalyNote || optimized.ai_notes || '';

  const domainMetadata = {
    domain_1: { id: 'domain_1', nameVi: 'Miền 1: Lỗi đặt bộ nhận ảnh', nameEn: 'Domain 1: Receptor Placement Errors' },
    domain_2: { id: 'domain_2', nameVi: 'Miền 2: Lỗi góc độ & Hình học', nameEn: 'Domain 2: Angulation & Geometric Errors' },
    domain_3: { id: 'domain_3', nameVi: 'Miền 3: Lỗi phát tia & Xử lý phim', nameEn: 'Domain 3: Exposure, Processing & Artefacts' }
  };

  const findings = ['domain_1', 'domain_2', 'domain_3'].map((domId) => {
    const meta = domainMetadata[domId as keyof typeof domainMetadata];
    const domErrors = rawErrors
      .filter((err: any) => {
        const normalizedKey = normalizeTechFailureKey(err.errorKey || err.key || '');
        const item = TECH_FAILURE_DICT[normalizedKey] || TAXONOMY_ERRORS.find((t: any) => t.key === normalizedKey);
        return item && item.domainId === domId;
      })
      .map((err: any) => {
        const normalizedKey = normalizeTechFailureKey(err.errorKey || err.key || '');
        const item = TECH_FAILURE_DICT[normalizedKey] || TAXONOMY_ERRORS.find((t: any) => t.key === normalizedKey);
        const localizedName = item ? (isEn ? item.labelEn || item.label : item.label) : (err.errorName || normalizedKey);
        const localizedDesc = item ? (isEn ? item.descriptionEn || item.description : item.description) : '';
        const clinicalObs = aiNotes ? `${localizedDesc} (${aiNotes})` : localizedDesc;

        return {
          errorKey: normalizedKey || err.errorKey,
          errorName: localizedName,
          confidence: err.confidence || 85,
          clinicalObservation: clinicalObs || (isEn ? 'Radiographic technical error.' : 'Phát hiện lỗi kỹ thuật phim.')
        };
      });

    return {
      domainId: domId,
      domainName: isEn ? meta.nameEn : meta.nameVi,
      hasErrors: domErrors.length > 0,
      domainSummary: domErrors.length > 0
        ? (isEn ? 'Technical errors identified in this domain.' : 'Phát hiện lỗi kỹ thuật ở miền này.')
        : (isEn ? 'No technical errors identified in this domain.' : 'Không phát hiện lỗi kỹ thuật ở miền này.'),
      detectedErrors: domErrors
    };
  });

  return {
    isPeriapicalRadiograph: optimized.isPeriapicalRadiograph ?? true,
    overallQuality: optimized.overallQuality || 'Diagnostic',
    observationChain: optimized.observationChain || [],
    findings
  };
}

/**
 * Synthesizes results from two concurrent models (e.g. Flash & Pro) into an ensemble clinical consensus.
 */
export function synthesizeConsensusResults(
  resultA: any,
  resultB: any,
  language: string,
  modelAName = 'gemini-flash-latest',
  modelBName = 'gemini-pro-latest'
): any {
  // If either model identifies non-periapical radiograph, reject safely
  if (!resultA.isPeriapicalRadiograph || !resultB.isPeriapicalRadiograph) {
    return !resultA.isPeriapicalRadiograph ? resultA : resultB;
  }

  const isEn = language === 'EN' || language === 'English';

  // Merge observation chains from both models for complete CoT context
  const obsA = Array.isArray(resultA.observationChain) ? resultA.observationChain : [];
  const obsB = Array.isArray(resultB.observationChain) ? resultB.observationChain : [];
  const mergedObservations = Array.from(new Set([...obsA, ...obsB]));

  const mergedFindings = ['domain_1', 'domain_2', 'domain_3'].map((domainId) => {
    const fA = (resultA.findings || []).find((f: any) => f.domainId === domainId);
    const fB = (resultB.findings || []).find((f: any) => f.domainId === domainId);
    const domainName = fA?.domainName || fB?.domainName || domainId;

    const errorsA = fA?.detectedErrors || [];
    const errorsB = fB?.detectedErrors || [];

    const mergedErrors: any[] = [];
    const handledKeys = new Set<string>();

    // 1. Check errors identified in Model A
    for (const errA of errorsA) {
      handledKeys.add(errA.errorKey);
      const matchB = errorsB.find((e: any) => e.errorKey === errA.errorKey);
      const isCritical = CRITICAL_FAULT_KEYS.has(errA.errorKey);
      const singleThreshold = isCritical ? 70 : 75;

      if (matchB) {
        // High consensus: Both models agree on this error!
        mergedErrors.push({
          errorKey: errA.errorKey,
          errorName: errA.errorName || matchB.errorName,
          confidence: Math.round((Number(errA.confidence || 85) + Number(matchB.confidence || 85)) / 2),
          clinicalObservation:
            (errA.clinicalObservation?.length || 0) >= (matchB.clinicalObservation?.length || 0)
              ? errA.clinicalObservation
              : matchB.clinicalObservation,
        });
      } else if (Number(errA.confidence || 0) >= singleThreshold) {
        // Adaptive threshold for single-model detection
        mergedErrors.push({
          ...errA,
          confidence: Math.round(Number(errA.confidence || 85) * 0.92),
        });
      }
    }

    // 2. Check errors identified only in Model B
    for (const errB of errorsB) {
      if (!handledKeys.has(errB.errorKey)) {
        const isCritical = CRITICAL_FAULT_KEYS.has(errB.errorKey);
        const singleThreshold = isCritical ? 70 : 75;

        if (Number(errB.confidence || 0) >= singleThreshold) {
          mergedErrors.push({
            ...errB,
            confidence: Math.round(Number(errB.confidence || 85) * 0.92),
          });
        }
      }
    }

    const hasErrors = mergedErrors.length > 0;
    const domainSummary = hasErrors
      ? fA?.domainSummary || fB?.domainSummary || (isEn ? 'Technical errors identified.' : 'Phát hiện lỗi kỹ thuật.')
      : isEn
        ? 'No technical errors identified in this domain.'
        : 'Không phát hiện lỗi kỹ thuật ở miền này.';

    return {
      domainId,
      domainName,
      hasErrors,
      domainSummary,
      detectedErrors: mergedErrors,
    };
  });

  // Evaluate clinical severity according to ADA / EADMFR rules
  const allDetectedErrors = mergedFindings.flatMap((f) => f.detectedErrors || []);
  const hasCriticalFault = allDetectedErrors.some((e) => CRITICAL_FAULT_KEYS.has(e.errorKey));
  
  let overallQuality = 'Diagnostic';
  if (hasCriticalFault) {
    overallQuality = 'Needs Retake';
  } else if (allDetectedErrors.length >= 4) {
    overallQuality = 'Needs Retake';
  }

  return {
    isPeriapicalRadiograph: true,
    overallQuality,
    observationChain: mergedObservations,
    findings: mergedFindings,
    consensusMeta: {
      mode: 'dual_consensus',
      models: [modelAName, modelBName],
      status: 'consensus_synthesized',
    },
  };
}
