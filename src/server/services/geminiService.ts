import { GoogleGenAI, Type } from '@google/genai';
import { serverLog } from '../config/env';
import { normalizeTechFailureKey, TECH_FAILURE_DICT } from '../../constants/dictionaries';
import { TAXONOMY_ERRORS } from '../../data/taxonomyData';
import {
  buildModelLadder,
  getDiscoveredModels,
  getOrCreateAssessmentSnapshot,
  isCircuitOpen,
  recordFailure,
  resetAssessmentSnapshotsForTests,
  type AnalysisRole,
  type SafeCredentialSource,
} from './modelManager';

export class SimpleLRU<K, V> {
  private cache = new Map<K, { value: V; expires: number }>();
  constructor(private max: number, private ttl: number) {}
  get(key: K) { const item = this.cache.get(key); if (!item || item.expires < Date.now()) { this.cache.delete(key); return undefined; } this.cache.delete(key); this.cache.set(key, item); return item.value; }
  has(key: K) { return this.get(key) !== undefined; }
  set(key: K, value: V) { this.cache.delete(key); this.cache.set(key, { value, expires: Date.now() + this.ttl }); while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!); return this; }
  clear() { this.cache.clear(); }
}

// Analysis LRU Cache to avoid duplicate Gemini API calls for identical requests
export const analysisCache = new SimpleLRU<string, any>(200, 1000 * 60 * 60 * 24);

const originalAnalysisCacheClear = analysisCache.clear.bind(analysisCache);
analysisCache.clear = () => {
  resetAssessmentSnapshotsForTests();
  return originalAnalysisCacheClear();
};

export function getApiKeySources(): { key: string; isBackup: boolean }[] {
  const sources: { key: string; isBackup: boolean }[] = [];
  
  let zknjghtKey = process.env.zknjght_key ? process.env.zknjght_key.trim() : '';
  if ((zknjghtKey.startsWith("'") && zknjghtKey.endsWith("'")) || (zknjghtKey.startsWith('"') && zknjghtKey.endsWith('"'))) {
    zknjghtKey = zknjghtKey.slice(1, -1).trim();
  }

  let geminiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  if ((geminiKey.startsWith("'") && geminiKey.endsWith("'")) || (geminiKey.startsWith('"') && geminiKey.endsWith('"'))) {
    geminiKey = geminiKey.slice(1, -1).trim();
  }

  // Priority 1: Primary secret key zknjght_key
  if (zknjghtKey) {
    sources.push({ key: zknjghtKey, isBackup: false });
  }

  // Priority 2: Fallback GEMINI_API_KEY
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY' && geminiKey !== zknjghtKey) {
    sources.push({ key: geminiKey, isBackup: true });
  }

  return sources;
}

export function createAiClient(apiKey: string): GoogleGenAI {
  // Set explicit 55s timeout so that requests don't hang indefinitely while staying safely under client abort (65s)
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 55000 } });
}

export class ExecutionBudget {
  public attempts = 0;
  public branchAttempts: Record<string, number> = {};

  constructor(
    public maxAttempts: number, 
    public signal?: AbortSignal,
    public maxPerBranchAttempts: number = maxAttempts,
    public deadlineAt: number = Date.now() + 60000
  ) {}

  consume(branchId: string = 'default') {
    this.checkSignal();
    
    if (this.attempts >= this.maxAttempts) {
      const err: any = new Error('Global request budget exhausted');
      err.code = 'ATTEMPT_BUDGET_EXHAUSTED';
      err.isAllExhausted = true; // Compatibility flag; code is authoritative, never quota.
      throw err;
    }

    const branchCount = this.branchAttempts[branchId] || 0;
    if (branchCount >= this.maxPerBranchAttempts) {
      const err: any = new Error(`Branch request budget exhausted for ${branchId}`);
      err.code = 'ATTEMPT_BUDGET_EXHAUSTED';
      err.isAllExhausted = true; // Compatibility flag; code is authoritative, never quota.
      throw err;
    }

    this.attempts++;
    this.branchAttempts[branchId] = branchCount + 1;
  }

