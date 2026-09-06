import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { serverLog } from "../config/env";
import { getStorageRoot, isStorageTestOfflineMode } from "../config/storagePaths";
import { normalizeModelId, SafeCredentialSource, sanitizeDiscoveryError } from "./modelRegistryService";
import { createAiClient, getApiKeySources, buildSystemInstruction, DENTAL_ANALYSIS_SCHEMA } from "./geminiService";
import { buildValiditySystemInstruction, IMAGE_VALIDITY_SCHEMA } from "./geminiValidityService";
import { validateImageValidityOutput } from "../../utils/imageValidity";
import { validateClassicOutput, validatePathologyOutput } from "../../utils/semanticValidation";
import { PATHOLOGY_DICT } from "../../constants/dictionaries";
import { buildPathologyInstruction, PATHOLOGY_SEGMENT_SCHEMA } from "./geminiPathologyService";
import { getCanonicalToothByFdi } from "../middleware/validation";
import {
  loadModelAvailabilityStoreFromDisk,
  recordModelOperationalAvailability,
} from "./modelAvailabilityService";

export type CompatibilityStatus =
  | "NOT_TESTED"
  | "LEGACY_UNVERIFIED"
  | "PENDING"
  | "COMPATIBILITY_VERIFIED"
  | "TRANSIENT_UNKNOWN"
  | "CONTRACT_DEGRADED"
  | "CONTRACT_QUARANTINED"
  | "FAILED_INCOMPATIBLE";

export interface ModelCompatibilityRecord {
  modelId: string;
  role: string;
  configRevision: string;
  status: CompatibilityStatus;
  verifiedAt: string | null;
  lastAttemptAt: string;
  reason?: string;
  geometryQuality?: "VERIFIED" | "GEOMETRY_DEGRADED";
  geometryWarning?: string;
  safeSource?: SafeCredentialSource;
  attempts?: number;
  latencyMs?: number;
  parserValidatorResult?: "PASS" | "GEOMETRY_DEGRADED" | "FAIL" | "NOT_REACHED";
  attemptHistory?: Array<{
    attemptedAt: string;
    status: CompatibilityStatus;
    safeSource?: SafeCredentialSource;
    attempts?: number;
    latencyMs?: number;
    parserValidatorResult?: "PASS" | "GEOMETRY_DEGRADED" | "FAIL" | "NOT_REACHED";
    reason?: string;
  }>;
}

export interface CompatibilityConfigInputs {
  role: string;
  schema?: any;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    thinkingConfig?: any;
    [key: string]: any;
  };
  systemInstruction?: string;
  promptText?: string;
  promptVersion?: string;
  validatorContractVersion?: string;
}

export interface CanaryRoleContract {
  role: string;
  systemInstruction: string;
  promptText: string;
  schema: any;
  generationConfig: {
    temperature: number;
    maxOutputTokens?: number;
    responseMimeType: string;
    thinkingConfig?: any;
    [key: string]: any;
  };
  validator: (parsed: any) => any;
  validatorContractVersion: string;
  configRevision: string;
}

export const COMPATIBILITY_VALIDATOR_CONTRACTS = {
  validity: "validity-acceptance-v1",
  technical: "technical-acceptance-v1",
  pathology: "pathology-acceptance-v1",
} as const;

// In-memory registry of compatibility records
const compatibilityStore = new Map<string, ModelCompatibilityRecord>();

let customCanarySeam: ((modelId: string, role?: string, configIdentity?: string) => Promise<{
  ok: boolean;
  transient?: boolean;
  reason?: string;
  geometryQuality?: "VERIFIED" | "GEOMETRY_DEGRADED";
  geometryWarning?: string;
}>) | null = null;

let customCanaryResponseSeam: ((modelId: string, role?: string, configRevision?: string) => Promise<{ text: string } | null>) | null = null;

export function configureCanaryResponseSeamForTests(
  seam: ((modelId: string, role?: string, configRevision?: string) => Promise<{ text: string } | null>) | null
): void {
  customCanaryResponseSeam = seam;
}

export const NON_PILOT_FIXTURE_PATH = "test/fixtures/radiographs/45.webp";

class CanaryRunnerSystemError extends Error {
  readonly isCanaryRunnerSystemError = true;
}

function markCompatibilityFailure(error: Error): Error {
  (error as any).isCompatibilityFailure = true;
  return error;
}

export function classifyCanaryProviderFailure(err: any): {
  accessUnavailable: boolean;
  transient: boolean;
  providerCompatibilityFailure: boolean;
} {
  const providerText = [err?.message, err?.error?.message, (() => {
    try { return JSON.stringify(err); } catch { return String(err); }
  })()].filter(Boolean).join(" ").toLowerCase();
  const providerCode = Number(err?.status ?? err?.code ?? err?.error?.code);
  const accessUnavailable = providerCode === 404 ||
    /(?:\b404\b|not[_ ]found|no longer available|unavailable to new users|not supported for generatecontent)/i.test(providerText);
  const transient = !accessUnavailable && (
    providerCode === 429 || providerCode === 503 ||
    /(?:\b429\b|\b503\b|overloaded|quota|resource_exhausted|timeout|deadline|high demand)/i.test(providerText)
  );
  return {
    accessUnavailable,
    transient,
    providerCompatibilityFailure: providerCode === 400 || providerCode === 422,
  };
}

