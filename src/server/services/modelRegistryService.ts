import fs from "fs";
import path from "path";
import { serverLog } from "../config/env";
import { isStorageTestOfflineMode, getStorageRoot } from "../config/storagePaths";
import { createAiClient, getApiKeySources } from "./geminiService";
import { syncOfficialGooglePolicies } from "./modelPolicyService";
import { loadCompatibilityStoreFromDisk } from "./modelCompatibilityGate";
import { loadModelAvailabilityStoreFromDisk } from "./modelAvailabilityService";

export type SafeCredentialSource = "system_primary" | "system_backup";

export type ModelDiscoveryStatus =
  | "DISCOVERED"
  | "POLICY_ELIGIBLE"
  | "VERIFIED"
  | "BLOCKED"
  | "QUOTA_BLOCKED"
  | "TRANSIENT";

export interface DiscoveredModelMetadata {
  id: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  version?: string;
  status: ModelDiscoveryStatus;
  lastObservedAt?: string;
  lastStatusReason?: string;
}

export interface SourceRegistryEntry {
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  checkedAt?: string | null;
  status: "IDLE" | "DISCOVERING" | "READY" | "ERROR";
  error?: string;
  models: DiscoveredModelMetadata[];
}

export interface ModelRegistryData {
  registryVersion: string;
  lastCheckedAt: string | null;
  sources: {
    system_primary: SourceRegistryEntry;
    system_backup: SourceRegistryEntry;
  };
}

export const REGISTRY_VERSION = "1.0.0";
export const MODEL_DISCOVERY_TTL_MS = 72 * 60 * 60 * 1000; // 72 Hours
export const FAILURE_REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // 1 Hour

let inFlightRefreshPromise: Promise<ModelRegistryData> | null = null;
let lastFailureRefreshTimestamp = 0;
let customListModelsSeam: ((apiKey: string, source: SafeCredentialSource) => Promise<any[]>) | null = null;
let customRegistryFilePath: string | null = null;

// Initial in-memory state
function createEmptyRegistry(): ModelRegistryData {
  return {
    registryVersion: REGISTRY_VERSION,
    lastCheckedAt: null,
    sources: {
      system_primary: {
        lastAttemptAt: null,
        lastSuccessfulCheckAt: null,
        checkedAt: null,
        status: "IDLE",
        models: [],
      },
      system_backup: {
        lastAttemptAt: null,
        lastSuccessfulCheckAt: null,
        checkedAt: null,
        status: "IDLE",
        models: [],
      },
    },
  };
}

let activeRegistry: ModelRegistryData = createEmptyRegistry();

/**
 * Normalizes model names by stripping any leading "models/" prefix.
 */
export function normalizeModelId(rawName: string | undefined): string {
  if (!rawName) return "";
  const trimmed = rawName.trim();
  return trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
}

/**
 * Sanitizes provider and discovery error messages to strictly guarantee no
 * credentials, API keys, tokens, or query strings leak into memory, disk, or logs.
 */
export function sanitizeDiscoveryError(raw: any): string {
  if (!raw) return "";
  let text = typeof raw === "string" ? raw : (raw.message || raw.error?.message || String(raw));

  // 1. Redact known configured secrets from environment
  const configuredSecrets = [
    process.env.zknjght_key,
    process.env.GEMINI_API_KEY,
    process.env.ADMIN_PASSWORD,
    process.env.JWT_SECRET,
    process.env.STORAGE_SIGNING_SECRET,
  ].filter((s): s is string => !!s && s.trim().length > 3);

  for (const secret of configuredSecrets) {
    text = text.split(secret).join("[REDACTED_SECRET]");
  }

  // 2. Redact keys from getApiKeySources if available
  try {
    const sources = getApiKeySources();
    for (const src of sources) {
      if (src.key && src.key.trim().length > 3) {
        text = text.split(src.key).join("[REDACTED_KEY]");
      }
    }
  } catch {
    // Seam or offline environment may not have api key sources configured
  }

  // 3. Redact URL query parameters like ?key=... or &key=...
  text = text.replace(/([?&]key=)[^&\s"'`]+/gi, "$1[REDACTED]");

  // 4. Redact key=... parameters in URL or text
  text = text.replace(/(key=)[A-Za-z0-9_\-]+/gi, "$1[REDACTED]");

  // 5. Redact Bearer tokens
  text = text.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, "$1[REDACTED]");

  // 6. Redact Authorization headers
  text = text.replace(/(Authorization:\s*)[^\s]+/gi, "$1[REDACTED]");

  // 7. Redact generic Google API key pattern (AIza...)
  text = text.replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_API_KEY]");

  return text;
}

