import crypto from "crypto";
import { serverLog } from "../config/env";
import { DiscoveredModelMetadata, normalizeModelId } from "./modelRegistryService";

export type ModelFamily = "FLASH" | "FLASH_LITE" | "PRO" | "OTHER";

export type ModelLifecycle =
  | "STABLE"
  | "PREVIEW"
  | "EXPERIMENTAL"
  | "DEPRECATED"
  | "RETIRED"
  | "UNKNOWN";

export type ModelSpecialization =
  | "GENERAL"
  | "MULTIMODAL_IMAGE_GEN"
  | "AUDIO_SPEECH"
  | "LIVE_BIDIRECTIONAL"
  | "EMBEDDING"
  | "ROBOTICS"
  | "COMPUTER_USE"
  | "OTHER"
  | "UNKNOWN";

export interface ModelPolicyRecord {
  modelId: string;
  family: ModelFamily;
  lifecycle: ModelLifecycle;
  specialization: ModelSpecialization;
  supportsGenerateContent: boolean;
  supportsImageInput: boolean;
  supportsStructuredOutput: boolean;
  freeTierPublished: boolean;
  thinkingConfigRequired?: boolean;
  deprecationDate?: string;
  shutdownDate?: string;
  officialDocumentationUrl: string; // Authority strictly: https://ai.google.dev/...
  checkedAt: string;
  evidenceUrls?: string[];
}

export interface ModelEligibilityResult {
  modelId: string;
  isEligible: boolean;
  canAutoPromote: boolean;
  reason: string;
  policy: ModelPolicyRecord;
}

export const POLICY_REVALIDATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days

export const OFFICIAL_AI_GOOGLE_DEV_ORIGIN = "https://ai.google.dev";

export const OFFICIAL_AUTHORITY_URLS = {
  MODELS_CATALOGUE: "https://ai.google.dev/gemini-api/docs/models",
  LIFECYCLE: "https://ai.google.dev/gemini-api/docs/deprecations",
  GENERATE_CONTENT_API: "https://ai.google.dev/api/generate-content",
  GENERATION: "https://ai.google.dev/gemini-api/docs/generate-content/thinking",
  PRICING: "https://ai.google.dev/gemini-api/docs/pricing",
  LEGACY_MODELS: "https://ai.google.dev/gemini-api/docs/models/gemini#legacy-models",
} as const;

// In-memory policy cache indexed by normalized modelId
const policyStore = new Map<string, ModelPolicyRecord>();
let lastGlobalPolicyCheckAt: string | null = null;
let lastKnownCatalogueHash: string | null = null;
let customPolicyFetcherSeam: ((modelId: string) => Promise<ModelPolicyRecord | null>) | null = null;

/**
 * Validates that an authoritative policy URL originates strictly from ai.google.dev.
 */
export function isAllowedOfficialPolicyUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.origin === OFFICIAL_AI_GOOGLE_DEV_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Authoritative official Google documentation catalog for known Gemini models on ai.google.dev.
 * Authority: https://ai.google.dev/gemini-api/docs/models/gemini
 */