/**
 * Computes a deterministic identity hash for compatibility inputs (role, schema, prompt contract, generation/thinking config).
 */
export function computeCompatibilityConfigIdentity(inputs: CompatibilityConfigInputs): string {
  const canonical = {
    role: inputs.role,
    schema: inputs.schema ?? null,
    generationConfig: inputs.generationConfig ?? null,
    systemInstruction: inputs.systemInstruction ?? null,
    promptText: inputs.promptText ?? null,
    promptVersion: inputs.promptVersion ?? "v1",
    validatorContractVersion: inputs.validatorContractVersion ?? null,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Returns the authoritative production contract for an analysis role canary.
 * Enforces exact downstream schema, system instruction, prompt text, generation config, and validator.
 */
export function getCanaryContractForRole(role: string): CanaryRoleContract {
  const tooth45 = getCanonicalToothByFdi("45") || {
    fdiNumber: "45",
    arch: "Mandible",
    quadrant: 4,
    type: "Premolar",
    nameVi: "Răng cối nhỏ thứ 2 hàm dưới bên phải",
    nameEn: "Mandibular Right 2nd Premolar",
  };

  switch (role) {
    case "validity": {
      const validatorContractVersion = COMPATIBILITY_VALIDATOR_CONTRACTS.validity;
      const systemInstruction = buildValiditySystemInstruction(tooth45, "VI");
      const promptText = `Verify image validity and suitability for target tooth FDI 45.`;
      const schema = IMAGE_VALIDITY_SCHEMA;
      const generationConfig = {
        temperature: 0.0,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
      };
      const validator = (parsed: any) => {
        const validated = validateImageValidityOutput(parsed);
        if (!validated) {
          const err: any = new Error("Validity output did not conform to schema");
          err.isMalformed = true;
          throw err;
        }
        return validated;
      };
      const configRevision = computeCompatibilityConfigIdentity({
        role: "validity",
        schema,
        generationConfig,
        systemInstruction,
        promptText,
        validatorContractVersion,
      });
      return {
        role: "validity",
        systemInstruction,
        promptText,
        schema,
        generationConfig,
        validator,
        validatorContractVersion,
        configRevision,
      };
    }

    case "technical_branch_a":
    case "technical_branch_b":
    case "technical": {
      const validatorContractVersion = COMPATIBILITY_VALIDATOR_CONTRACTS.technical;
      const systemInstruction = buildSystemInstruction(tooth45, "Paralleling", "Digital Sensor", "VI");
      const promptText = `Analyze radiograph for FDI 45.`;
      const schema = DENTAL_ANALYSIS_SCHEMA;
      const generationConfig = {
        temperature: 0.0,
        responseMimeType: "application/json",
      };
      const validator = (parsed: any) => {
        return validateClassicOutput(parsed);
      };
      const configRevision = computeCompatibilityConfigIdentity({
        role,
        schema,
        generationConfig,
        systemInstruction,
        promptText,
        validatorContractVersion,
      });
      return {
        role,
        systemInstruction,
        promptText,
        schema,
        generationConfig,
        validator,
        validatorContractVersion,
        configRevision,
      };
    }

    case "pathology_branch_a":
    case "pathology_branch_b":
    case "pathology": {
      const validatorContractVersion = COMPATIBILITY_VALIDATOR_CONTRACTS.pathology;
      const systemInstruction = buildPathologyInstruction("45", "VI");
      const promptText = `Analyze this periapical radiograph for FDI 45. Perform Single-Pass CoT observation and segment all 8 standardized pathological & anatomical structures with exact [y, x] polygon boundary contours.`;
      const schema = PATHOLOGY_SEGMENT_SCHEMA;
      const generationConfig = {
        temperature: 0.0,
        responseMimeType: "application/json",
      };
      const validator = (parsed: any) => {
        // Enforce canonical pathology taxonomy
        if (Array.isArray(parsed?.pathologies)) {
          for (const p of parsed.pathologies) {
            if (!p || typeof p !== "object") continue;
            if (typeof p.key !== "string" || !PATHOLOGY_DICT[p.key as keyof typeof PATHOLOGY_DICT]) {
              throw new Error(`Non-canonical pathology taxonomy key: "${p.key}"`);
            }
          }
        }

        // Semantic / structural validation via production parser
        const validated = validatePathologyOutput(parsed);

        // Geometry quality observed separately
        let geometryDegraded = false;
        const geometryWarnings: string[] = [];
        if (Array.isArray(validated.pathologies)) {
          for (const p of validated.pathologies) {
            if (p.geometryStatus === "malformed") {
              geometryDegraded = true;
              geometryWarnings.push(`Pathology finding "${p.key}" has malformed polygon points`);
            } else if (
              p.geometryStatus === "unavailable" ||
              !Array.isArray(p.polygon_points) ||
              p.polygon_points.length < 3
            ) {
              geometryDegraded = true;
              geometryWarnings.push(`Pathology finding "${p.key}" has missing or insufficient polygon vertices`);
            }
          }
        }

        return {
          ...validated,
          geometryQuality: (geometryDegraded ? "GEOMETRY_DEGRADED" : "VERIFIED") as "VERIFIED" | "GEOMETRY_DEGRADED",
          geometryWarnings,
        };
      };
      const configRevision = computeCompatibilityConfigIdentity({
        role,
        schema,
        generationConfig,
        systemInstruction,
        promptText,
        validatorContractVersion,
      });
      return {
        role,
        systemInstruction,
        promptText,
        schema,
        generationConfig,
        validator,
        validatorContractVersion,
        configRevision,
      };
    }

    default: {
      const validatorContractVersion = COMPATIBILITY_VALIDATOR_CONTRACTS.validity;
      const systemInstruction = buildValiditySystemInstruction(tooth45, "VI");
      const promptText = `Verify image validity and suitability for target tooth FDI 45.`;
      const schema = IMAGE_VALIDITY_SCHEMA;
      const generationConfig = {
        temperature: 0.0,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
      };
      const validator = (parsed: any) => {
        const validated = validateImageValidityOutput(parsed);
        if (!validated) {
          const err: any = new Error("Validity output did not conform to schema");
          err.isMalformed = true;
          throw err;
        }
        return validated;
      };
      const configRevision = computeCompatibilityConfigIdentity({
        role,
        schema,
        generationConfig,
        systemInstruction,
        promptText,
        validatorContractVersion,
      });
      return {
        role,
        systemInstruction,
        promptText,
        schema,
        generationConfig,
        validator,
        validatorContractVersion,
        configRevision,
      };
    }
  }
}

/**
 * Builds the compound storage key for a compatibility record.
 */
export function buildCompatibilityKey(
  modelId: string,
  role: string = "general",
  configRevision: string = "default"
): string {
  return `${normalizeModelId(modelId)}:${role}:${configRevision}`;
}

let customCompatibilityFilePath: string | null = null;

export function setCustomCompatibilityFilePathForTests(filePath: string | null): void {
  customCompatibilityFilePath = filePath;
}

export function getCompatibilityFilePath(): string {
  if (customCompatibilityFilePath) return customCompatibilityFilePath;
  return path.join(getStorageRoot(), "runtime", "model_compatibility.json");
}

/**
 * Loads persisted compatibility records from local disk.
 */
export function loadCompatibilityStoreFromDisk(): void {
  try {
    const filePath = getCompatibilityFilePath();
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return;
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        const record = v as ModelCompatibilityRecord;
        if (!record.role) record.role = "general";
        compatibilityStore.set(k, record);
      }
    }
  } catch (err: any) {
    serverLog("WARN", "CompatibilityGate", "Could not load compatibility store from disk:", err?.message || err);
  }
}