/**
 * Configure a custom path for the persisted model registry (test seam).
 */
export function configureModelRegistryPathForTests(customPath: string | null): void {
  customRegistryFilePath = customPath;
}

/**
 * Returns the absolute path where the safe model registry file is persisted.
 */
export function getModelRegistryFilePath(): string {
  if (customRegistryFilePath) {
    return customRegistryFilePath;
  }
  return path.join(getStorageRoot(), "runtime", "model_registry.json");
}

function isTestExecutionActive(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a === "--test" || a.includes(".test.") || a.includes("test/")) ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (typeof process.env.npm_lifecycle_event === "string" && process.env.npm_lifecycle_event.includes("test"))
  );
}

/**
 * Atomically writes the safe in-memory registry to local disk.
 * Strictly guarantees no API keys, tokens, or BYOK material are written.
 */
export function saveModelRegistryToDisk(registry: ModelRegistryData): void {
  const filePath = getModelRegistryFilePath();
  const repoRegistryPath = path.resolve(process.cwd(), "runtime", "model_registry.json");

  // CRITICAL R35.3 INVARIANT: Tests MUST NEVER mutate the repository's root runtime/model_registry.json
  if (path.resolve(filePath) === repoRegistryPath) {
    if (isTestExecutionActive() || isStorageTestOfflineMode()) {
      return;
    }
  }

  // CRITICAL: Prevent test execution from mutating production workspace state
  if (isTestExecutionActive() && !customRegistryFilePath && !isStorageTestOfflineMode()) {
    return;
  }

  try {
    const filePath = getModelRegistryFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const rawJson = JSON.stringify(registry, null, 2);
    const sanitizedJson = sanitizeDiscoveryError(rawJson);

    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, sanitizedJson, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    serverLog("WARN", "ModelRegistry", `Failed to persist model registry to disk: ${sanitizeDiscoveryError(err)}`);
  }
}

/**
 * Loads the persisted model registry from disk if available and valid.
 * Gracefully ignores missing or corrupted files, allowing discovery to rebuild.
 */
export function loadModelRegistryFromDisk(): ModelRegistryData | null {
  try {
    const filePath = getModelRegistryFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content || !content.trim()) {
      return null;
    }
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || parsed.registryVersion !== REGISTRY_VERSION || !parsed.sources) {
      serverLog("WARN", "ModelRegistry", "Persisted model registry file has invalid structure or version; ignoring.");
      return null;
    }
    if (!parsed.sources.system_primary || !parsed.sources.system_backup) {
      serverLog("WARN", "ModelRegistry", "Persisted model registry is missing sources; ignoring.");
      return null;
    }

    // Defensive normalization for backward compatibility
    for (const key of ["system_primary", "system_backup"] as SafeCredentialSource[]) {
      const src = parsed.sources[key];
      if (!src.models) src.models = [];
      if (src.lastAttemptAt === undefined) src.lastAttemptAt = src.checkedAt || null;
      if (src.lastSuccessfulCheckAt === undefined) {
        src.lastSuccessfulCheckAt = src.status === "READY" ? src.checkedAt || null : null;
      }
      if (src.checkedAt === undefined) {
        src.checkedAt = src.lastSuccessfulCheckAt || src.lastAttemptAt || null;
      }
    }

    return parsed as ModelRegistryData;
  } catch (err: any) {
    serverLog("WARN", "ModelRegistry", `Corrupted or unreadable model registry file; ignoring: ${sanitizeDiscoveryError(err)}`);
    return null;
  }
}

/**
 * Check if an individual credential source is fresh (< 72 hours since last successful check).
 */