  getRemaining(branchId: string = 'default'): number {
    const globalRemaining = this.maxAttempts - this.attempts;
    const branchRemaining = this.maxPerBranchAttempts - (this.branchAttempts[branchId] || 0);
    return Math.max(Math.min(globalRemaining, branchRemaining), 0);
  }

  getMaxBudget(branchId: string = 'default'): number {
    return Math.min(this.maxAttempts, this.maxPerBranchAttempts);
  }

  checkSignal() {
    if (Date.now() >= this.deadlineAt) throw Object.assign(new Error('Execution deadline exceeded'), { code: 'EXECUTION_DEADLINE' });
    if (this.signal?.aborted) throw Object.assign(new Error('Request cancelled by client'), { code: 'CANCELLED' });
  }
}

export function isTerminalExecutionError(err: any): boolean {
  return ['CANCELLED', 'EXECUTION_DEADLINE', 'ATTEMPT_BUDGET_EXHAUSTED', 499, '499'].includes(err?.code)
    || err?.status === 499 || err?.status === '499' || err?.status === 'CANCELLED' || err?.error?.status === 'CANCELLED' || err?.name === 'AbortError';
}

/** Owns provider execution even if a provider ignores its cancellation signal. */
export async function runWithinBudget<T>(budget: ExecutionBudget, work: () => Promise<T>): Promise<T> {
  budget.checkSignal();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => {
      try { budget.checkSignal(); } catch (error) { reject(error); }
    };
    budget.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => reject(Object.assign(new Error('Execution deadline exceeded'), { code: 'EXECUTION_DEADLINE' })), Math.max(0, budget.deadlineAt - Date.now()));
  });
  try {
    const result = await Promise.race([work(), stop]);
    budget.checkSignal();
    return result;
  } finally {
    clearTimeout(timer!);
    budget.signal?.removeEventListener('abort', onAbort!);
  }
}