function isPreExecutionAccessFailure(record: ModelCompatibilityRecord): boolean {
  return record.status === "FAILED_INCOMPATIBLE" && record.parserValidatorResult === "NOT_REACHED" &&
    /(?:\b404\b|not[_ ]found|no longer available|unavailable to new users|not supported for generatecontent)/i.test(record.reason || "");
}

/** One-time correction for R34.3 records whose contract parser was never reached. */
export function migratePreExecutionAccessFailures(): number {
  loadModelAvailabilityStoreFromDisk();
  let migrated = 0;
  for (const [key, record] of compatibilityStore.entries()) {
    if (!record.safeSource) continue;
    if (record.status === "COMPATIBILITY_VERIFIED") {
      recordModelOperationalAvailability({
        modelId: record.modelId, safeSource: record.safeSource, status: "AVAILABLE",
        attemptedAt: record.lastAttemptAt, role: record.role, configRevision: record.configRevision,
        latencyMs: record.latencyMs, providerOutcome: record.reason,
      });
    }
    for (const audit of record.attemptHistory || []) {
      if (!audit.safeSource || !audit.reason) continue;
      const auditRecord: ModelCompatibilityRecord = {
        ...record,
        status: audit.status,
        parserValidatorResult: audit.parserValidatorResult,
        reason: audit.reason,
      };
      if (isPreExecutionAccessFailure(auditRecord) ||
        (audit.status === "NOT_TESTED" && audit.parserValidatorResult === "NOT_REACHED" &&
          /(?:\b404\b|not[_ ]found|no longer available|unavailable to new users|not supported for generatecontent)/i.test(audit.reason))) {
        recordModelOperationalAvailability({
          modelId: record.modelId, safeSource: audit.safeSource, status: "ACCESS_UNAVAILABLE",
          attemptedAt: audit.attemptedAt, role: record.role, configRevision: record.configRevision,
          latencyMs: audit.latencyMs, providerOutcome: audit.reason,
        });
      }
    }
    if (record.status === "TRANSIENT_UNKNOWN" && record.parserValidatorResult === "NOT_REACHED") {
      recordModelOperationalAvailability({
        modelId: record.modelId,
        safeSource: record.safeSource,
        status: "TRANSIENT_UNKNOWN",
        attemptedAt: record.lastAttemptAt,
        role: record.role,
        configRevision: record.configRevision,
        latencyMs: record.latencyMs,
        providerOutcome: record.reason,
      });
      continue;
    }
    if (!isPreExecutionAccessFailure(record)) continue;
    const audit = {
      attemptedAt: record.lastAttemptAt,
      status: record.status,
      safeSource: record.safeSource,
      attempts: record.attempts,
      latencyMs: record.latencyMs,
      parserValidatorResult: record.parserValidatorResult,
      reason: record.reason,
    };
    record.attemptHistory = [...(record.attemptHistory || []), audit];
    record.status = "NOT_TESTED";
    record.verifiedAt = null;
    compatibilityStore.set(key, record);
    recordModelOperationalAvailability({
      modelId: record.modelId,
      safeSource: record.safeSource,
      status: "ACCESS_UNAVAILABLE",
      attemptedAt: record.lastAttemptAt,
      role: record.role,
      configRevision: record.configRevision,
      latencyMs: record.latencyMs,
      providerOutcome: record.reason,
    });
    migrated++;
  }
  if (migrated > 0) saveCompatibilityStoreToDisk();
  return migrated;
}