export function isSourceFresh(
  entry: SourceRegistryEntry | undefined,
  maxAgeMs: number = MODEL_DISCOVERY_TTL_MS
): boolean {
  if (!entry || entry.status !== "READY" || !entry.lastSuccessfulCheckAt) {
    return false;
  }
  const checkedTime = new Date(entry.lastSuccessfulCheckAt).getTime();
  if (isNaN(checkedTime)) return false;
  return Date.now() - checkedTime < maxAgeMs;
}

/**
 * Computes the derived global lastCheckedAt for display purposes.
 * MUST NOT be used as the authoritative TTL gate.
 */
export function computeDerivedLastCheckedAt(sources: ModelRegistryData["sources"]): string | null {
  const dates = [sources.system_primary.lastSuccessfulCheckAt, sources.system_backup.lastSuccessfulCheckAt]
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  if (dates.length > 0) {
    return dates.sort().reverse()[0];
  }
  const attempts = [sources.system_primary.lastAttemptAt, sources.system_backup.lastAttemptAt]
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  if (attempts.length > 0) {
    return attempts.sort().reverse()[0];
  }
  return null;
}

/**
 * Check if the entire registry is fresh (all configured sources are individually fresh).
 */
export function isRegistryFresh(
  registry: ModelRegistryData = activeRegistry,
  maxAgeMs: number = MODEL_DISCOVERY_TTL_MS
): boolean {
  const sources: SafeCredentialSource[] = ["system_primary", "system_backup"];
  let checkedAny = false;
  for (const s of sources) {
    const entry = registry.sources[s];
    if (!entry) return false;
    const hasKey = !!getCredentialForSource(s) || !!customListModelsSeam;
    if (hasKey || entry.models.length > 0 || entry.lastAttemptAt !== null) {
      checkedAny = true;
      if (!isSourceFresh(entry, maxAgeMs)) {
        return false;
      }
    }
  }
  return checkedAny;
}

/**
 * Configure a test seam for models.list discovery calls.
 */
export function configureModelListSeamForTests(
  seam: ((apiKey: string, source: SafeCredentialSource) => Promise<any[]>) | null
): void {
  customListModelsSeam = seam;
}

/**
 * Reset in-memory registry and test file to initial state (useful for tests).
 */
export function resetModelRegistryForTests(): void {
  activeRegistry = createEmptyRegistry();
  inFlightRefreshPromise = null;
  lastFailureRefreshTimestamp = 0;
  customListModelsSeam = null;
  if (!customRegistryFilePath && !isStorageTestOfflineMode()) {
    return;
  }
  const filePath = customRegistryFilePath || path.join(getStorageRoot(), "runtime", "model_registry.json");
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}

/**
 * Simulates a process restart by wiping in-memory state while leaving disk untouched.
 */
export function simulateProcessRestartForTests(): void {
  activeRegistry = createEmptyRegistry();
  inFlightRefreshPromise = null;
  lastFailureRefreshTimestamp = 0;
}

/**
 * Set timestamps for testing TTL boundaries.
 */
export function setRegistryTimestampForTests(timestamp: string | number): void {
  const iso = typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp;
  activeRegistry.lastCheckedAt = iso;
  activeRegistry.sources.system_primary.lastAttemptAt = iso;
  activeRegistry.sources.system_primary.lastSuccessfulCheckAt = iso;
  activeRegistry.sources.system_primary.checkedAt = iso;
  activeRegistry.sources.system_primary.status = "READY";
  activeRegistry.sources.system_backup.lastAttemptAt = iso;
  activeRegistry.sources.system_backup.lastSuccessfulCheckAt = iso;
  activeRegistry.sources.system_backup.checkedAt = iso;
  activeRegistry.sources.system_backup.status = "READY";
}

/**
 * Get credentials for system sources safely without exposing them.
 */
function getCredentialForSource(source: SafeCredentialSource): string | null {
  const sources = getApiKeySources();
  if (source === "system_primary") {
    const primary = sources.find((s) => !s.isBackup);
    return primary ? primary.key : null;
  } else {
    const backup = sources.find((s) => s.isBackup);
    return backup ? backup.key : null;
  }
}

/**
 * Query models for a given API key via GoogleGenAI SDK or test seam.
 */