export function providerExecutionConfig(budget: ExecutionBudget) {
  budget.checkSignal();
  return { abortSignal: budget.signal ?? AbortSignal.timeout(Math.max(1, budget.deadlineAt - Date.now())), httpOptions: { timeout: Math.max(1, Math.min(55000, budget.deadlineAt - Date.now())) } };
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

async function executeRunnerWithinBudget<T>(
  runner: (aiClient: GoogleGenAI, modelName: string) => Promise<T>,
  aiClient: GoogleGenAI,
  model: string,
  budget: ExecutionBudget,
  branchId: string = 'default'
): Promise<T> {
  budget.consume(branchId);
  return runWithinBudget(budget, () => runner(aiClient, model));
}

/** BYOK may change models, never credentials. Generic permission failures fail closed. */
function classifyByokAccessFailure(err: any): { modelAccess: boolean; credentialInvalid: boolean } {
  let provider = err?.error || err;
  try { provider = JSON.parse(err?.message)?.error || provider; } catch {}
  const code = String(provider?.code || provider?.status || provider?.statusCode || err?.status || err?.code || err?.statusCode || '');
  const message = String(provider?.message || err?.message || '').toLowerCase();
  const invalidKey = isInvalidApiKeyError(err) || isInvalidApiKeyError(provider);
  const modelSpecific = /model/.test(message) &&
    /not found|not supported|unsupported|not available|unavailable|does not (?:exist|have access)|access.*(?:denied|not)|permission/.test(message);
  const modelAccess = !invalidKey && (code === '404' || code === 'NOT_FOUND' ||
    (['400', '403', 'INVALID_ARGUMENT', 'PERMISSION_DENIED'].includes(code) && modelSpecific));
  return {
    modelAccess,
    credentialInvalid: invalidKey || (!modelAccess && ['401', '403', 'UNAUTHENTICATED', 'PERMISSION_DENIED'].includes(code)),
  };
}

export interface ExecuteWithFailoverOptions {
  role?: AnalysisRole;
  modelLadder?: string[];
  configRevision?: string;
  credentialAffinity?: SafeCredentialSource[];
  assessmentId?: string;
}

export async function executeWithFailover<T>(
  runner: (aiClient: GoogleGenAI, modelName: string) => Promise<T>,
  preferredModel: string | undefined,
  customApiKey: string | undefined,
  onStatusUpdate: ((status: string) => void) | undefined,
  budget: ExecutionBudget,
  branchId: string = 'default',
  credentialAffinityOrOptions?: SafeCredentialSource[] | ExecuteWithFailoverOptions,
  rawOptions?: ExecuteWithFailoverOptions
): Promise<{ result: T; usedModel: string; usedKeyType: string }> {
  let credentialAffinity: SafeCredentialSource[] | undefined;
  let options: ExecuteWithFailoverOptions | undefined;
  if (Array.isArray(credentialAffinityOrOptions)) {
    credentialAffinity = credentialAffinityOrOptions;
    options = rawOptions;
  } else if (credentialAffinityOrOptions && typeof credentialAffinityOrOptions === 'object') {
    options = credentialAffinityOrOptions;
    credentialAffinity = options.credentialAffinity;
  } else {
    options = rawOptions;
  }

  const cleanCustomKey = customApiKey?.trim() || undefined;
  const snapshot = options?.assessmentId
    ? getOrCreateAssessmentSnapshot(
        options.assessmentId,
        options.role && preferredModel ? { [options.role]: preferredModel } : preferredModel,
        cleanCustomKey
      )
    : undefined;
  const snapshotRoleLadder = snapshot && options?.role ? snapshot.roles[options.role]?.modelLadder : undefined;
  const ladder = Array.from(new Set((
    options?.modelLadder?.length
      ? options.modelLadder
      : snapshotRoleLadder || snapshot?.ladder || buildModelLadder(preferredModel, getDiscoveredModels(cleanCustomKey))
  ).filter(Boolean)));

  if (cleanCustomKey) {
    const aiClient = createAiClient(cleanCustomKey);
    let lastError: any = null;
    let wasQuota = false;
    let wasInvalidKey = false;

    while (budget.getRemaining(branchId) > 0) {
      let passAttempts = 0;
      for (let i = 0; i < ladder.length; i++) {
        if (budget.getRemaining(branchId) === 0) break;
        const model = ladder[i];
        if (isCircuitOpen(model, 'custom')) continue;
        passAttempts++;
        try {
          if (budget.getRemaining(branchId) < budget.getMaxBudget(branchId)) {
            onStatusUpdate?.(`⚠️ Model [${model}] tạm bận, đang thử lại...`);
          } else {
            onStatusUpdate?.(`🔬 Đang phân tích bằng API Key cá nhân [${model}]...`);
          }
          const result = await executeRunnerWithinBudget(runner, aiClient, model, budget, branchId);
          return { result, usedModel: model, usedKeyType: 'custom_byok' };
        } catch (err: any) {
          budget.checkSignal();
          if (isTerminalExecutionError(err)) {
            if (!err.code || err.code === 499 || err.code === '499') err.code = 'CANCELLED';
            throw err;
          }
          lastError = err;
          const access = classifyByokAccessFailure(err);
          if (access.credentialInvalid) {
            wasInvalidKey = true;
            break; // Stop immediately on invalid key
          }
          const isQuota = isRateLimitOrQuotaError(err);
          const isTransient = isTransientError(err);
          const malformed = /json|schema|malformed|empty response/i.test(err?.message || '');
          if (!isQuota && !isTransient && !access.modelAccess && !malformed) throw err;
          if (isQuota || err?.status === 503 || err?.statusCode === 503 || err?.code === 503) {
            wasQuota ||= isQuota;
            recordFailure(model, 'custom');
          }
          const nextModel = ladder[i + 1];
          if (nextModel && budget.getRemaining(branchId) > 0) onStatusUpdate?.(`🔄 Model [${model}] không khả dụng, chuyển sang [${nextModel}]...`);
        }
      }
      if (wasInvalidKey) break;
      if (passAttempts === 0) break; // All circuit broken or no models
      if (budget.getRemaining(branchId) > 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const customErr: any = new Error(
      wasInvalidKey
        ? 'CUSTOM_KEY_INVALID: API Key cá nhân không hợp lệ.'
        : wasQuota
        ? 'CUSTOM_KEY_QUOTA_EXHAUSTED: API Key cá nhân của bạn đã vượt quá hạn mức (Quota).'
        : `Custom API Key failed: ${lastError?.message || 'provider error'}`
    );
    customErr.isCustomKeyFailed = true;
    customErr.isQuotaExhausted = wasQuota;
    customErr.isInvalidKey = wasInvalidKey;
    customErr.isTransient = isTransientError(lastError);
    customErr.originalError = lastError;
    throw customErr;
  }

  const rawKeySources = getApiKeySources();
  if (rawKeySources.length === 0) throw new Error('No system API keys configured (zknjght_key or GEMINI_API_KEY).');
  const isBranchB = branchId.toLowerCase().includes('branchb') || branchId.toLowerCase().includes('branch_b');
  const affinity = credentialAffinity || (isBranchB ? ['system_backup', 'system_primary'] : ['system_primary', 'system_backup']);
  const keySources = [...rawKeySources].sort((a, b) => {
    const aName: SafeCredentialSource = a.isBackup ? 'system_backup' : 'system_primary';
    const bName: SafeCredentialSource = b.isBackup ? 'system_backup' : 'system_primary';
    return affinity.indexOf(aName) - affinity.indexOf(bName);
  });

  let lastError: any = null;
  let allQuotaExhausted = true;
  const invalidKeys = new Set<SafeCredentialSource>();

  while (budget.getRemaining(branchId) > 0) {
    let passAttempts = 0;
    for (let i = 0; i < ladder.length; i++) {
      if (budget.getRemaining(branchId) === 0) break;
      const model = ladder[i];
      for (const source of keySources) {
        if (budget.getRemaining(branchId) === 0) break;
        const keyLabel = source.isBackup ? 'GEMINI_API_KEY (Backup)' : 'zknjght_key (Primary)';
        const keyId: SafeCredentialSource = source.isBackup ? 'system_backup' : 'system_primary';
        if (invalidKeys.has(keyId)) continue;
        if (isCircuitOpen(model, keyId)) continue;

        passAttempts++;
        const aiClient = createAiClient(source.key);
        try {
          if (budget.getRemaining(branchId) < budget.getMaxBudget(branchId)) {
            onStatusUpdate?.(`⚠️ Đang thử lại AI Model [${model}]...`);
          } else {
            onStatusUpdate?.(`🔬 Đang kết nối tới AI Model [${model}]...`);
          }
          const result = await executeRunnerWithinBudget(runner, aiClient, model, budget, branchId);
          return { result, usedModel: model, usedKeyType: keyLabel };
        } catch (err: any) {
          budget.checkSignal();
          if (isTerminalExecutionError(err)) {
            if (!err.code || err.code === 499 || err.code === '499') err.code = 'CANCELLED';
            throw err;
          }
          if (err.isAllExhausted) throw err;
          lastError = err;
          const isQuota = isRateLimitOrQuotaError(err);
          const isInvalidKey = isInvalidApiKeyError(err);
          const isTransient = isTransientError(err);
          const malformed = /json|schema|malformed|empty response/i.test(err?.message || '');
          const is404 = err?.status === 404 || err?.statusCode === 404 || err?.code === 404 || err?.code === '404' || /not found/i.test(err?.message || '');
          if (!isQuota && !isInvalidKey && !isTransient && !is404 && !malformed) throw err;
          if (isQuota || err?.status === 503 || err?.statusCode === 503 || err?.code === 503) recordFailure(model, keyId);
          if (!isQuota) allQuotaExhausted = false;
          if (isInvalidKey) invalidKeys.add(keyId);
        }
      }
      const nextModel = ladder[i + 1];
      if (nextModel && budget.getRemaining(branchId) > 0) onStatusUpdate?.(`🔄 Model [${model}] không khả dụng, tự động chuyển sang [${nextModel}]...`);
    }
    if (passAttempts === 0) break; // All circuit broken or exhausted
    if (budget.getRemaining(branchId) > 0) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const overallErr: any = new Error(
    allQuotaExhausted
      ? 'ALL_SYSTEM_KEYS_QUOTA_EXHAUSTED: Tất cả các khóa API hệ thống đều đã chạm ngưỡng hạn mức (Quota).'
      : `All ladder models and system credentials exhausted. Last error: ${lastError?.message || 'Unknown error'}`
  );
  overallErr.isAllExhausted = allQuotaExhausted;
  overallErr.isQuotaExhausted = allQuotaExhausted;
  overallErr.isTransient = !allQuotaExhausted && isTransientError(lastError);
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

export function buildSystemInstruction(tooth: any, technique: string, receptorType: string, _outputLanguage: string): string {
  return `You are an expert Oral and Maxillofacial Radiologist evaluating dental periapical radiographs.

CONTEXT:
- Target Tooth: FDI ${tooth.fdiNumber} (${tooth.nameVi || tooth.name || ''} / ${tooth.nameEn || tooth.name || ''})
- Target Arch & Group: ${tooth.arch || ''} - ${tooth.type || 'Dental Unit'}
- Exposure Technique: ${technique}
- Receptor Type: ${receptorType}

EVALUATION CRITERIA:
1. Apex, Coronal & Proximal Coverage: Verify target tooth FDI ${tooth.fdiNumber} is centered and adequately covered: >= 2.0mm periapical bone margin visible ('missing_apical'); coronal/incisal edges and adjacent proximal contacts visible ('missing_coronal_mesial_distal').
2. Vertical/Horizontal Angles: Check elongation, foreshortening, occlusal tilt > 5° ('tilted_occlusal', 'elongation', 'foreshortening').
3. Contacts: Check for interproximal enamel overlaps ('overlapping').
4. Exposure & Handling: Check cone-cut, underexposure/overexposure, motion blur, double exposure, reversed receptor ('cone_cut', 'underexposed_overexposed', 'motion_blur', 'double_exposure', 'reversed_receptor').

QUALITY RULES (ADA/EADMFR):
- Critical faults ('missing_apical', 'cone_cut', 'double_exposure', 'reversed_receptor') -> overallQuality = "Needs Retake".
- 0 faults or minor non-critical faults only -> overallQuality = "Diagnostic".
- Non-dental image -> overallQuality = "Unsatisfactory".

CRITICAL INSTRUCTION: Return ONLY errorKey codes and confidence numbers. DO NOT write descriptions or error names — server dictionary handles all text translations and clinical descriptions.`;
}

// Critical fault keys that compromise periapical diagnosis and trigger "Needs Retake"
const CRITICAL_FAULT_KEYS = new Set([
  'missing_apical',
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
          confidence: (typeof err.confidence === 'number' && Number.isFinite(err.confidence)) ? err.confidence : 0,
          clinicalObservation: clinicalObs || (isEn ? 'Radiographic technical error.' : 'Phát hiện lỗi kỹ thuật phim.'),
          provenance: err.provenance || 'single_mode'
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
        const confA = (typeof errA.confidence === 'number' && Number.isFinite(errA.confidence)) ? errA.confidence : 0;
        const confB = (typeof matchB.confidence === 'number' && Number.isFinite(matchB.confidence)) ? matchB.confidence : 0;
        mergedErrors.push({
          errorKey: errA.errorKey,
          errorName: errA.errorName || matchB.errorName,
          confidence: Math.round((confA + confB) / 2),
          modelAScore: errA.confidence,
          modelBScore: matchB.confidence,
          clinicalObservation:
            (errA.clinicalObservation?.length || 0) >= (matchB.clinicalObservation?.length || 0)
              ? errA.clinicalObservation
              : matchB.clinicalObservation,
          provenance: 'matched_consensus',
        });
      } else if ((typeof errA.confidence === 'number' && Number.isFinite(errA.confidence) ? errA.confidence : 0) >= singleThreshold) {
        // Adaptive threshold for single-model detection
        mergedErrors.push({
          ...errA,
          confidence: Math.round(errA.confidence * 0.92),
          modelAScore: errA.confidence,
          modelBScore: undefined,
          provenance: 'model_a_only',
        });
      }
    }

    // 2. Check errors identified only in Model B
    for (const errB of errorsB) {
      if (!handledKeys.has(errB.errorKey)) {
        const isCritical = CRITICAL_FAULT_KEYS.has(errB.errorKey);
        const singleThreshold = isCritical ? 70 : 75;

        if ((typeof errB.confidence === 'number' && Number.isFinite(errB.confidence) ? errB.confidence : 0) >= singleThreshold) {
          mergedErrors.push({
            ...errB,
            confidence: Math.round(errB.confidence * 0.92),
            modelAScore: undefined,
            modelBScore: errB.confidence,
            provenance: 'model_b_only',
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