export const CANONICAL_OFFICIAL_POLICIES: Record<string, Omit<ModelPolicyRecord, "modelId" | "checkedAt">> = {
  "gemini-2.5-flash": {
    family: "FLASH",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash",
  },
  "gemini-2.5-pro": {
    family: "PRO",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-pro",
  },
  "gemini-2.5-flash-lite": {
    family: "FLASH_LITE",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash-lite",
  },
  "gemini-flash-latest": {
    family: "FLASH",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-flash-latest",
  },
  "gemini-pro-latest": {
    family: "PRO",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-pro-latest",
  },
  "gemini-flash-lite-latest": {
    family: "FLASH_LITE",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-flash-lite-latest",
  },
  "gemini-3.1-flash-lite": {
    family: "FLASH_LITE", lifecycle: "STABLE", specialization: "GENERAL",
    supportsGenerateContent: true, supportsImageInput: true,
    supportsStructuredOutput: true, freeTierPublished: true,
    thinkingConfigRequired: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite",
    evidenceUrls: [
      "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite",
      OFFICIAL_AUTHORITY_URLS.PRICING, OFFICIAL_AUTHORITY_URLS.LIFECYCLE,
      OFFICIAL_AUTHORITY_URLS.GENERATION,
    ],
    shutdownDate: "2027-05-07",
  },
  "gemini-3.5-flash": {
    family: "FLASH", lifecycle: "STABLE", specialization: "GENERAL",
    supportsGenerateContent: true, supportsImageInput: true,
    supportsStructuredOutput: true, freeTierPublished: true,
    thinkingConfigRequired: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash",
    evidenceUrls: [
      "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash",
      OFFICIAL_AUTHORITY_URLS.PRICING, OFFICIAL_AUTHORITY_URLS.LIFECYCLE,
      OFFICIAL_AUTHORITY_URLS.GENERATION,
    ],
  },
  "gemini-3.5-flash-lite": {
    family: "FLASH_LITE", lifecycle: "STABLE", specialization: "GENERAL",
    supportsGenerateContent: true, supportsImageInput: true,
    supportsStructuredOutput: true, freeTierPublished: true,
    thinkingConfigRequired: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite",
    evidenceUrls: [
      "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite",
      OFFICIAL_AUTHORITY_URLS.PRICING, OFFICIAL_AUTHORITY_URLS.LIFECYCLE,
      OFFICIAL_AUTHORITY_URLS.GENERATION,
    ],
  },
  "gemini-3.6-flash": {
    family: "FLASH", lifecycle: "STABLE", specialization: "GENERAL",
    supportsGenerateContent: true, supportsImageInput: true,
    supportsStructuredOutput: true, freeTierPublished: true,
    thinkingConfigRequired: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
    evidenceUrls: [
      "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
      OFFICIAL_AUTHORITY_URLS.PRICING, OFFICIAL_AUTHORITY_URLS.LIFECYCLE,
      OFFICIAL_AUTHORITY_URLS.GENERATION,
    ],
  },
  "gemini-3.7-flash": {
    family: "FLASH",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-3.7-flash",
  },
  "gemini-3.8-flash": {
    family: "FLASH",
    lifecycle: "STABLE",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#gemini-3.8-flash",
  },
  "gemini-2.0-flash": {
    family: "FLASH",
    lifecycle: "DEPRECATED",
    specialization: "GENERAL",
    supportsGenerateContent: true,
    supportsImageInput: true,
    supportsStructuredOutput: true,
    freeTierPublished: false,
    deprecationDate: "2026-03-01",
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/gemini#legacy-models",
  },
  "imagen-3.0-generate-002": {
    family: "OTHER",
    lifecycle: "STABLE",
    specialization: "MULTIMODAL_IMAGE_GEN",
    supportsGenerateContent: false,
    supportsImageInput: false,
    supportsStructuredOutput: false,
    freeTierPublished: false,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/imagen",
  },
  "text-embedding-004": {
    family: "OTHER",
    lifecycle: "STABLE",
    specialization: "EMBEDDING",
    supportsGenerateContent: false,
    supportsImageInput: false,
    supportsStructuredOutput: false,
    freeTierPublished: true,
    officialDocumentationUrl: "https://ai.google.dev/gemini-api/docs/models/embeddings",
  },
};

