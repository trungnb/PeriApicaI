import { GoogleGenAI, Type } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { serverLog } from '../config/env';
import { normalizeTechFailureKey, TECH_FAILURE_DICT } from '../../constants/dictionaries';
import { TAXONOMY_ERRORS } from '../../data/taxonomyData';
import { isStorageTestOfflineMode } from '../config/storagePaths';
import {
  triggerFailureRefreshIfAppropriate,
  SafeCredentialSource,
} from './modelRegistryService';
import {
  recordInferenceSuccess,
  recordInferenceFailure,
} from './modelHealthService';
import { resetAssessmentSnapshotsForTests } from './assessmentModelSnapshot';
import {
  isModelCredentialOperationallyEligible,
  recordModelOperationalAvailability,
} from './modelAvailabilityService';
import {
  recordContractIncompatibleAttempt,
  recordCompatibilitySuccess,
  isModelContractIncompatible,
} from './modelCompatibilityGate';
import type { AnalysisRole } from './modelResolverService';

// Analysis LRU Cache to avoid duplicate Gemini API calls for identical requests
export const analysisCache = new LRUCache<string, any>({
  max: 200,
  ttl: 1000 * 60 * 60 * 24, // 24 Hours TTL
});

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

let storageTestAiClientFactory: ((apiKey: string) => GoogleGenAI) | null = null;

export function configureAiClientFactoryForStorageTests(factory: (apiKey: string) => GoogleGenAI): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Fake AI clients may only be configured inside an R17 offline storage sandbox.');
  }
  storageTestAiClientFactory = factory;
}

export function resetAiClientFactoryForStorageTests(): void {
  resetAssessmentSnapshotsForTests();
  if (!isStorageTestOfflineMode()) {
    throw new Error('Fake AI clients may only be reset inside an R17 offline storage sandbox.');
  }
  storageTestAiClientFactory = null;
}