async function queryModelsFromGoogle(
  apiKey: string,
  source: SafeCredentialSource
): Promise<DiscoveredModelMetadata[]> {
  if (customListModelsSeam) {
    const rawList = await customListModelsSeam(apiKey, source);
    return (rawList || []).map((m: any) => ({
      id: normalizeModelId(m.name || m.id),
      displayName: m.displayName || undefined,
      description: m.description || undefined,
      supportedGenerationMethods: m.supportedGenerationMethods || m.supportedActions || undefined,
      inputTokenLimit: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : undefined,
      outputTokenLimit: typeof m.outputTokenLimit === "number" ? m.outputTokenLimit : undefined,
      version: m.version || undefined,
      status: "DISCOVERED" as ModelDiscoveryStatus,
    }));
  }

  const client = createAiClient(apiKey);
  const models: DiscoveredModelMetadata[] = [];

  const pager = await client.models.list();
  for await (const model of pager) {
    const id = normalizeModelId(model.name);
    if (!id) continue;
    models.push({
      id,
      displayName: model.displayName || undefined,
      description: model.description || undefined,
      supportedGenerationMethods: (model as any).supportedActions || (model as any).supportedGenerationMethods || undefined,
      inputTokenLimit: typeof model.inputTokenLimit === "number" ? model.inputTokenLimit : undefined,
      outputTokenLimit: typeof model.outputTokenLimit === "number" ? model.outputTokenLimit : undefined,
      version: model.version || undefined,
      status: "DISCOVERED",
    });
  }

  return models;
}

/**
 * Merges newly discovered models with previously known models, preserving
 * observation states such as VERIFIED, BLOCKED, etc.
 */
function mergeDiscoveredModels(
  existing: DiscoveredModelMetadata[],
  discovered: DiscoveredModelMetadata[]
): DiscoveredModelMetadata[] {
  const existingMap = new Map(existing.map((m) => [m.id, m]));
  return discovered.map((m) => {
    const prev = existingMap.get(m.id);
    if (prev) {
      return {
        ...m,
        // Retain verified or blocked observations if they were established during runtime
        status: prev.status === "VERIFIED" || prev.status === "BLOCKED" ? prev.status : "DISCOVERED",
        lastObservedAt: prev.lastObservedAt,
        lastStatusReason: prev.lastStatusReason,
      };
    }
    return m;
  });
}

/**
 * Refreshes the model registry for both primary and backup credentials independently.
 * Only queries sources that are stale or uninitialized, unless force is true.
 * Coalesces concurrent callers into a single in-flight Promise.
 */