/** Reviewed facts are sourced independently; no model-name capability inference. */
export interface OfficialPolicyDocument { url: string; content: string }
export function mergeOfficialPolicyEvidence(modelId: string, documents: OfficialPolicyDocument[], nowIso: string): ModelPolicyRecord {
  const canonical = CANONICAL_OFFICIAL_POLICIES[modelId];
  const allowed = documents.filter(d => isAllowedOfficialPolicyUrl(d.url));
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const exact = allowed.find(d => d.url === `https://ai.google.dev/gemini-api/docs/models/${modelId}`);
  const modelText = exact ? text(exact.content) : "";
  const pricing = allowed.find(d => d.url === OFFICIAL_AUTHORITY_URLS.PRICING);
  // Each pricing heading owns its own table. Another model's free tier is not evidence.
  const priceSection = pricing?.content.split(/(?=<h2\b)/i).find(section => {
    const heading = section.split(/<h[23]\b/i).slice(0,2).join(' ');
    return new RegExp(`(?:>|\\s|\\x60)${modelId}(?:<|\\s|\\x60)`).test(heading);
  });
  const priceText = text(priceSection || "");
  const lifecycleDoc = allowed.find(d => d.url === OFFICIAL_AUTHORITY_URLS.LIFECYCLE);
  const row = lifecycleDoc?.content.split(/<tr\b/i).find(row => {
    const firstCell = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    return firstCell && text(firstCell[1]).trim() === modelId;
  });
  const lifecycleText = text(row || "");
  const generationDoc = allowed.find(d => (d.url === OFFICIAL_AUTHORITY_URLS.GENERATION || d.url === OFFICIAL_AUTHORITY_URLS.GENERATE_CONTENT_API) && text(d.content).split(/[^a-zA-Z0-9_.-]+/).includes(modelId));
  const generationEvidence = !!generationDoc || /generate_content|generateContent/.test(modelText);
  const hasLifecycle = !!lifecycleText;
  const stable = modelText.includes(`Stable: ${modelId}`);
  const complete = !!canonical && stable && hasLifecycle && !!generationEvidence &&
    /Inputs?[^]*?Image[^]*?Output[^]*?Text/i.test(modelText) &&
    /Structured outputs\s+Supported/i.test(modelText) && /Input price(?:\s*\([^)]*\))?\s+Free of charge/i.test(priceText);
  return {
    modelId, family: canonical?.family || "OTHER", specialization: complete ? canonical.specialization : "UNKNOWN",
    lifecycle: complete ? canonical.lifecycle : "UNKNOWN",
    supportsGenerateContent: !!generationEvidence, supportsImageInput: /Inputs?[^]*?Image/i.test(modelText),
    supportsStructuredOutput: /Structured outputs\s+Supported/i.test(modelText),
    freeTierPublished: /Input price(?:\s*\([^)]*\))?\s+Free of charge/i.test(priceText),
    ...(complete && canonical.shutdownDate ? {shutdownDate: canonical.shutdownDate} : {}),
    officialDocumentationUrl: `https://ai.google.dev/gemini-api/docs/models/${modelId}`,
    evidenceUrls: allowed.map(d => d.url), checkedAt: nowIso,
  };
}

/**
 * Fetches an official documentation document from ai.google.dev.
 * Enforces strict domain validation, read-only GET, and a 10s deadline.
 */