/** Persists a genuine access failure observed before an older runner could classify it. */
export function recordRecoveredCanaryAccessAttempt(input: {
  modelId: string;
  role: string;
  configRevision: string;
  safeSource: SafeCredentialSource;
  attemptedAt: string;
  reason: string;
  latencyMs?: number;
}): ModelCompatibilityRecord {
  const key = buildCompatibilityKey(input.modelId, input.role, input.configRevision);
  const existing = compatibilityStore.get(key);
  const audit = {
    attemptedAt: input.attemptedAt,
    status: "NOT_TESTED" as CompatibilityStatus,
    safeSource: input.safeSource,
    attempts: 1,
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    parserValidatorResult: "NOT_REACHED" as const,
    reason: input.reason,
  };
  const record: ModelCompatibilityRecord = {
    modelId: normalizeModelId(input.modelId), role: input.role, configRevision: input.configRevision,
    status: "NOT_TESTED", verifiedAt: null, lastAttemptAt: input.attemptedAt,
    reason: input.reason, safeSource: input.safeSource, attempts: 1,
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    parserValidatorResult: "NOT_REACHED",
    attemptHistory: [...(existing?.attemptHistory || []), audit],
  };
  compatibilityStore.set(key, record);
  recordModelOperationalAvailability({
    modelId: record.modelId, safeSource: input.safeSource, status: "ACCESS_UNAVAILABLE",
    attemptedAt: input.attemptedAt, role: input.role, configRevision: input.configRevision,
    latencyMs: input.latencyMs, providerOutcome: input.reason,
  });
  saveCompatibilityStoreToDisk();
  return record;
}

function isTestExecutionActive(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a === "--test" || a.includes(".test.") || a.includes("test/"))
  );
}

/**
 * Saves compatibility records to local disk.
 */
export function saveCompatibilityStoreToDisk(): void {
  // CRITICAL: Prevent test execution from mutating production workspace state
  if (isTestExecutionActive() && !customCompatibilityFilePath && !isStorageTestOfflineMode()) {
    return;
  }

  // CRITICAL INVARIANT: Mocked/unit-test canaries MUST NOT contaminate production runtime stores
  if ((customCanarySeam || customCanaryResponseSeam) && !customCompatibilityFilePath) {
    return;
  }
  try {
    const filePath = getCompatibilityFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, ModelCompatibilityRecord> = {};
    for (const [k, v] of compatibilityStore.entries()) {
      obj[k] = v;
    }
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    serverLog("WARN", "CompatibilityGate", "Failed to persist compatibility store:", err?.message || err);
  }
}

/**
 * Checks if a given model/role/config revision has already been verified for compatibility.
 * A Technical canary PASS does NOT automatically verify Pathology or Validity.
 */
export function isModelCompatibilityVerified(
  modelId: string,
  role: string = "general",
  configRevision: string = "default"
): boolean {
  const normId = normalizeModelId(modelId);
  const exactKey = buildCompatibilityKey(normId, role, configRevision);
  const record = compatibilityStore.get(exactKey);
  if (record && record.status === "COMPATIBILITY_VERIFIED") return true;

  // If role is general, also check legacy key or any verified record for this model
  if (role === "general") {
    const legacyKey = `${normId}:${configRevision}`;
    const legacyRecord = compatibilityStore.get(legacyKey);
    if (legacyRecord && legacyRecord.status === "COMPATIBILITY_VERIFIED") return true;

    for (const r of compatibilityStore.values()) {
      if (r.modelId === normId && r.status === "COMPATIBILITY_VERIFIED") {
        return true;
      }
    }
  }

  // Check if a record with role === role or role === "all" exists
  const legacyKey = `${normId}:${configRevision}`;
  const legacyRecord = compatibilityStore.get(legacyKey);
  if (legacyRecord && (legacyRecord.role === role || legacyRecord.role === "all") && legacyRecord.status === "COMPATIBILITY_VERIFIED") {
    return true;
  }

  return false;
}

/**
 * Gets the current compatibility status for a model/role/config revision.
 */
export function getModelCompatibilityRecord(
  modelId: string,
  role: string = "general",
  configRevision: string = "default"
): ModelCompatibilityRecord | undefined {
  const normId = normalizeModelId(modelId);
  return (
    compatibilityStore.get(buildCompatibilityKey(normId, role, configRevision)) ||
    compatibilityStore.get(`${normId}:${configRevision}`)
  );
}

/**
 * Returns the exact compatibility status for a model/role/config.
 * If never tested with a real canary, returns "LEGACY_UNVERIFIED".
 */
export function getModelCompatibilityStatus(
  modelId: string,
  role: string = "general",
  configRevision: string = "default"
): CompatibilityStatus {
  const normId = normalizeModelId(modelId);
  const exactKey = buildCompatibilityKey(normId, role, configRevision);
  const exactRecord = compatibilityStore.get(exactKey);
  if (exactRecord) return exactRecord.status;

  const legacyKey = `${normId}:${configRevision}`;
  const legacyRecord = compatibilityStore.get(legacyKey);
  if (legacyRecord && (legacyRecord.role === role || legacyRecord.role === "all" || role === "general")) {
    return legacyRecord.status;
  }

  return "LEGACY_UNVERIFIED";
}