export function createAiClient(apiKey: string): GoogleGenAI {
  if (storageTestAiClientFactory) return storageTestAiClientFactory(apiKey);
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
    return Math.min(globalRemaining, branchRemaining);
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

function hasModelQuotaScope(err: any): boolean {
  let payload = err?.error || err;
  try { payload = JSON.parse(err?.message)?.error || payload; } catch {}
  return Array.isArray(payload?.details) && payload.details.some((detail: any) =>
    Array.isArray(detail?.violations) && detail.violations.some((violation: any) =>
      typeof violation?.quotaDimensions?.model === 'string'));
}

export async function getAvailableVisionModels(_customApiKey?: string): Promise<Array<{ id: string; displayName: string }>> {
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
  budget: ExecutionBudget,
  onStatusUpdate?: (status: string) => void,
  branchId: string = 'default',
  byok = false
): Promise<T> {
  let transientRetries = 0;
  while (true) {
    try {
      budget.consume(branchId);
      return await runWithinBudget(budget, () => runner(aiClient, model));
    } catch (err: any) {
      budget.checkSignal();
      if (byok) {
        const access = classifyByokAccessFailure(err);
        if (access.modelAccess || access.credentialInvalid) throw err;
      }
      const str = err?.message?.toLowerCase() || '';
      const isInvalidKey = isInvalidApiKeyError(err);
      const isQuota = isRateLimitOrQuotaError(err);
      const isMalformedOutput = str.includes('malformed ai output');
      const isValidationError = (str.includes('400') || str.includes('invalid argument')) && !isMalformedOutput;
      const isParseError = str.includes('json') || str.includes('schema');
      const isBudgetOrCancel = err.isAllExhausted || str.includes('budget exhausted') || str.includes('cancelled');
      
      // Do not retry these at the model loop level
      if (isTerminalExecutionError(err) || !isTransientError(err) || isInvalidKey || isQuota || isValidationError || isParseError || isMalformedOutput || isBudgetOrCancel) {
        throw err;
      }
      
      // Bound same-candidate retries
      // If we only have 1 attempt left, save it for the next candidate (fallback model or backup key)
      // rather than wasting it on a retry of the same failing candidate.
      if (transientRetries >= 1 || budget.getRemaining(branchId) <= 1) {
        throw err; // Give up on this specific candidate, let executeWithFailover try the next model/key
      }
      transientRetries++;
      
      const jitterMs = 200 + Math.floor(Math.random() * 200);
      const msg = `⚠️ Model [${model}] tạm bận, thử lại...`;
      serverLog('WARN', 'GeminiService', `Transient error on model [${model}]. Retrying in ${jitterMs}ms...`);
      onStatusUpdate?.(msg);
      await runWithinBudget(budget, () => new Promise((resolve) => setTimeout(resolve, jitterMs)));
      budget.checkSignal();
    }
  }
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

  if (customApiKey && customApiKey.trim()) {
    const cleanCustomKey = customApiKey.trim();
    const aiClient = createAiClient(cleanCustomKey);
    const modelsToTry = Array.from(new Set([
      ...(options?.modelLadder?.length ? options.modelLadder : [preferredModel, ...AVAILABLE_MODELS.map(m => m.id)])
    ].filter(Boolean) as string[]));

    let lastError: any = null;
    let wasQuota = false;
    let wasInvalidKey = false;
    for (let i = 0; i < modelsToTry.length; i++) {
      budget.checkSignal();
      const model = modelsToTry[i];
      try {
        onStatusUpdate?.(`🔬 Đang phân tích bằng API Key cá nhân [${model}]...`);
        budget.checkSignal();
        const result = await executeRunnerWithRetry(runner, aiClient, model, budget, onStatusUpdate, branchId, true);
        return { result, usedModel: model, usedKeyType: 'custom_byok' };
      } catch (err: any) {
        budget.checkSignal();
        if (isTerminalExecutionError(err)) {
          if (!err.code || err.code === 499 || err.code === '499') err.code = 'CANCELLED';
          throw err;
        }
        lastError = err;
        serverLog('WARN', 'GeminiService', `BYOK call failed on model ${model}:`, err?.message || err);
        
        if (err.isAllExhausted) throw err;
        
        const access = classifyByokAccessFailure(err);
        if (access.credentialInvalid) {
          wasInvalidKey = true;
          break;
        }
        if (access.modelAccess) continue;

        const str = err?.message?.toLowerCase() || '';
        const isMalformedOutput = str.includes('malformed ai output');
        const isValidationError = (str.includes('400') || str.includes('invalid argument')) && !isMalformedOutput;
        if (isValidationError || (!isTransientError(err) && !isRateLimitOrQuotaError(err) && !/json|schema|malformed|empty response/i.test(err?.message || ''))) {
          throw err;
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

  const rawKeySources = getApiKeySources();
  if (rawKeySources.length === 0) {
    throw new Error('No system API keys configured (zknjght_key or GEMINI_API_KEY).');
  }

  const isBranchB = branchId.toLowerCase().includes('branchb') || branchId.toLowerCase().includes('branch_b');
  const affinity = credentialAffinity || (isBranchB ? ['system_backup', 'system_primary'] : ['system_primary', 'system_backup']);

  const keySources = [...rawKeySources].sort((a, b) => {
    const aName: SafeCredentialSource = a.isBackup ? 'system_backup' : 'system_primary';
    const bName: SafeCredentialSource = b.isBackup ? 'system_backup' : 'system_primary';
    return affinity.indexOf(aName) - affinity.indexOf(bName);
  });

  if (options?.modelLadder && options.modelLadder.length > 0) {
    const ladder = Array.from(new Set(options.modelLadder));
    let lastError: any = null;
    let allQuotaExhausted = true;

    for (let m = 0; m < ladder.length; m++) {
      budget.checkSignal();
      const model = ladder[m];

      if (options.role && isModelContractIncompatible(model, options.role, options.configRevision)) {
        serverLog('INFO', 'GeminiService', `[R35 Ladder] Skipping contract-incompatible model [${model}] for role [${options.role}]`);
        continue;
      }

      for (let k = 0; k < keySources.length; k++) {
        budget.checkSignal();
        const source = keySources[k];
        const safeSource: SafeCredentialSource = source.isBackup ? 'system_backup' : 'system_primary';
        const keyLabel = source.isBackup ? 'GEMINI_API_KEY (Backup)' : 'zknjght_key (Primary)';

        if (!isModelCredentialOperationallyEligible(model, safeSource, 'generateContent')) {
          serverLog('INFO', 'GeminiService', `[R35 Ladder] Skipping operationally unavailable path [${model}:${safeSource}:generateContent]`);
          continue;
        }

        const aiClient = createAiClient(source.key);
        const candidateStart = Date.now();

        try {
          serverLog('INFO', 'GeminiService', `[R35 Ladder] Executing role [${options.role || 'default'}] on model [${model}] with key [${keyLabel}]`);
          budget.consume(branchId);
          const result = await runWithinBudget(budget, () => runner(aiClient, model));
          const latencyMs = Date.now() - candidateStart;

          recordModelOperationalAvailability(model, safeSource, 'AVAILABLE', 'generateContent');
          if (options.role) {
            recordCompatibilitySuccess(model, options.role, options.configRevision || '');
          }
          recordInferenceSuccess(safeSource, model, latencyMs, true);

          return { result, usedModel: model, usedKeyType: keyLabel };
        } catch (err: any) {
          budget.checkSignal();
          const latencyMs = Date.now() - candidateStart;
          recordInferenceFailure(safeSource, model, err, latencyMs);

          if (isTerminalExecutionError(err)) {
            if (!err.code || err.code === 499 || err.code === '499') err.code = 'CANCELLED';
            throw err;
          }
          lastError = err;

          if (err.isAllExhausted) throw err;

          const str = err?.message?.toLowerCase() || '';
          const isMalformedOutput = str.includes('malformed ai output') || /json|schema|malformed|empty response/i.test(err?.message || '');
          const isValidationError = (str.includes('400') || str.includes('invalid argument')) && !isMalformedOutput;
          if (isValidationError || (!isTransientError(err) && !isRateLimitOrQuotaError(err) && !isInvalidApiKeyError(err) && !isMalformedOutput && err?.status !== 404 && err?.statusCode !== 404 && err?.code !== 404)) {
            throw err;
          }

          const isQuota = isRateLimitOrQuotaError(err);
          const isInvalidKey = isInvalidApiKeyError(err);
          const isTransient = isTransientError(err);
          const is404 = err?.status === 404 || err?.statusCode === 404 || err?.code === 404 || err?.code === '404' || str.includes('not found');

          if (is404) {
            recordModelOperationalAvailability(model, safeSource, 'ACCESS_UNAVAILABLE', 'generateContent');
            serverLog('WARN', 'GeminiService', `[R35 Ladder] Model [${model}] ACCESS_UNAVAILABLE (404) on [${safeSource}]`);
          } else if (isQuota) {
            recordModelOperationalAvailability(model, safeSource, 'TRANSIENT_UNKNOWN', 'generateContent');
          } else if (isTransient) {
            recordModelOperationalAvailability(model, safeSource, 'TRANSIENT_UNKNOWN', 'generateContent');
          } else if (isMalformedOutput && options.role) {
            recordContractIncompatibleAttempt(model, options.role, options.configRevision || '', false);
            serverLog('WARN', 'GeminiService', `[R35 Ladder] Contract degraded on model [${model}] for role [${options.role}]: ${err?.message}`);
            break;
          }

          if (!isQuota) {
            allQuotaExhausted = false;
          }

          void triggerFailureRefreshIfAppropriate(err, isQuota, isTransient, isInvalidKey);

          serverLog('WARN', 'GeminiService', `[R35 Ladder] Failed attempt on model [${model}] with key [${keyLabel}]:`, err?.message || err);
        }
      }

      if (m < ladder.length - 1) {
        const nextModel = ladder[m + 1];
        onStatusUpdate?.(`🔄 Model [${model}] không khả dụng, chuyển sang [${nextModel}]...`);
      }
    }

    const isLastTransient = isTransientError(lastError);
    const overallMsg = allQuotaExhausted
      ? 'ALL_SYSTEM_KEYS_QUOTA_EXHAUSTED: Tất cả các khóa API hệ thống đều đã chạm ngưỡng hạn mức (Quota).'
      : `All ladder models and system credentials exhausted. Last error: ${lastError?.message || 'Unknown error'}`;

    const overallErr: any = new Error(overallMsg);
    overallErr.isAllExhausted = allQuotaExhausted;
    overallErr.isQuotaExhausted = allQuotaExhausted;
    overallErr.isTransient = !allQuotaExhausted && isLastTransient;
    overallErr.originalError = lastError;
    throw overallErr;
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
      budget.checkSignal();
      const model = modelsToTry[i];
      const safeSource: SafeCredentialSource = source.isBackup ? 'system_backup' : 'system_primary';
      if (!isModelCredentialOperationallyEligible(model, safeSource, 'generateContent')) {
        serverLog('INFO', 'GeminiService', `Skipping operationally unavailable model/credential path [${model}:${safeSource}:generateContent]`);
        continue;
      }
      const candidateStart = Date.now();
      try {
        serverLog('INFO', 'GeminiService', `Executing AI request with key [${keyLabel}] on model [${model}]`);
        onStatusUpdate?.(`🔬 Đang kết nối tới AI Model [${model}]...`);
        budget.checkSignal();
        const result = await executeRunnerWithRetry(runner, aiClient, model, budget, onStatusUpdate, branchId);
        const latencyMs = Date.now() - candidateStart;
        recordModelOperationalAvailability(model, safeSource, 'AVAILABLE', 'generateContent');
        recordInferenceSuccess(safeSource, model, latencyMs, true);
        anyModelSucceeded = true;
        return { result, usedModel: model, usedKeyType: keyLabel };
      } catch (err: any) {
        budget.checkSignal();
        const latencyMs = Date.now() - candidateStart;
        recordInferenceFailure(safeSource, model, err, latencyMs);

        if (isTerminalExecutionError(err)) {
          if (!err.code || err.code === 499 || err.code === '499') err.code = 'CANCELLED';
          throw err;
        }
        lastError = err;
        
        if (err.isAllExhausted) throw err;
        
        const str = err?.message?.toLowerCase() || '';
        const isMalformedOutput = str.includes('malformed ai output');
        const isValidationError = (str.includes('400') || str.includes('invalid argument')) && !isMalformedOutput;
        const is404 = err?.status === 404 || err?.statusCode === 404 || err?.code === 404 || err?.code === '404' || str.includes('not found');
        if (isValidationError || (!isTransientError(err) && !isRateLimitOrQuotaError(err) && !isInvalidApiKeyError(err) && !is404 && !/json|schema|malformed|empty response/i.test(err?.message || ''))) {
          throw err;
        }

        const isQuota = isRateLimitOrQuotaError(err);
        const isInvalidKey = isInvalidApiKeyError(err);
        const isTransient = isTransientError(err);

        if (isQuota) {
          recordModelOperationalAvailability(model, safeSource, 'TRANSIENT_UNKNOWN', 'generateContent');
        } else if (isTransient) {
          recordModelOperationalAvailability(model, safeSource, 'TRANSIENT_UNKNOWN', 'generateContent');
        } else if (is404 || err.status === 403 || err.statusCode === 403 || err.code === 403 || err.code === '403') {
          recordModelOperationalAvailability(model, safeSource, 'ACCESS_UNAVAILABLE', 'generateContent');
        }

        // Trigger failure-directed refresh if model identity is unavailable (never on 429, 503, or invalid key)
        void triggerFailureRefreshIfAppropriate(err, isQuota, isTransient, isInvalidKey);
        
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
          const isModelSpecific = hasModelQuotaScope(err);
          
          if (!isModelSpecific) {
            // Key-scoped quota. Do not waste budget on other models for this key.
            serverLog('WARN', 'GeminiService', `Key-scoped quota exhaustion detected. Skipping remaining models on this key.`);
            break; // Break the model loop, move to next key!
          }
          
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