export async function refreshModelRegistry(options?: {
  force?: boolean;
  triggeredBy?: string;
}): Promise<ModelRegistryData> {
  // If a refresh is already in progress, coalesce concurrent requests
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  const performRefresh = async (): Promise<ModelRegistryData> => {
    // If in-memory state is empty, try loading existing persisted registry first
    if (
      activeRegistry.sources.system_primary.status === "IDLE" &&
      activeRegistry.sources.system_backup.status === "IDLE"
    ) {
      const persisted = loadModelRegistryFromDisk();
      if (persisted) {
        activeRegistry = persisted;
      }
    }

    const trigger = options?.triggeredBy || "scheduled_or_manual";
    serverLog("INFO", "ModelRegistry", `Starting Gemini model discovery refresh [Trigger: ${trigger}]`);

    const sources: SafeCredentialSource[] = ["system_primary", "system_backup"];
    const nowIso = new Date().toISOString();

    for (const source of sources) {
      const currentEntry = activeRegistry.sources[source];

      // Per-source freshness check: if not forced and source is already fresh (<72h, READY), skip querying Google
      if (!options?.force && isSourceFresh(currentEntry)) {
        serverLog(
          "INFO",
          "ModelRegistry",
          `Model discovery skipped for ${source}: Source is fresh (<72h, status: READY)`
        );
        continue;
      }

      currentEntry.lastAttemptAt = nowIso;
      const apiKey = getCredentialForSource(source);

      if (!apiKey && !customListModelsSeam) {
        currentEntry.status = "ERROR";
        currentEntry.error = `Credential ${source} not configured`;
        currentEntry.checkedAt = nowIso;
        serverLog("WARN", "ModelRegistry", `Model discovery skipped for ${source}: Credential not configured`);
        continue;
      }

      currentEntry.status = "DISCOVERING";
      try {
        const discovered = await queryModelsFromGoogle(apiKey || "", source);
        currentEntry.models = mergeDiscoveredModels(currentEntry.models, discovered);
        currentEntry.status = "READY";
        currentEntry.error = undefined;
        currentEntry.lastSuccessfulCheckAt = nowIso;
        currentEntry.checkedAt = nowIso;
        serverLog(
          "INFO",
          "ModelRegistry",
          `Discovery succeeded for ${source}: ${discovered.length} models visible`
        );
      } catch (err: any) {
        currentEntry.status = "ERROR";
        currentEntry.error = sanitizeDiscoveryError(err);
        currentEntry.checkedAt = nowIso;
        // IMPORTANT: A failed discovery MUST NOT advance lastSuccessfulCheckAt!
        // Last-known-good models are retained.
        serverLog("WARN", "ModelRegistry", `Discovery failed for ${source}: ${currentEntry.error}`);
      }
    }

    activeRegistry.lastCheckedAt = computeDerivedLastCheckedAt(activeRegistry.sources);

    // Sync official policies for newly discovered or revalidation-due models
    const allModels = [
      ...activeRegistry.sources.system_primary.models,
      ...activeRegistry.sources.system_backup.models,
    ];
    await syncOfficialGooglePolicies(allModels, { force: options?.force });

    // Atomically persist safe registry to disk
    saveModelRegistryToDisk(activeRegistry);

    return activeRegistry;
  };

  inFlightRefreshPromise = performRefresh().finally(() => {
    inFlightRefreshPromise = null;
  });

  return inFlightRefreshPromise;
}

/**
 * Access the active Model Registry data.
 * Loads from disk if in-memory is empty.
 * Does NOT call models.list if the cached registry is fresh (< 72 hours).
 */
export async function getModelRegistryData(forceRefresh = false): Promise<ModelRegistryData> {
  if (
    activeRegistry.sources.system_primary.status === "IDLE" &&
    activeRegistry.sources.system_backup.status === "IDLE"
  ) {
    const persisted = loadModelRegistryFromDisk();
    if (persisted) {
      activeRegistry = persisted;
    }
  }

  if (!forceRefresh && isRegistryFresh(activeRegistry)) {
    return activeRegistry;
  }
  return refreshModelRegistry({ force: forceRefresh });
}

/**
 * Synchronous read of the current in-memory registry.
 */
export function getActiveRegistrySnapshot(): ModelRegistryData {
  return activeRegistry;
}

/**
 * Test-only seam to register a discovered model in the in-memory test registry.
 * Does not write to disk.
 */
export function injectDiscoveredModelForTests(
  source: SafeCredentialSource,
  modelId: string
): void {
  const normId = normalizeModelId(modelId);
  const sourceEntry = activeRegistry.sources[source];
  if (!sourceEntry) return;

  let modelMeta = sourceEntry.models.find((m) => m.id === normId);
  if (!modelMeta) {
    modelMeta = {
      id: normId,
      status: "DISCOVERED",
      version: "test",
      supportedGenerationMethods: ["generateContent"],
    };
    sourceEntry.models.push(modelMeta);
  }
}

/**
 * Determines if an error indicates that the model identity itself is stale or unavailable.
 */
export function isModelAvailabilityError(err: any): boolean {
  if (!err) return false;
  const code = err.code || err.status || err.statusCode || err.error?.code || err.error?.status;
  const str = (err.message || err.error?.message || String(err) || "").toLowerCase();

  // Model-not-found / decommissioned indications:
  if (code === 404 || code === "404" || code === "NOT_FOUND") {
    return true;
  }

  return (
    str.includes("is not found for api version") ||
    str.includes("model not found") ||
    str.includes("is not supported for generatecontent") ||
    str.includes("unsupported model") ||
    str.includes("decommissioned") ||
    str.includes("unknown model")
  );
}