/**
 * Checks if a model has a hard contract incompatibility or active contract cooldown.
 */
export function isModelContractIncompatible(
  modelId: string,
  role: string = "general",
  configRevision: string = "default",
  nowMs: number = Date.now()
): boolean {
  const normId = normalizeModelId(modelId);
  const key = buildCompatibilityKey(normId, role, configRevision);
  const record = compatibilityStore.get(key);
  if (!record) return false;
  if (record.status === "FAILED_INCOMPATIBLE") return true;
  if (record.status === "CONTRACT_DEGRADED" || record.status === "CONTRACT_QUARANTINED") {
    // Lazy revalidation: 15 minutes degraded, 24 hours quarantined; no scheduled probe.
    const cooldownMs = record.status === "CONTRACT_QUARANTINED" ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
    const lastAttemptTime = new Date(record.lastAttemptAt).getTime();
    if (nowMs - lastAttemptTime < cooldownMs) {
      return true; // Still in cooldown for this contract
    }
    return false; // Cooldown expired, allow future retry
  }
  return false;
}

/**
 * Records an execution attempt where provider HTTP returned success but the production
 * parser/schema/semantic validator failed.
 * Single failure -> CONTRACT_DEGRADED (temporary cooldown, retryable later).
 * Repeated malformed responses -> CONTRACT_QUARANTINED (24-hour revalidation TTL).
 * Only deterministic capability/configuration failures -> FAILED_INCOMPATIBLE.
 */
export function recordContractIncompatibleAttempt(
  inputOrModelId: string | {
    modelId: string;
    role: string;
    configRevision: string;
    safeSource?: SafeCredentialSource;
    reason?: string;
    latencyMs?: number;
    attemptedAt?: string | number;
  },
  roleArg?: string,
  configRevisionArg?: string,
  deterministicOrReason?: boolean | string,
  attemptedAtArg?: number | string
): ModelCompatibilityRecord {
  let modelId: string;
  let role: string;
  let configRevision: string;
  let safeSource: SafeCredentialSource | undefined;
  let reason: string;
  let latencyMs: number | undefined;
  let rawAttemptedAt: string | number | undefined;
  let isDeterministicParam = false;

  if (typeof inputOrModelId === "string") {
    modelId = inputOrModelId;
    role = roleArg || "general";
    configRevision = configRevisionArg || "default";
    if (typeof deterministicOrReason === "boolean") {
      isDeterministicParam = deterministicOrReason;
      reason = isDeterministicParam ? "Deterministic capability defect" : "Malformed AI output";
    } else {
      reason = deterministicOrReason || "Malformed AI output";
    }
    rawAttemptedAt = attemptedAtArg;
  } else {
    modelId = inputOrModelId.modelId;
    role = inputOrModelId.role;
    configRevision = inputOrModelId.configRevision;
    safeSource = inputOrModelId.safeSource;
    reason = inputOrModelId.reason || "Malformed AI output";
    latencyMs = inputOrModelId.latencyMs;
    rawAttemptedAt = inputOrModelId.attemptedAt;
  }

  const normId = normalizeModelId(modelId);
  const key = buildCompatibilityKey(normId, role, configRevision);
  const existing = compatibilityStore.get(key);
  const attemptedAt = typeof rawAttemptedAt === "number"
    ? new Date(rawAttemptedAt).toISOString()
    : (rawAttemptedAt || new Date().toISOString());

  const isDeterministicHard = isDeterministicParam || /unsupported configuration|unsupported capability|not supported|invalid schema structure/i.test(reason);
  const previousConsecutiveFailures = existing?.status === "CONTRACT_QUARANTINED" || existing?.status === "CONTRACT_DEGRADED"
    ? (existing.attempts || 1)
    : 0;
  const consecutiveFailures = previousConsecutiveFailures + 1;

  const newStatus: CompatibilityStatus = isDeterministicHard ? "FAILED_INCOMPATIBLE"
    : consecutiveFailures >= 3 ? "CONTRACT_QUARANTINED" : "CONTRACT_DEGRADED";

  const audit = {
    attemptedAt,
    status: newStatus,
    safeSource,
    attempts: consecutiveFailures,
    latencyMs,
    parserValidatorResult: "FAIL" as const,
    reason,
  };

  const record: ModelCompatibilityRecord = {
    modelId: normId,
    role,
    configRevision,
    status: newStatus,
    verifiedAt: null,
    lastAttemptAt: attemptedAt,
    reason,
    safeSource,
    attempts: consecutiveFailures,
    latencyMs,
    parserValidatorResult: "FAIL",
    attemptHistory: [...(existing?.attemptHistory || []), audit],
  };

  compatibilityStore.set(key, record);
  saveCompatibilityStoreToDisk();
  return record;
}

/**
 * Records a successful runtime contract validation outcome.
 * Clears degraded/quarantined state and establishes COMPATIBILITY_VERIFIED.
 */
