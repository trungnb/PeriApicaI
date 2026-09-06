import fs from "node:fs";
import path from "node:path";
import { serverLog } from "../config/env";
import { getStorageRoot, isStorageTestOfflineMode } from "../config/storagePaths";
import type { SafeCredentialSource } from "./modelRegistryService";

export type ModelOperation = "generateContent";
export type OperationalAvailabilityStatus =
  | "UNKNOWN"
  | "AVAILABLE"
  | "ACCESS_UNAVAILABLE"
  | "TRANSIENT_UNKNOWN";

export interface OperationalAvailabilityAttempt {
  attemptedAt: string;
  status: Exclude<OperationalAvailabilityStatus, "UNKNOWN">;
  role: string;
  configRevision: string;
  latencyMs?: number;
  providerOutcome?: string;
}

export interface ModelOperationalAvailabilityRecord {
  modelId: string;
  safeSource: SafeCredentialSource;
  operation: ModelOperation;
  status: OperationalAvailabilityStatus;
  lastAttemptAt: string | null;
  retryEligibleAt: string | number | null;
  attemptHistory: OperationalAvailabilityAttempt[];
}

const availabilityStore = new Map<string, ModelOperationalAvailabilityRecord>();
let customAvailabilityFilePath: string | null = null;
let availabilityLoaded = false;
let loadedAvailabilityPath: string | null = null;

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
}

export function buildOperationalAvailabilityKey(
  modelId: string,
  safeSource: SafeCredentialSource,
  operation: ModelOperation = "generateContent"
): string {
  return `${normalizeModelId(modelId)}:${safeSource}:${operation}`;
}

export function getModelAvailabilityFilePath(): string {
  return customAvailabilityFilePath || path.join(getStorageRoot(), "runtime", "model_availability.json");
}

export function setCustomAvailabilityFilePathForTests(filePath: string | null): void {
  customAvailabilityFilePath = filePath;
  availabilityStore.clear();
  availabilityLoaded = false;
  loadedAvailabilityPath = null;
}

function isTestExecutionActive(): boolean {
  return process.env.NODE_ENV === "test" || process.execArgv.includes("--test") ||
    process.argv.some(arg => arg === "--test" || arg.includes(".test.") || arg.includes("test/"));
}

export function loadModelAvailabilityStoreFromDisk(): void {
  const filePath = getModelAvailabilityFilePath();
  if (loadedAvailabilityPath !== filePath) availabilityStore.clear();
  loadedAvailabilityPath = filePath;

  if (isTestExecutionActive() && !customAvailabilityFilePath && !isStorageTestOfflineMode()) {
    availabilityLoaded = true;
    return;
  }

  if (!fs.existsSync(filePath)) {
    availabilityLoaded = true;
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, ModelOperationalAvailabilityRecord>;
    for (const [key, record] of Object.entries(parsed)) {
      if (record && record.modelId && record.safeSource && record.operation) {
        availabilityStore.set(key, record);
      }
    }
    availabilityLoaded = true;
  } catch (err) {
    availabilityLoaded = true;
    serverLog("WARN", "ModelAvailability", `Failed to load operational availability from ${filePath}: ${err}`);
  }
}

export function saveModelAvailabilityStoreToDisk(): void {
  if (isTestExecutionActive() && !customAvailabilityFilePath && !isStorageTestOfflineMode()) return;
  const filePath = getModelAvailabilityFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, ModelOperationalAvailabilityRecord> = {};
    for (const [key, val] of availabilityStore.entries()) {
      obj[key] = val;
    }
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    serverLog("WARN", "ModelAvailability", `Failed to persist operational availability to ${filePath}: ${err}`);
  }
}

export const DEFAULT_TRANSIENT_COOLDOWN_MS = 15 * 60 * 1000; // 15 Minutes
export const ACCESS_UNAVAILABLE_REVALIDATION_TTL_MS = 72 * 60 * 60 * 1000; // 72 Hours (Discovery Epoch)