export async function fetchOfficialPolicyDoc(
  urlStr: string = OFFICIAL_AUTHORITY_URLS.MODELS_CATALOGUE
): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (!isAllowedOfficialPolicyUrl(urlStr)) {
    return {
      ok: false,
      error: `Unauthorized policy source: URL must originate strictly from ${OFFICIAL_AI_GOOGLE_DEV_ORIGIN}`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const requestedUrl = new URL(urlStr);
    requestedUrl.searchParams.set("hl", "en");
    let currentUrl = requestedUrl.href;
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "PeriApicAI-ControlPlane/1.0",
        "Accept": "text/html,application/xhtml+xml,text/plain",
        "Accept-Language": "en",
      },
      signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects >= 4) return {ok:false,error:"Invalid/excessive official redirect"};
      currentUrl = new URL(location,currentUrl).href;
      if (!isAllowedOfficialPolicyUrl(currentUrl)) return {ok:false,error:"Non-official redirect rejected"};
    }

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from ${urlStr}` };
    }

    const content = await response.text();
    return { ok: true, content };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Detects if a model identifier represents a moving/dynamic provider alias rather than an immutable exact model ID.
 * Examples: *-latest, latest, *-default, default.
 */
export function isAliasModelId(modelId: string): boolean {
  if (!modelId || typeof modelId !== "string") return false;
  const norm = normalizeModelId(modelId).toLowerCase();
  return (
    norm.endsWith("-latest") ||
    norm.includes("-latest-") ||
    norm === "latest" ||
    norm.endsWith("-default") ||
    norm === "default"
  );
}

/**
 * Checks if a model identifier is an immutable exact model ID.
 */
export function isExactModelId(modelId: string): boolean {
  if (!modelId || typeof modelId !== "string") return false;
  return !isAliasModelId(modelId);
}

/**
 * Classifies model specialization.
 */
export function classifySpecialization(modelId: string): ModelSpecialization {
  const norm = normalizeModelId(modelId).toLowerCase();

  if (norm.includes("live") || norm.includes("streaming") || norm.includes("omni")) {
    return "LIVE_BIDIRECTIONAL";
  }
  if (norm.includes("tts") || norm.includes("speech") || norm.includes("transcribe") || norm.includes("audio")) {
    return "AUDIO_SPEECH";
  }
  if (norm.includes("imagen") || norm.includes("image-gen") || norm.endsWith("-image") || norm.includes("-image-")) {
    return "MULTIMODAL_IMAGE_GEN";
  }
  if (norm.includes("embedding")) {
    return "EMBEDDING";
  }
  if (norm.includes("robotics") || norm.includes("rt-")) {
    return "ROBOTICS";
  }
  if (norm.includes("computer-use") || norm.includes("cua")) {
    return "COMPUTER_USE";
  }
  if (norm.includes("gemini")) {
    return "GENERAL";
  }
  return "OTHER";
}

/**
 * Classifies model family based on model architecture identifier.
 */
export function classifyFamily(modelId: string): ModelFamily {
  const norm = normalizeModelId(modelId).toLowerCase();
  if (norm.includes("flash-lite")) return "FLASH_LITE";
  if (norm.includes("flash")) return "FLASH";
  if (norm.includes("pro")) return "PRO";
  return "OTHER";
}

/**
 * Classifies model lifecycle state based on naming tokens.
 */
export function classifyLifecycle(modelId: string): ModelLifecycle {
  const norm = normalizeModelId(modelId).toLowerCase();
  if (norm.includes("deprecated") || norm.includes("decommissioned")) return "DEPRECATED";
  if (norm.includes("retired") || norm.includes("shutdown")) return "RETIRED";
  if (norm.includes("preview")) return "PREVIEW";
  if (norm.includes("exp") || norm.includes("experimental")) return "EXPERIMENTAL";
  return "STABLE";
}

/**
 * Resolves official policy for a given model ID.
 * Authority strictly restricted to ai.google.dev documentation.
 * Missing evidence => UNKNOWN, never inferred.
 */
export async function resolveOfficialPolicyForModel(
  modelId: string,
  nowIso: string = new Date().toISOString(),
  _docContent?: string
): Promise<ModelPolicyRecord> {
  const normId = normalizeModelId(modelId);

  // If a test seam is configured, use it
  if (customPolicyFetcherSeam) {
    const customPolicy = await customPolicyFetcherSeam(normId);
    if (customPolicy) {
      policyStore.set(normId, customPolicy);
      return customPolicy;
    }
  }

  // Check official canonical definitions from ai.google.dev
  const canonical = CANONICAL_OFFICIAL_POLICIES[normId];
  if (canonical) {
    const record: ModelPolicyRecord = {
      modelId: normId,
      ...canonical,
      checkedAt: nowIso,
    };
    policyStore.set(normId, record);
    return record;
  }

  // A name appearing in an official document establishes no capability facts.
  // Unknown models require an explicit, reviewed multi-source policy record.
  // Missing evidence => UNKNOWN, never inferred.
  const unknownRecord: ModelPolicyRecord = {
    modelId: normId,
    family: "OTHER",
    lifecycle: "UNKNOWN",
    specialization: "UNKNOWN",
    supportsGenerateContent: false,
    supportsImageInput: false,
    supportsStructuredOutput: false,
    freeTierPublished: false,
    officialDocumentationUrl: `${OFFICIAL_AUTHORITY_URLS.MODELS_CATALOGUE}#${normId}`,
    checkedAt: nowIso,
  };

  policyStore.set(normId, unknownRecord);
  return unknownRecord;
}

/**
 * Computes a deterministic hash of the relevant Gemini general catalogue.
 */
export function computeCatalogueHash(models: DiscoveredModelMetadata[]): string {
  const relevantIds = models
    .map((m) => normalizeModelId(m.id))
    .filter((id) => {
      const lower = id.toLowerCase();
      return lower.includes("gemini") && (lower.includes("flash") || lower.includes("pro"));
    })
    .sort();
  return crypto.createHash("sha256").update(relevantIds.join(",")).digest("hex");
}

/**
 * Checks if the official Google policy cache requires 7-day revalidation.
 */
export function isPolicyRevalidationDue(lastCheck: string | null, nowMs: number = Date.now()): boolean {
  if (!lastCheck) return true;
  const time = new Date(lastCheck).getTime();
  if (isNaN(time)) return true;
  return nowMs - time >= POLICY_REVALIDATION_TTL_MS;
}

/**
 * Syncs official Google policy for discovered models.
 * Early-exits if catalogue is unchanged and policy was validated < 7 days ago.
 * Performs real read-only official doc fetch when sync is executed.
 * Fetch failure fails safely and preserves existing policies without advancing revalidation timestamp.
 */