export function recordCompatibilitySuccess(
  inputOrModelId: string | {
    modelId: string;
    role: string;
    configRevision: string;
    safeSource?: SafeCredentialSource;
    latencyMs?: number;
    attemptedAt?: string | number;
  },
  roleArg?: string,
  configRevisionArg?: string,
  safeSourceArg?: SafeCredentialSource,
  latencyMsArg?: number,
  attemptedAtArg?: number | string
): ModelCompatibilityRecord {
  let modelId: string;
  let role: string;
  let configRevision: string;
  let safeSource: SafeCredentialSource | undefined;
  let latencyMs: number | undefined;
  let rawAttemptedAt: string | number | undefined;

  if (typeof inputOrModelId === "string") {
    modelId = inputOrModelId;
    role = roleArg || "general";
    configRevision = configRevisionArg || "default";
    safeSource = safeSourceArg;
    latencyMs = latencyMsArg;
    rawAttemptedAt = attemptedAtArg;
  } else {
    modelId = inputOrModelId.modelId;
    role = inputOrModelId.role;
    configRevision = inputOrModelId.configRevision;
    safeSource = inputOrModelId.safeSource;
    latencyMs = inputOrModelId.latencyMs;
    rawAttemptedAt = inputOrModelId.attemptedAt;
  }

  const normId = normalizeModelId(modelId);
  const key = buildCompatibilityKey(normId, role, configRevision);
  const existing = compatibilityStore.get(key);
  const attemptedAt = typeof rawAttemptedAt === "number"
    ? new Date(rawAttemptedAt).toISOString()
    : (rawAttemptedAt || new Date().toISOString());

  const record: ModelCompatibilityRecord = {
    modelId: normId,
    role,
    configRevision,
    status: "COMPATIBILITY_VERIFIED",
    verifiedAt: attemptedAt,
    lastAttemptAt: attemptedAt,
    safeSource,
    attempts: (existing?.attempts || 0) + 1,
    latencyMs,
    parserValidatorResult: "PASS",
    reason: `Verified at runtime for role [${role}]`,
    attemptHistory: [
      ...(existing?.attemptHistory || []),
      {
        attemptedAt,
        status: "COMPATIBILITY_VERIFIED",
        safeSource,
        attempts: 1,
        latencyMs,
        parserValidatorResult: "PASS",
        reason: `Runtime success for role [${role}]`,
      },
    ],
  };

  compatibilityStore.set(key, record);
  saveCompatibilityStoreToDisk();
  return record;
}

/**
 * Runs a one-time compatibility canary for a candidate model using the non-pilot fixture.
 * Ensures image accepted, generation config accepted, structured schema parses, and deadline respected.
 */