/**
 * Trigger failure-guided registry refresh if appropriate, preventing refresh loops.
 * Specifically rejects 429, 503, timeout, cancelled, and invalidApiKey.
 */
export async function triggerFailureRefreshIfAppropriate(
  err: any,
  isQuota: boolean,
  isTransient: boolean,
  isInvalidKey: boolean
): Promise<boolean> {
  // Do NOT refresh on quota (429), overload/transient (503), cancellation, or invalid key
  if (isQuota || isTransient || isInvalidKey) {
    return false;
  }

  if (!isModelAvailabilityError(err)) {
    return false;
  }

  // Prevent refresh loops
  const now = Date.now();
  if (now - lastFailureRefreshTimestamp < FAILURE_REFRESH_COOLDOWN_MS) {
    serverLog("INFO", "ModelRegistry", "Failure-triggered refresh suppressed by cooldown");
    return false;
  }

  lastFailureRefreshTimestamp = now;
  serverLog("WARN", "ModelRegistry", "Model availability error detected. Triggering one-time registry refresh...");
  void refreshModelRegistry({ force: true, triggeredBy: "model_availability_error" }).catch((e) => {
    serverLog("WARN", "ModelRegistry", "Failure-triggered refresh failed:", sanitizeDiscoveryError(e));
  });

  return true;
}

/**
 * Non-blocking initialization for server startup.
 * Loads persisted local cache first.
 * Does not make discovery calls if all configured sources are fresh (<72h).
 */
export function initializeModelRegistryAsync(): void {
  // Load persisted compatibility records
  loadCompatibilityStoreFromDisk();
  loadModelAvailabilityStoreFromDisk();

  // 1. Load from disk cache
  const persisted = loadModelRegistryFromDisk();
  if (persisted) {
    activeRegistry = persisted;
    serverLog("INFO", "ModelRegistry", "Loaded model registry from local disk cache.");
  }

  // 2. Check freshness
  if (isRegistryFresh(activeRegistry)) {
    serverLog("INFO", "ModelRegistry", "Registry is fresh (<72h); using cached model registry.");
    return;
  }

  // 3. Trigger asynchronous background discovery for any stale/uninitialized sources
  serverLog("INFO", "ModelRegistry", "Registry is uninitialized or partially stale; initiating background refresh.");
  void refreshModelRegistry({ force: false, triggeredBy: "server_startup" }).catch((err) => {
    serverLog("WARN", "ModelRegistry", "Initial background discovery failed (non-blocking):", sanitizeDiscoveryError(err));
  });
}

/**
 * Returns a sanitized summary of the model registry suitable for Admin inspection
 * and serialization. Strictly guarantees NO API keys or secrets are exposed.
 */
export function getSanitizedRegistrySummary(): any {
  return {
    registryVersion: activeRegistry.registryVersion,
    lastCheckedAt: activeRegistry.lastCheckedAt,
    ttlHours: 72,
    isFresh: isRegistryFresh(activeRegistry),
    sources: {
      system_primary: {
        lastAttemptAt: activeRegistry.sources.system_primary.lastAttemptAt,
        lastSuccessfulCheckAt: activeRegistry.sources.system_primary.lastSuccessfulCheckAt,
        checkedAt: activeRegistry.sources.system_primary.lastSuccessfulCheckAt || activeRegistry.sources.system_primary.checkedAt || null,
        status: activeRegistry.sources.system_primary.status,
        error: activeRegistry.sources.system_primary.error,
        modelCount: activeRegistry.sources.system_primary.models.length,
        models: activeRegistry.sources.system_primary.models,
      },
      system_backup: {
        lastAttemptAt: activeRegistry.sources.system_backup.lastAttemptAt,
        lastSuccessfulCheckAt: activeRegistry.sources.system_backup.lastSuccessfulCheckAt,
        checkedAt: activeRegistry.sources.system_backup.lastSuccessfulCheckAt || activeRegistry.sources.system_backup.checkedAt || null,
        status: activeRegistry.sources.system_backup.status,
        error: activeRegistry.sources.system_backup.error,
        modelCount: activeRegistry.sources.system_backup.models.length,
        models: activeRegistry.sources.system_backup.models,
      },
    },
  };
}