export async function syncOfficialGooglePolicies(
  models: DiscoveredModelMetadata[],
  options?: { force?: boolean }
): Promise<{ syncedCount: number; revalidated: boolean; catalogueChanged: boolean; error?: string }> {
  const currentHash = computeCatalogueHash(models);
  const catalogueChanged = lastKnownCatalogueHash === null || currentHash !== lastKnownCatalogueHash;
  const revalidationDue = isPolicyRevalidationDue(lastGlobalPolicyCheckAt);

  if (!options?.force && !catalogueChanged && !revalidationDue) {
    serverLog(
      "INFO",
      "ModelPolicy",
      "Official Google policy sync skipped: catalogue unchanged and policy validated < 7 days ago."
    );
    return { syncedCount: 0, revalidated: false, catalogueChanged: false };
  }

  let docContent: string | undefined;
  let fetchedDocuments: OfficialPolicyDocument[] = [];
  let fetchSucceeded = false;
  if (!customPolicyFetcherSeam) {
    const urls = new Set<string>([
      OFFICIAL_AUTHORITY_URLS.MODELS_CATALOGUE, OFFICIAL_AUTHORITY_URLS.PRICING,
      OFFICIAL_AUTHORITY_URLS.LIFECYCLE, OFFICIAL_AUTHORITY_URLS.GENERATION, OFFICIAL_AUTHORITY_URLS.GENERATE_CONTENT_API,
    ]);
    for (const model of models) {
      const policy = CANONICAL_OFFICIAL_POLICIES[normalizeModelId(model.id)];
      if (policy && isExactModelId(model.id) && policy.specialization === "GENERAL") urls.add(`https://ai.google.dev/gemini-api/docs/models/${normalizeModelId(model.id)}`);
      for (const url of policy?.evidenceUrls || []) urls.add(url);
    }
    const documents = await Promise.all([...urls].map(async url => ({
      url, ...(await fetchOfficialPolicyDoc(url)),
    })));
    fetchedDocuments = documents.filter(d => d.ok && d.content).map(d => ({url:d.url,content:d.content!}));
    fetchSucceeded = documents.every(doc => doc.ok && doc.content);
    docContent = documents.filter(doc => doc.ok).map(doc => doc.content).join("\n");
    if (!fetchSucceeded) serverLog("WARN", "ModelPolicy",
      "Incomplete official evidence retrieval; retaining reviewed policy snapshot without advancing revalidation timestamp.");
  } else {
    fetchSucceeded = true;
  }

  const nowIso = new Date().toISOString();
  let synced = 0;

  for (const m of models) {
    const normId = normalizeModelId(m.id);
    const spec = classifySpecialization(normId);
    if (spec === "GENERAL") {
      if (fetchSucceeded && !customPolicyFetcherSeam && isExactModelId(normId)) {
        policyStore.set(normId, mergeOfficialPolicyEvidence(normId, fetchedDocuments, nowIso));
      } else if (!getPolicyForModel(normId) || customPolicyFetcherSeam) {
        await resolveOfficialPolicyForModel(normId, customPolicyFetcherSeam ? nowIso : "2026-09-05T00:00:00.000Z", docContent);
      }
      synced++;
    }
  }

  if (fetchSucceeded) {
    lastKnownCatalogueHash = currentHash;
    lastGlobalPolicyCheckAt = nowIso;
  }

  serverLog(
    "INFO",
    "ModelPolicy",
    `Official Google policy synced for ${synced} relevant models [CatalogueChanged: ${catalogueChanged}, RevalidationDue: ${revalidationDue}, FetchSucceeded: ${fetchSucceeded}]`
  );

  return { syncedCount: synced, revalidated: revalidationDue, catalogueChanged };
}

/**
 * Evaluates whether a discovered model meets all criteria for eligibility and auto-promotion.
 */