export async function runModelCompatibilityCanary(
  modelId: string,
  role: string = "general",
  configInputs?: CompatibilityConfigInputs | string,
  safeSourceOverride?: SafeCredentialSource
): Promise<ModelCompatibilityRecord> {
  const normId = normalizeModelId(modelId);
  const contract = getCanaryContractForRole(role);
  const configRevision =
    typeof configInputs === "string"
      ? configInputs
      : configInputs
      ? computeCompatibilityConfigIdentity(configInputs)
      : role === "general"
      ? "default"
      : contract.configRevision;

  const key = buildCompatibilityKey(normId, role, configRevision);
  const nowIso = new Date().toISOString();

  // If already verified for this exact role and config identity, do NOT run again (one-time requirement)
  const existing = compatibilityStore.get(key);
  if (existing && existing.status === "COMPATIBILITY_VERIFIED") {
    return existing;
  }

  serverLog(
    "INFO",
    "CompatibilityGate",
    `Running one-time compatibility canary for candidate model [${normId}] (role: ${role}, config: ${configRevision})`
  );

  // Test Seam execution
  if (customCanarySeam) {
    try {
      const outcome = await customCanarySeam(normId, role, configRevision);
      if (!outcome.ok && !outcome.transient) {
        return recordContractIncompatibleAttempt({ modelId: normId, role, configRevision, reason: outcome.reason });
      }
      let status: CompatibilityStatus = "COMPATIBILITY_VERIFIED";
      if (!outcome.ok) {
        status = outcome.transient ? "TRANSIENT_UNKNOWN" : "FAILED_INCOMPATIBLE";
      }
      const record: ModelCompatibilityRecord = {
        modelId: normId,
        role,
        configRevision,
        status,
        verifiedAt: status === "COMPATIBILITY_VERIFIED" ? nowIso : existing?.verifiedAt || null,
        lastAttemptAt: nowIso,
        reason: outcome.reason,
        ...(outcome.geometryQuality ? { geometryQuality: outcome.geometryQuality } : {}),
        ...(outcome.geometryWarning ? { geometryWarning: outcome.geometryWarning } : {}),
      };
      compatibilityStore.set(key, record);
      saveCompatibilityStoreToDisk();
      return record;
    } catch (err: any) {
      const isTransient = /429|503|timeout|overloaded|quota|resource_exhausted/i.test(err?.message || "");
      if (!isTransient) return recordContractIncompatibleAttempt({ modelId: normId, role, configRevision, reason: err?.message || String(err) });
      const record: ModelCompatibilityRecord = {
        modelId: normId,
        role,
        configRevision,
        status: "TRANSIENT_UNKNOWN",
        verifiedAt: existing?.verifiedAt || null,
        lastAttemptAt: nowIso,
        reason: err?.message || String(err),
      };
      compatibilityStore.set(key, record);
      saveCompatibilityStoreToDisk();
      return record;
    }
  }

  // Live execution using non-pilot fixture
  const fixtureFullPath = path.resolve(process.cwd(), NON_PILOT_FIXTURE_PATH);
  if (!fs.existsSync(fixtureFullPath)) {
    throw new CanaryRunnerSystemError(`Non-pilot fixture not found at ${NON_PILOT_FIXTURE_PATH}`);
  }

  const imageBuffer = fs.readFileSync(fixtureFullPath);
  const base64Data = imageBuffer.toString("base64");
  let liveSafeSource: SafeCredentialSource | undefined;
  let liveAttempts = 0;
  const liveStartedAt = Date.now();

  try {
    let responseText: string;

    if (customCanaryResponseSeam) {
      const seamResp = await customCanaryResponseSeam(normId, role, configRevision);
      if (!seamResp || typeof seamResp.text !== "string") {
        throw markCompatibilityFailure(new Error("Canary received empty response text"));
      }
      responseText = seamResp.text;
    } else {
      const sources = getApiKeySources();
      if (sources.length === 0) {
        throw new CanaryRunnerSystemError("No configured system credentials available to execute canary");
      }

      const prefersBackup = role === "technical_branch_b" || role === "pathology_branch_b";
      const requestedBackup = safeSourceOverride ? safeSourceOverride === "system_backup" : prefersBackup;
      const selectedSource = sources.find(source => source.isBackup === requestedBackup);
      if (!selectedSource) {
        throw new CanaryRunnerSystemError(`Requested credential source [${safeSourceOverride || (requestedBackup ? "system_backup" : "system_primary")}] is not configured`);
      }
      liveSafeSource = selectedSource.isBackup ? "system_backup" : "system_primary";
      const aiClient = createAiClient(selectedSource.key);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s deadline
      let response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;
      liveAttempts = 1;
      try {
        response = await aiClient.models.generateContent({
          model: normId,
          contents: {
            parts: [
              { inlineData: { mimeType: "image/webp", data: base64Data } },
              { text: contract.promptText },
            ],
          },
          config: {
            systemInstruction: contract.systemInstruction,
            temperature: contract.generationConfig.temperature,
            ...(contract.generationConfig.maxOutputTokens !== undefined
              ? { maxOutputTokens: contract.generationConfig.maxOutputTokens }
              : {}),
            responseMimeType: contract.generationConfig.responseMimeType,
            responseSchema: contract.schema,
            ...(contract.generationConfig.thinkingConfig ? { thinkingConfig: contract.generationConfig.thinkingConfig } : {}),
            abortSignal: controller.signal,
            httpOptions: { timeout: 35000 },
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.text) {
        throw markCompatibilityFailure(new Error("Canary received empty response text"));
      }
      responseText = response.text;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw markCompatibilityFailure(new Error("Canary received malformed JSON"));
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw markCompatibilityFailure(new Error("Canary parsed JSON is not an object"));
    }

    // Role-specific downstream validation
    let validationResult: any;
    try {
      validationResult = contract.validator(parsed);
    } catch (error) {
      throw markCompatibilityFailure(error instanceof Error ? error : new Error(String(error)));
    }
    const geometryQuality = validationResult?.geometryQuality as ("VERIFIED" | "GEOMETRY_DEGRADED" | undefined);
    const geometryWarning = Array.isArray(validationResult?.geometryWarnings) && validationResult.geometryWarnings.length > 0
      ? validationResult.geometryWarnings.join("; ")
      : undefined;

    const record: ModelCompatibilityRecord = {
      modelId: normId,
      role,
      configRevision,
      status: "COMPATIBILITY_VERIFIED",
      verifiedAt: nowIso,
      lastAttemptAt: nowIso,
      reason: geometryQuality === "GEOMETRY_DEGRADED"
        ? `Canary verified: valid semantic findings, geometry degraded (${geometryWarning})`
        : `Canary verified: fixture accepted, role [${role}] contract valid, deadline respected`,
      ...(geometryQuality ? { geometryQuality } : {}),
      ...(geometryWarning ? { geometryWarning } : {}),
      ...(liveSafeSource ? { safeSource: liveSafeSource } : {}),
      attempts: liveAttempts,
      latencyMs: Date.now() - liveStartedAt,
      parserValidatorResult: geometryQuality === "GEOMETRY_DEGRADED" ? "GEOMETRY_DEGRADED" : "PASS",
      ...(existing?.attemptHistory ? { attemptHistory: existing.attemptHistory } : {}),
    };
    compatibilityStore.set(key, record);
    if (liveSafeSource) recordModelOperationalAvailability({
      modelId: normId, safeSource: liveSafeSource, status: "AVAILABLE", attemptedAt: nowIso,
      role, configRevision, latencyMs: record.latencyMs, providerOutcome: record.reason,
    });
    saveCompatibilityStoreToDisk();
    serverLog("INFO", "CompatibilityGate", `Model [${normId}] successfully passed compatibility verification for role [${role}]`);
    return record;
  } catch (err: any) {
    if (err?.isCanaryRunnerSystemError) throw err;
    const classification = classifyCanaryProviderFailure(err);
    const isTransient = classification.transient;
    const isAccessUnavailable = classification.accessUnavailable;
    const isProviderCompatibilityFailure = classification.providerCompatibilityFailure;
    if (!isAccessUnavailable && !isTransient && !err?.isCompatibilityFailure && !isProviderCompatibilityFailure) {
      throw new CanaryRunnerSystemError(`Unexpected canary runner/provider error: ${sanitizeDiscoveryError(err)}`);
    }
    if (err?.isCompatibilityFailure && !isProviderCompatibilityFailure) {
      return recordContractIncompatibleAttempt({ modelId: normId, role, configRevision,
        safeSource: liveSafeSource, reason: sanitizeDiscoveryError(err),
        latencyMs: Date.now() - liveStartedAt, attemptedAt: nowIso });
    }
    const status: CompatibilityStatus = isAccessUnavailable ? "NOT_TESTED" : isTransient ? "TRANSIENT_UNKNOWN" : "FAILED_INCOMPATIBLE";
    const record: ModelCompatibilityRecord = {
      modelId: normId,
      role,
      configRevision,
      status,
      verifiedAt: null,
      lastAttemptAt: nowIso,
      reason: sanitizeDiscoveryError(err),
      ...(liveSafeSource ? { safeSource: liveSafeSource } : {}),
      attempts: liveAttempts,
      latencyMs: Date.now() - liveStartedAt,
      parserValidatorResult: err?.isCompatibilityFailure ? "FAIL" : "NOT_REACHED",
      attemptHistory: [...(existing?.attemptHistory || []), {
        attemptedAt: nowIso, status, ...(liveSafeSource ? { safeSource: liveSafeSource } : {}),
        attempts: liveAttempts, latencyMs: Date.now() - liveStartedAt,
        parserValidatorResult: err?.isCompatibilityFailure ? "FAIL" : "NOT_REACHED",
        reason: sanitizeDiscoveryError(err),
      }],
    };
    compatibilityStore.set(key, record);
    if (liveSafeSource) recordModelOperationalAvailability({
      modelId: normId,
      safeSource: liveSafeSource,
      status: isAccessUnavailable ? "ACCESS_UNAVAILABLE" : isTransient ? "TRANSIENT_UNKNOWN" : "AVAILABLE",
      attemptedAt: nowIso,
      role,
      configRevision,
      latencyMs: record.latencyMs,
      providerOutcome: record.reason,
    });
    saveCompatibilityStoreToDisk();
    serverLog(
      "WARN",
      "CompatibilityGate",
      `Canary failed for model [${normId}] role [${role}] (status: ${status}): ${record.reason}`
    );
    return record;
  }
}

/**
 * Returns all compatibility records.
 */
export function getAllCompatibilityRecords(): ModelCompatibilityRecord[] {
  return Array.from(compatibilityStore.values());
}

/**
 * Test Seam: Configure a custom canary runner.
 */
export function configureCanarySeamForTests(
  seam: ((modelId: string, role?: string, configIdentity?: string) => Promise<{ ok: boolean; transient?: boolean; reason?: string }>) | null
): void {
  customCanarySeam = seam;
}

/**
 * Test Seam: Directly set a compatibility record.
 * If role is omitted, populates default roles to preserve compatibility with existing test setups.
 */
export function setCompatibilityRecordForTests(
  modelId: string,
  status: CompatibilityStatus,
  role?: string,
  configRevision: string = "default"
): void {
  const normId = normalizeModelId(modelId);
  const nowIso = new Date().toISOString();
  const targetRoles = role
    ? [role]
    : [
        "general",
        "validity",
        "technical_branch_a",
        "technical_branch_b",
        "pathology_branch_a",
        "pathology_branch_b",
      ];

  for (const r of targetRoles) {
    const key = buildCompatibilityKey(normId, r, configRevision);
    compatibilityStore.set(key, {
      modelId: normId,
      role: r,
      configRevision,
      status,
      verifiedAt: status === "COMPATIBILITY_VERIFIED" ? nowIso : null,
      lastAttemptAt: nowIso,
    });

    if (r !== "general" && (configRevision === "default" || configRevision.startsWith("compat_"))) {
      const canonicalRev = getCanaryContractForRole(r).configRevision;
      const canonicalKey = buildCompatibilityKey(normId, r, canonicalRev);
      compatibilityStore.set(canonicalKey, {
        modelId: normId,
        role: r,
        configRevision: canonicalRev,
        status,
        verifiedAt: status === "COMPATIBILITY_VERIFIED" ? nowIso : null,
        lastAttemptAt: nowIso,
      });
    }
  }

  compatibilityStore.set(`${normId}:${configRevision}`, {
    modelId: normId,
    role: role || "all",
    configRevision,
    status,
    verifiedAt: status === "COMPATIBILITY_VERIFIED" ? nowIso : null,
    lastAttemptAt: nowIso,
  });
}

/**
 * Test Seam: Clear only in-memory store (simulating process restart).
 */
export function clearInMemoryCompatibilityStoreForTests(): void {
  compatibilityStore.clear();
  customCanarySeam = null;
  customCanaryResponseSeam = null;
}

/**
 * Test Seam: Reset compatibility store and tear down test configuration.
 */
export function resetCompatibilityStoreForTests(deleteTestFile = false): void {
  compatibilityStore.clear();
  customCanarySeam = null;
  customCanaryResponseSeam = null;
  if (deleteTestFile && customCompatibilityFilePath && fs.existsSync(customCompatibilityFilePath)) {
    try {
      fs.unlinkSync(customCompatibilityFilePath);
    } catch {}
  }
  customCompatibilityFilePath = null;
}
