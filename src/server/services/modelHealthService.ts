import { serverLog } from "../config/env";
import { normalizeModelId, SafeCredentialSource } from "./modelRegistryService";

export interface ModelRuntimeHealthRecord {
  modelId: string;
  source: SafeCredentialSource;
  totalAttempts: number;
  successCount: number;
  error429Count: number;
  error503Count: number;
  timeoutCount: number;
  otherErrorCount: number;
  schemaValidCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  healthScore: number; // 0 to 100
}

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

// Rolling health records keyed by "modelId:source"
const healthStore = new Map<string, ModelRuntimeHealthRecord>();

function getOrCreateRecord(modelId: string, source: SafeCredentialSource): ModelRuntimeHealthRecord {
  const normId = normalizeModelId(modelId);
  const key = `${normId}:${source}`;
  let record = healthStore.get(key);
  if (!record) {
    record = {
      modelId: normId,
      source,
      totalAttempts: 0,
      successCount: 0,
      error429Count: 0,
      error503Count: 0,
      timeoutCount: 0,
      otherErrorCount: 0,
      schemaValidCount: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      healthScore: 100, // Starts at clean baseline
    };
    healthStore.set(key, record);
  }
  return record;
}

/**
 * Computes a standardized 0-100 health score from rolling metrics.
 */
export function computeHealthScore(record: ModelRuntimeHealthRecord): number {
  if (record.totalAttempts === 0) return 100;

  let score = 100;

  // Penalties for error types
  score -= record.error429Count * 15;
  score -= record.error503Count * 20;
  score -= record.timeoutCount * 25;
  score -= record.otherErrorCount * 20;

  // Severe penalty for consecutive failures
  score -= record.consecutiveFailures * 25;

  // Schema conformance reward / penalty
  if (record.successCount > 0) {
    const schemaRate = record.schemaValidCount / record.successCount;
    if (schemaRate < 1.0) {
      score -= (1.0 - schemaRate) * 40;
    }
  }

  // Bonus for consistent successful volume
  score += Math.min(record.successCount * 5, 20);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Returns the classification health status based on score.
 */
export function getHealthStatus(healthScore: number): HealthStatus {
  if (healthScore >= 70) return "HEALTHY";
  if (healthScore >= 40) return "DEGRADED";
  return "UNHEALTHY";
}

/**
 * Records a successful inference execution outcome from normal traffic.
 */
export function recordInferenceSuccess(
  source: SafeCredentialSource,
  modelId: string,
  latencyMs: number,
  schemaValid: boolean = true
): void {
  const normId = normalizeModelId(modelId);
  const record = getOrCreateRecord(normId, source);
  const nowIso = new Date().toISOString();

  record.totalAttempts++;
  record.successCount++;
  record.consecutiveFailures = 0;
  if (schemaValid) {
    record.schemaValidCount++;
  }
  record.totalLatencyMs += latencyMs;
  record.averageLatencyMs = Math.round(record.totalLatencyMs / record.totalAttempts);
  record.lastSuccessAt = nowIso;
  record.healthScore = computeHealthScore(record);
}

/**
 * Records an inference failure outcome from normal traffic.
 * Strictly guarantees NO clinical payload, prompts, or secrets are recorded.
 */
export function recordInferenceFailure(
  source: SafeCredentialSource,
  modelId: string,
  err: any,
  latencyMs: number = 0
): void {
  const normId = normalizeModelId(modelId);
  const record = getOrCreateRecord(normId, source);
  const nowIso = new Date().toISOString();

  record.totalAttempts++;
  record.consecutiveFailures++;
  record.lastFailureAt = nowIso;
  if (latencyMs > 0) {
    record.totalLatencyMs += latencyMs;
    record.averageLatencyMs = Math.round(record.totalLatencyMs / record.totalAttempts);
  }

  const str = (err?.message || String(err)).toLowerCase();
  const code = err?.code || err?.status || err?.statusCode;

  if (code === 429 || str.includes("429") || str.includes("quota") || str.includes("resource_exhausted")) {
    record.error429Count++;
  } else if (code === 503 || str.includes("503") || str.includes("overloaded") || str.includes("unavailable")) {
    record.error503Count++;
  } else if (str.includes("timeout") || str.includes("deadline")) {
    record.timeoutCount++;
  } else {
    record.otherErrorCount++;
  }

  record.healthScore = computeHealthScore(record);

  serverLog(
    "INFO",
    "ModelHealth",
    `Health updated: [${source}] ${normId} -> score ${record.healthScore} (${getHealthStatus(record.healthScore)})`
  );
}

/**
 * Retrieves the health record for a given model and credential source.
 */
export function getModelHealth(
  modelId: string,
  source: SafeCredentialSource
): ModelRuntimeHealthRecord | undefined {
  const normId = normalizeModelId(modelId);
  return healthStore.get(`${normId}:${source}`);
}

/**
 * Retrieves aggregate health score across sources for a model.
 */
export function getCombinedModelHealthScore(modelId: string): number {
  const normId = normalizeModelId(modelId);
  const primary = healthStore.get(`${normId}:system_primary`);
  const backup = healthStore.get(`${normId}:system_backup`);

  if (!primary && !backup) return 100; // Unobserved models start at baseline
  if (primary && !backup) return primary.healthScore;
  if (!primary && backup) return backup.healthScore;

  // Minimum of both to guard against single-project failure
  return Math.min(primary!.healthScore, backup!.healthScore);
}

/**
 * Returns all rolling health records.
 */
export function getAllHealthRecords(): ModelRuntimeHealthRecord[] {
  return Array.from(healthStore.values());
}

/**
 * Test Seam: Configure health metrics directly for tests.
 */
export function setModelHealthForTests(
  modelId: string,
  source: SafeCredentialSource,
  healthScore: number,
  consecutiveFailures: number = 0
): void {
  const normId = normalizeModelId(modelId);
  const record = getOrCreateRecord(normId, source);
  record.healthScore = healthScore;
  record.consecutiveFailures = consecutiveFailures;
}

/**
 * Test Seam: Reset health records.
 */
export function resetHealthStoreForTests(): void {
  healthStore.clear();
}