export function evaluateModelEligibility(policy: ModelPolicyRecord): ModelEligibilityResult {
  if (isAliasModelId(policy.modelId)) {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Dynamic provider alias (*-latest) barred from immutable active/frozen matrix",
      policy,
    };
  }

  if (policy.lifecycle === "UNKNOWN") {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Missing official documentation evidence on ai.google.dev (lifecycle: UNKNOWN)",
      policy,
    };
  }

  if (!policy.supportsGenerateContent) {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Model does not support generateContent",
      policy,
    };
  }

  if (!policy.supportsImageInput) {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Model does not support multimodal image input",
      policy,
    };
  }

  if (!policy.supportsStructuredOutput) {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Model does not support structured JSON outputs",
      policy,
    };
  }

  if (policy.specialization !== "GENERAL") {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: `Specialized model (${policy.specialization}) cannot be used for general diagnostic assessment`,
      policy,
    };
  }

  if (policy.lifecycle === "DEPRECATED" || policy.lifecycle === "RETIRED") {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: `Model is ${policy.lifecycle.toLowerCase()}`,
      policy,
    };
  }

  if (!policy.freeTierPublished) {
    return {
      modelId: policy.modelId,
      isEligible: false,
      canAutoPromote: false,
      reason: "Model does not have published Google Free Tier availability",
      policy,
    };
  }

  // Model is technically policy-eligible
  const isStableGA = policy.lifecycle === "STABLE";
  const canAutoPromote = isStableGA;

  return {
    modelId: policy.modelId,
    isEligible: true,
    canAutoPromote,
    reason: canAutoPromote
      ? "Fully eligible Stable GA model with Free Tier published availability"
      : `Eligible for observed preview but cannot auto-promote (Lifecycle: ${policy.lifecycle})`,
    policy,
  };
}

/**
 * Get all cached policy records.
 */
export function getAllPolicyRecords(): ModelPolicyRecord[] {
  if (policyStore.size === 0) {
    for (const [id, canon] of Object.entries(CANONICAL_OFFICIAL_POLICIES)) {
      policyStore.set(id, {
        modelId: id,
        ...canon,
        checkedAt: "2026-09-05T00:00:00.000Z",
      });
    }
  }
  return Array.from(policyStore.values());
}

/**
 * Get cached policy for a specific model ID.
 */
export function getPolicyForModel(modelId: string): ModelPolicyRecord | undefined {
  const normId = normalizeModelId(modelId);
  const existing = policyStore.get(normId);
  if (existing) return existing;
  const canonical = CANONICAL_OFFICIAL_POLICIES[normId];
  if (canonical) {
    const record: ModelPolicyRecord = {
      modelId: normId,
      ...canonical,
      checkedAt: "2026-09-05T00:00:00.000Z",
    };
    policyStore.set(normId, record);
    return record;
  }
  return undefined;
}

/**
 * Test Seam: Configure a custom policy fetcher for tests.
 */
export function configurePolicyFetcherSeamForTests(
  seam: ((modelId: string) => Promise<ModelPolicyRecord | null>) | null
): void {
  customPolicyFetcherSeam = seam;
}

/**
 * Test Seam: Reset policy state for testing.
 */
export function resetPolicyStoreForTests(): void {
  policyStore.clear();
  lastGlobalPolicyCheckAt = null;
  lastKnownCatalogueHash = null;
  customPolicyFetcherSeam = null;
}

/**
 * Test Seam: Set the lastGlobalPolicyCheckAt timestamp.
 */
export function setGlobalPolicyTimestampForTests(iso: string | null): void {
  lastGlobalPolicyCheckAt = iso;
}

/**
 * Test Seam: Get the last global policy check timestamp.
 */
export function getGlobalPolicyTimestamp(): string | null {
  return lastGlobalPolicyCheckAt;
}

/**
 * Test Seam: Explicitly register or override a policy record for testing.
 */
export function setPolicyRecordForTests(
  modelId: string,
  record?: Partial<ModelPolicyRecord>
): ModelPolicyRecord {
  const normId = normalizeModelId(modelId);
  const fullRecord: ModelPolicyRecord = {
    modelId: normId,
    family: record?.family || "FLASH",
    lifecycle: record?.lifecycle || "STABLE",
    specialization: record?.specialization || "GENERAL",
    supportsGenerateContent: record?.supportsGenerateContent ?? true,
    supportsImageInput: record?.supportsImageInput ?? true,
    supportsStructuredOutput: record?.supportsStructuredOutput ?? true,
    freeTierPublished: record?.freeTierPublished ?? true,
    officialDocumentationUrl: record?.officialDocumentationUrl || `https://ai.google.dev/gemini-api/docs/models/gemini#${normId}`,
    checkedAt: record?.checkedAt || new Date().toISOString(),
    ...record,
  };
  policyStore.set(normId, fullRecord);
  return fullRecord;
}