export function recordModelOperationalAvailability(
  inputOrModelId: string | {
    modelId: string;
    safeSource: SafeCredentialSource;
    operation?: ModelOperation;
    status: Exclude<OperationalAvailabilityStatus, "UNKNOWN">;
    attemptedAt?: string | number;
    role?: string;
    configRevision?: string;
    latencyMs?: number;
    providerOutcome?: string;
    transientCooldownMs?: number;
    revalidationTtlMs?: number;
  },
  safeSourceArg?: SafeCredentialSource,
  statusArg?: Exclude<OperationalAvailabilityStatus, "UNKNOWN">,
  operationArg?: ModelOperation,
  attemptedAtArg?: number | string
): ModelOperationalAvailabilityRecord {
  if (!availabilityLoaded || loadedAvailabilityPath !== getModelAvailabilityFilePath()) loadModelAvailabilityStoreFromDisk();

  let modelId: string;
  let safeSource: SafeCredentialSource;
  let status: Exclude<OperationalAvailabilityStatus, "UNKNOWN">;
  let operation: ModelOperation;
  let rawAttemptedAt: string | number;
  let role: string;
  let configRevision: string;
  let latencyMs: number | undefined;
  let providerOutcome: string | undefined;
  let transientCooldownMs: number | undefined;
  let revalidationTtlMs: number | undefined;

  if (typeof inputOrModelId === "string") {
    modelId = inputOrModelId;
    safeSource = safeSourceArg!;
    status = statusArg!;
    operation = operationArg || "generateContent";
    rawAttemptedAt = attemptedAtArg !== undefined ? attemptedAtArg : new Date().toISOString();
    role = "general";
    configRevision = "default";
  } else {
    modelId = inputOrModelId.modelId;
    safeSource = inputOrModelId.safeSource;
    status = inputOrModelId.status;
    operation = inputOrModelId.operation || "generateContent";
    rawAttemptedAt = inputOrModelId.attemptedAt !== undefined ? inputOrModelId.attemptedAt : new Date().toISOString();
    role = inputOrModelId.role || "general";
    configRevision = inputOrModelId.configRevision || "default";
    latencyMs = inputOrModelId.latencyMs;
    providerOutcome = inputOrModelId.providerOutcome;
    transientCooldownMs = inputOrModelId.transientCooldownMs;
    revalidationTtlMs = inputOrModelId.revalidationTtlMs;
  }

  const attemptedAt = typeof rawAttemptedAt === "number"
    ? new Date(rawAttemptedAt).toISOString()
    : rawAttemptedAt;

  const attemptedMs = typeof rawAttemptedAt === "number"
    ? rawAttemptedAt
    : new Date(rawAttemptedAt).getTime();

  const key = buildOperationalAvailabilityKey(modelId, safeSource, operation);
  const existing = availabilityStore.get(key);

  const attempt: OperationalAvailabilityAttempt = {
    attemptedAt,
    status,
    role,
    configRevision,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(providerOutcome ? { providerOutcome } : {}),
  };

  const duplicate = existing?.attemptHistory.some(item =>
    item.attemptedAt === attempt.attemptedAt && item.role === attempt.role && item.configRevision === attempt.configRevision
  );

  const cooldown = transientCooldownMs ?? DEFAULT_TRANSIENT_COOLDOWN_MS;
  const revalTtl = revalidationTtlMs ?? ACCESS_UNAVAILABLE_REVALIDATION_TTL_MS;

  const retryEligibleAt = status === "TRANSIENT_UNKNOWN"
    ? (typeof rawAttemptedAt === "number" ? attemptedMs + cooldown : new Date(attemptedMs + cooldown).toISOString())
    : status === "ACCESS_UNAVAILABLE"
    ? (typeof rawAttemptedAt === "number" ? attemptedMs + revalTtl : new Date(attemptedMs + revalTtl).toISOString())
    : null;

  const incomingIsLatest = !existing?.lastAttemptAt ||
    attemptedMs >= new Date(existing.lastAttemptAt).getTime();

  const record: ModelOperationalAvailabilityRecord = {
    modelId: normalizeModelId(modelId),
    safeSource,
    operation,
    status: incomingIsLatest ? status : existing!.status,
    lastAttemptAt: incomingIsLatest ? attemptedAt : existing!.lastAttemptAt,
    retryEligibleAt: incomingIsLatest ? retryEligibleAt : existing!.retryEligibleAt,
    attemptHistory: duplicate ? existing!.attemptHistory : [...(existing?.attemptHistory || []), attempt],
  };

  availabilityStore.set(key, record);
  saveModelAvailabilityStoreToDisk();
  return record;
}

export function getModelOperationalAvailability(
  modelId: string,
  safeSource: SafeCredentialSource,
  operation: ModelOperation = "generateContent"
): ModelOperationalAvailabilityRecord | undefined {
  if (!availabilityLoaded || loadedAvailabilityPath !== getModelAvailabilityFilePath()) loadModelAvailabilityStoreFromDisk();
  return availabilityStore.get(buildOperationalAvailabilityKey(modelId, safeSource, operation));
}

export function isModelCredentialOperationallyEligible(
  modelId: string,
  safeSource: SafeCredentialSource,
  operation: ModelOperation = "generateContent",
  nowMs: number = Date.now()
): boolean {
  const record = getModelOperationalAvailability(modelId, safeSource, operation);
  if (!record || record.status === "UNKNOWN" || record.status === "AVAILABLE") return true;
  if (record.status === "ACCESS_UNAVAILABLE") {
    // 72h revalidation horizon: allow one future runtime attempt when expired
    if (record.retryEligibleAt) {
      const eligibleTime = typeof record.retryEligibleAt === "number"
        ? record.retryEligibleAt
        : new Date(record.retryEligibleAt).getTime();
      if (eligibleTime <= nowMs) {
        return true;
      }
    }
    return false;
  }
  if (!record.retryEligibleAt) return false;
  const eligibleTime = typeof record.retryEligibleAt === "number"
    ? record.retryEligibleAt
    : new Date(record.retryEligibleAt).getTime();
  return eligibleTime <= nowMs;
}

export function getAllModelOperationalAvailabilityRecords(): ModelOperationalAvailabilityRecord[] {
  if (!availabilityLoaded || loadedAvailabilityPath !== getModelAvailabilityFilePath()) loadModelAvailabilityStoreFromDisk();
  return Array.from(availabilityStore.values());
}

export function clearModelAvailabilityStoreForTests(): void {
  availabilityStore.clear();
  availabilityLoaded = false;
  loadedAvailabilityPath = null;
}

export const resetOperationalAvailabilityForTests = clearModelAvailabilityStoreForTests;
