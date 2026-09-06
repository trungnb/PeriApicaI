import fs from "fs";
import path from "path";
import crypto from "crypto";
import { serverLog } from "../config/env";
import { getStorageRoot, isStorageTestOfflineMode } from "../config/storagePaths";
import {
  SafeCredentialSource,
  getActiveRegistrySnapshot,
  normalizeModelId,
} from "./modelRegistryService";
import {
  getAllPolicyRecords,
  getPolicyForModel,
  evaluateModelEligibility,
  isAliasModelId,
  isExactModelId,
  ModelFamily,
} from "./modelPolicyService";
import {
  isModelCompatibilityVerified,
  getModelCompatibilityStatus,
  getCanaryContractForRole,
} from "./modelCompatibilityGate";
import { getCombinedModelHealthScore } from "./modelHealthService";
import {
  getModelOperationalAvailability,
  isModelCredentialOperationallyEligible,
  type OperationalAvailabilityStatus,
} from "./modelAvailabilityService";
import type {
  RoleModelAssignment,
  AssessmentModelSnapshot,
} from "./assessmentModelSnapshot";
import {
  createAssessmentModelSnapshot,
  registerGlobalSnapshotResolver,
} from "./assessmentModelSnapshot";

export type AnalysisRole =
  | "validity"
  | "technical_branch_a"
  | "technical_branch_b"
  | "pathology_branch_a"
  | "pathology_branch_b";

export type { RoleModelAssignment, AssessmentModelSnapshot };

export type PolicyMode = "adaptive" | "cohort_frozen";

export interface ModelResolutionResult {
  modelId: string;
  role: AnalysisRole;
  isDiscovered: boolean;
  source?: SafeCredentialSource;
  policyApproved: boolean;
  analysisConfigVersion: string;
  matrixRevision?: string;
  selectionRationale?: string;
}

export interface CandidateEvaluation {
  modelId: string;
  role?: AnalysisRole;
  family: ModelFamily;
  lifecycle: string;
  isEligible: boolean;
  globalPolicyEligible?: boolean;
  roleEligible?: boolean;
  isCompatible: boolean;
  healthScore: number;
  compositeScore: number;
  rejectionReason?: string;
  operationallyEligibleSources?: SafeCredentialSource[];
}

export interface ControlPlaneState {
  policyMode: PolicyMode;
  cohortId?: string;
  matrixRevision: string;
  ladderRevision?: string;
  analysisConfigVersion: string;
  activeMatrix: Record<AnalysisRole, string>;
  roleAssignments?: Record<AnalysisRole, RoleModelAssignment>;
  roleLadders?: Record<AnalysisRole, string[]>;
  selectionRationales: Record<AnalysisRole, string>;
  candidates: CandidateEvaluation[];
}

export interface CohortFrozenRecord {
  cohortId: string;
  analysisConfigVersion: string;
  matrixRevision: string;
  frozenAt: string;
  activeMatrix: Record<AnalysisRole, string>;
}

export const ANALYSIS_CONFIG_VERSION = "2.9.0";

export const APPROVED_MODEL_MATRIX: readonly string[] = [
  "gemini-flash-latest",
  "gemini-pro-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
] as const;

export const DEFAULT_FROZEN_MATRIX: Record<AnalysisRole, string> = {
  validity: "gemini-flash-lite-latest",
  technical_branch_a: "gemini-flash-latest",
  technical_branch_b: "gemini-pro-latest",
  pathology_branch_a: "gemini-flash-latest",
  pathology_branch_b: "gemini-flash-lite-latest",
};

export const ACTIVE_FROZEN_MODEL_MATRIX = { ...DEFAULT_FROZEN_MATRIX };

let customPolicyMode: PolicyMode | null = null;

export function getPolicyMode(): PolicyMode {
  if (customPolicyMode) return customPolicyMode;
  const envMode = process.env.MODEL_POLICY_MODE?.toLowerCase();
  if (envMode === "adaptive") return "adaptive";
  return "cohort_frozen";
}

export function setPolicyModeForTests(mode: PolicyMode | null): void {
  customPolicyMode = mode;
}

export function getCohortId(): string {
  return process.env.PERIAPICAI_COHORT_ID || "cohort_v1";
}

let customCohortFrozenFilePath: string | null = null;

export function setCustomCohortFrozenFilePathForTests(filePath: string | null): void {
  customCohortFrozenFilePath = filePath;
}

export function getCohortFrozenFilePath(): string {
  if (customCohortFrozenFilePath) return customCohortFrozenFilePath;
  return path.join(getStorageRoot(), "runtime", "cohort_frozen_matrix.json");
}

export function parseModelVersion(modelId: string): { major: number; minor: number; patch: number } {
  const norm = normalizeModelId(modelId);
  const match = norm.match(/gemini-(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (match) {
    return {
      major: parseInt(match[1], 10),
      minor: match[2] ? parseInt(match[2], 10) : 0,
      patch: match[3] ? parseInt(match[3], 10) : 0,
    };
  }
  return { major: 0, minor: 0, patch: 0 };
}

export function compareModelVersionsDescending(a: string, b: string): number {
  const vA = parseModelVersion(a);
  const vB = parseModelVersion(b);
  if (vB.major !== vA.major) return vB.major - vA.major;
  if (vB.minor !== vA.minor) return vB.minor - vA.minor;
  if (vB.patch !== vA.patch) return vB.patch - vA.patch;
  return a.localeCompare(b);
}

/**
 * Builds deterministic, ordered exact-ID ladders for each role based strictly on:
 * - discovery
 * - official policy eligibility (Stable GA, Free Tier, General, structured output, image input)
 * - role family intent
 * - deterministic descending version order
 * - diversity policy between Branch A and Branch B
 *
 * Availability-independent: transient cooldown or 404 does NOT alter the base ladder!
 */
export function buildRoleLadders(options?: {
  activeMatrix?: Record<AnalysisRole, string>;
}): Record<AnalysisRole, string[]> {
  const registry = getActiveRegistrySnapshot();
  const discoveredModels = new Set<string>();
  for (const source of Object.values(registry.sources)) {
    for (const m of source.models || []) {
      discoveredModels.add(normalizeModelId(m.id));
    }
  }

  const allPolicyRecords = getAllPolicyRecords();
  const eligibleModelIds: string[] = [];

  for (const policy of allPolicyRecords) {
    const normId = normalizeModelId(policy.modelId);
    if (!isExactModelId(normId)) continue; // Reject aliases (*-latest)
    if (discoveredModels.size > 0 && !discoveredModels.has(normId)) continue; // Must be discovered
    const eligibility = evaluateModelEligibility(policy);
    if (eligibility.canAutoPromote) {
      eligibleModelIds.push(normId);
    }
  }

  // Fallback safe defaults if no eligible models found
  if (eligibleModelIds.length === 0) {
    eligibleModelIds.push("gemini-2.5-flash");
  }

  const eligibleFlashLite = eligibleModelIds
    .filter(id => getPolicyForModel(id)?.family === "FLASH_LITE")
    .sort(compareModelVersionsDescending);

  const eligibleFlash = eligibleModelIds
    .filter(id => getPolicyForModel(id)?.family === "FLASH")
    .sort(compareModelVersionsDescending);

  const eligiblePro = eligibleModelIds
    .filter(id => getPolicyForModel(id)?.family === "PRO")
    .sort(compareModelVersionsDescending);

  // Validity: Flash-Lite (newest -> older) then Flash (newest -> older). No Pro.
  let validityLadder = [...eligibleFlashLite, ...eligibleFlash];
  if (validityLadder.length === 0) validityLadder = ["gemini-2.5-flash"];

  // Technical Branch A: Flash (newest -> older)
  let techALadder = [...eligibleFlash];
  if (techALadder.length === 0) techALadder = ["gemini-2.5-flash"];

  // Pathology Branch A: Flash (newest -> older)
  let pathALadder = [...eligibleFlash];
  if (pathALadder.length === 0) pathALadder = ["gemini-2.5-flash"];

  // Technical Branch B: Stable eligible Pro first, then diverse alternative (Flash-Lite, then other Flash)
  const techAPrimary = techALadder[0];
  const techBOtherFlash = eligibleFlash.filter(m => m !== techAPrimary);
  let techBLadder = [...eligiblePro, ...eligibleFlashLite, ...techBOtherFlash];
  if (techAPrimary && !techBLadder.includes(techAPrimary)) {
    techBLadder.push(techAPrimary);
  }
  if (techBLadder.length === 0) techBLadder = ["gemini-2.5-flash"];

  // Pathology Branch B: Diverse from Branch A: Pro if eligible, then Flash-Lite, then other Flash
  const pathAPrimary = pathALadder[0];
  const pathBOtherFlash = eligibleFlash.filter(m => m !== pathAPrimary);
  let pathBLadder = [...eligiblePro, ...eligibleFlashLite, ...pathBOtherFlash];
  if (pathAPrimary && !pathBLadder.includes(pathAPrimary)) {
    pathBLadder.push(pathAPrimary);
  }
  if (pathBLadder.length === 0) pathBLadder = ["gemini-2.5-flash"];

  const ladders: Record<AnalysisRole, string[]> = {
    validity: validityLadder,
    technical_branch_a: techALadder,
    technical_branch_b: techBLadder,
    pathology_branch_a: pathALadder,
    pathology_branch_b: pathBLadder,
  };

  if (options?.activeMatrix) {
    for (const [r, incumbent] of Object.entries(options.activeMatrix)) {
      const role = r as AnalysisRole;
      if (incumbent && isExactModelId(incumbent) && ladders[role]?.includes(incumbent)) {
        ladders[role] = [incumbent, ...ladders[role].filter(m => m !== incumbent)];
      }
    }
  }

  return ladders;
}

/**
 * Builds canonical role assignments for the given role ladders.
 */
export function buildRoleAssignmentsForLadders(
  ladders: Record<AnalysisRole, string[]>,
  activeMatrix?: Record<AnalysisRole, string>
): Record<AnalysisRole, RoleModelAssignment> {
  const contracts = {
    validity: getCanaryContractForRole("validity"),
    technical_branch_a: getCanaryContractForRole("technical_branch_a"),
    technical_branch_b: getCanaryContractForRole("technical_branch_b"),
    pathology_branch_a: getCanaryContractForRole("pathology_branch_a"),
    pathology_branch_b: getCanaryContractForRole("pathology_branch_b"),
  };

  const roleAssignments: Partial<Record<AnalysisRole, RoleModelAssignment>> = {};
  const roles: AnalysisRole[] = [
    "validity",
    "technical_branch_a",
    "technical_branch_b",
    "pathology_branch_a",
    "pathology_branch_b",
  ];

  for (const role of roles) {
    const ladder = ladders[role] || ["gemini-2.5-flash"];
    const rawPrimary = activeMatrix?.[role];
    const primary = (rawPrimary && !isAliasModelId(rawPrimary) && ladder.includes(rawPrimary))
      ? rawPrimary
      : ladder[0];
    const fallbacks = ladder.filter(m => m !== primary);
    const contract = contracts[role];
    const credentialPreference: SafeCredentialSource[] = role.endsWith("_branch_b")
      ? ["system_backup", "system_primary"]
      : ["system_primary", "system_backup"];

    roleAssignments[role] = {
      primaryModel: primary,
      fallbackModels: fallbacks,
      modelLadder: [primary, ...fallbacks],
      credentialPreference,
      generationConfig: contract.generationConfig,
      compatibilityConfigIdentity: contract.configRevision,
      activeStatus: "ACTIVE",
      compatibilityStatus: getModelCompatibilityStatus(primary, role, contract.configRevision),
    };
  }

  return roleAssignments as Record<AnalysisRole, RoleModelAssignment>;
}

/**
 * Builds canonical standard role assignments for an active matrix.
 * Derives exact generation config and compatibilityConfigIdentity from authoritative role canary contracts.
 */
export function buildRoleAssignmentsForMatrix(
  activeMatrix: Record<AnalysisRole, string>
): Record<AnalysisRole, RoleModelAssignment> {
  const ladders = buildRoleLadders({ activeMatrix });
  const contracts = {
    validity: getCanaryContractForRole("validity"),
    technical_branch_a: getCanaryContractForRole("technical_branch_a"),
    technical_branch_b: getCanaryContractForRole("technical_branch_b"),
    pathology_branch_a: getCanaryContractForRole("pathology_branch_a"),
    pathology_branch_b: getCanaryContractForRole("pathology_branch_b"),
  };

  const roleAssignments: Partial<Record<AnalysisRole, RoleModelAssignment>> = {};
  const roles: AnalysisRole[] = [
    "validity",
    "technical_branch_a",
    "technical_branch_b",
    "pathology_branch_a",
    "pathology_branch_b",
  ];

  for (const role of roles) {
    const ladder = ladders[role] || ["gemini-2.5-flash"];
    const primary = activeMatrix[role] || ladder[0];
    const isHistoricalAlias = isAliasModelId(primary);
    const contract = contracts[role];
    const fallbacks = isHistoricalAlias
      ? (role === "technical_branch_b" ? ["gemini-flash-latest"] : role === "validity" ? ["gemini-flash-latest"] : ["gemini-flash-lite-latest"])
      : ladder.filter(m => m !== primary && getModelCompatibilityStatus(m, role, contract.configRevision) === "COMPATIBILITY_VERIFIED");
    const credentialPreference: SafeCredentialSource[] = role.endsWith("_branch_b")
      ? ["system_backup", "system_primary"]
      : ["system_primary", "system_backup"];

    roleAssignments[role] = {
      primaryModel: primary,
      fallbackModels: fallbacks,
      modelLadder: [primary, ...fallbacks],
      credentialPreference,
      generationConfig: contract.generationConfig,
      compatibilityConfigIdentity: contract.configRevision,
      activeStatus: "ACTIVE",
      compatibilityStatus: getModelCompatibilityStatus(primary, role, contract.configRevision),
    };
  }

  return roleAssignments as Record<AnalysisRole, RoleModelAssignment>;
}

export interface MatrixRevisionInputs {
  analysisConfigVersion?: string;
  policyMode?: PolicyMode;
  roleAssignments?: Record<AnalysisRole, RoleModelAssignment>;
  matrix?: Record<AnalysisRole, string>;
}

/**
 * Computes a deterministic SHA-256 hash representing the matrix revision.
 * Must include all inference-relevant non-secret state:
 * - exact primary model per role
 * - exact fallback models and order
 * - credential affinity and order
 * - generation and thinking config
 * - compatibility config identity
 * - analysisConfigVersion and policyMode
 */
export function computeMatrixRevisionHash(
  inputs: MatrixRevisionInputs | Record<AnalysisRole, string> | Record<AnalysisRole, RoleModelAssignment>
): string {
  let analysisConfigVersion = ANALYSIS_CONFIG_VERSION;
  let policyMode = getPolicyMode();
  let roleAssignments: Record<AnalysisRole, RoleModelAssignment>;

  if ("roleAssignments" in inputs && inputs.roleAssignments) {
    roleAssignments = inputs.roleAssignments;
    if (inputs.analysisConfigVersion) analysisConfigVersion = inputs.analysisConfigVersion;
    if (inputs.policyMode) policyMode = inputs.policyMode;
  } else if ("matrix" in inputs && inputs.matrix) {
    roleAssignments = buildRoleAssignmentsForMatrix(inputs.matrix);
    if (inputs.analysisConfigVersion) analysisConfigVersion = inputs.analysisConfigVersion;
    if (inputs.policyMode) policyMode = inputs.policyMode;
  } else if (
    inputs &&
    typeof inputs === "object" &&
    "validity" in inputs &&
    (inputs as any).validity &&
    typeof (inputs as any).validity === "object" &&
    "primaryModel" in (inputs as any).validity
  ) {
    roleAssignments = inputs as unknown as Record<AnalysisRole, RoleModelAssignment>;
  } else {
    // Passed directly as Record<AnalysisRole, string>
    const matrix = inputs as Record<AnalysisRole, string>;
    roleAssignments = buildRoleAssignmentsForMatrix(matrix);
  }

  const sortedRoles = (Object.keys(roleAssignments) as AnalysisRole[]).sort();
  const canonicalParts: string[] = [
    `v:${analysisConfigVersion}`,
    `mode:${policyMode}`,
  ];

  for (const role of sortedRoles) {
    const r = roleAssignments[role];
    if (!r) continue;
    const sortedGenConfig = r.generationConfig
      ? Object.keys(r.generationConfig)
          .sort()
          .map((k) => `${k}=${JSON.stringify((r.generationConfig as any)[k])}`)
          .join(",")
      : "";

    canonicalParts.push(
      `role=${role}|primary=${r.primaryModel}|fallbacks=${r.fallbackModels.join(",")}|creds=${r.credentialPreference.join(",")}|gen={${sortedGenConfig}}|compat=${r.compatibilityConfigIdentity || "none"}`
    );
  }

  return crypto.createHash("sha256").update(canonicalParts.join(";;")).digest("hex").slice(0, 16);
}

/** Versioned ordered-plan identity; R34 matrix hashing retains its historical fields. */
export function computeLadderRevisionHash(inputs: Parameters<typeof computeMatrixRevisionHash>[0]): string {
  const assignments = "roleAssignments" in inputs ? inputs.roleAssignments : inputs;
  const orderedLadders = Object.entries(assignments || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([role, assignment]) => [role, typeof assignment === "object" && assignment !== null
      ? assignment.modelLadder || [assignment.primaryModel, ...assignment.fallbackModels] : assignment]);
  return crypto.createHash("sha256").update(JSON.stringify([
    "ordered_ladder_v1", computeMatrixRevisionHash(inputs), orderedLadders,
  ])).digest("hex").slice(0, 16);
}

/**
 * Checks if a cohort frozen record contains any dynamic model aliases.
 */
export function isCohortUsingAliases(record: CohortFrozenRecord): boolean {
  if (!record || !record.activeMatrix) return false;
  return Object.values(record.activeMatrix).some((id) => isAliasModelId(id));
}

/**
 * Loads persisted cohort frozen record from disk.
 * Fails safely on corruption or mismatch without silently creating a different matrix.
 * Historical records containing aliases remain readable for audit/history without mutation.
 */
export function loadCohortFrozenRecordFromDisk(
  expectedCohortId: string = getCohortId()
): { record: CohortFrozenRecord | null; error?: string; isHistoricalAlias?: boolean } {
  try {
    const filePath = getCohortFrozenFilePath();
    if (!fs.existsSync(filePath)) {
      return { record: null };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      return { record: null, error: "Empty cohort frozen file" };
    }
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return { record: null, error: "Cohort frozen file is not a valid JSON object" };
    }

    if (!parsed.cohortId || typeof parsed.cohortId !== "string") {
      return { record: null, error: "Missing or invalid cohortId in frozen record" };
    }
    if (parsed.cohortId !== expectedCohortId) {
      return {
        record: null,
        error: `Cohort mismatch: expected ${expectedCohortId} but found ${parsed.cohortId}`,
      };
    }
    if (parsed.analysisConfigVersion !== ANALYSIS_CONFIG_VERSION) {
      return {
        record: null,
        error: `Analysis config version mismatch: expected ${ANALYSIS_CONFIG_VERSION} but found ${parsed.analysisConfigVersion}`,
      };
    }
    if (!parsed.activeMatrix || typeof parsed.activeMatrix !== "object") {
      return { record: null, error: "Missing activeMatrix in frozen record" };
    }

    const requiredRoles: AnalysisRole[] = [
      "validity",
      "technical_branch_a",
      "technical_branch_b",
      "pathology_branch_a",
      "pathology_branch_b",
    ];
    for (const r of requiredRoles) {
      if (!parsed.activeMatrix[r] || typeof parsed.activeMatrix[r] !== "string") {
        return { record: null, error: `Missing role ${r} in activeMatrix` };
      }
    }

    const record = parsed as CohortFrozenRecord;
    const isHistoricalAlias = isCohortUsingAliases(record);
    return { record, isHistoricalAlias };
  } catch (err: any) {
    return { record: null, error: `Failed to load cohort frozen record: ${err?.message || err}` };
  }
}

function isTestExecutionActive(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a === "--test" || a.includes(".test.") || a.includes("test/"))
  );
}

/**
 * Persists cohort frozen record to disk atomically with safe identity.
 * Rejects dynamic aliases (*-latest) unless explicitly declared as a historical record.
 */
export function saveCohortFrozenRecordToDisk(
  record: CohortFrozenRecord,
  options?: { allowHistoricalAlias?: boolean }
): void {
  // CRITICAL: Prevent test execution from mutating production workspace state
  if (isTestExecutionActive() && !customCohortFrozenFilePath && !isStorageTestOfflineMode()) {
    return;
  }

  if (!options?.allowHistoricalAlias) {
    for (const [role, modelId] of Object.entries(record.activeMatrix)) {
      if (isAliasModelId(modelId)) {
        throw new Error(
          `Cannot persist cohort frozen record: role [${role}] uses dynamic alias [${modelId}]. Only exact immutable model IDs are permitted.`
        );
      }
    }
  }

  try {
    const filePath = getCohortFrozenFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
    serverLog("INFO", "ModelResolver", `Persisted safe cohort frozen record for [${record.cohortId}] (rev: ${record.matrixRevision})`);
  } catch (err: any) {
    serverLog("WARN", "ModelResolver", `Failed to persist cohort frozen record: ${err?.message || err}`);
    throw err;
  }
}

/**
 * Derives a secondary freshness/version score from the model identifier.
 * Higher versions get minor priority (0-5 points), but never override health or compatibility.
 */
function getVersionFreshnessScore(modelId: string): number {
  const norm = normalizeModelId(modelId);
  const match = norm.match(/gemini-(\d+(?:\.\d+)?)/);
  if (match) {
    const versionNum = parseFloat(match[1]);
    return Math.min(versionNum, 5);
  }
  return 2;
}

/**
 * Evaluates and scores all discovered and policy-tracked candidates for a role.
 */
export function evaluateCandidatesForRole(
  role: AnalysisRole,
  incumbentModel: string,
  options: { planningOnly?: boolean } = {}
): { candidates: CandidateEvaluation[]; selectedModel: string; rationale: string } {
  const policies = getAllPolicyRecords();
  const evaluations: CandidateEvaluation[] = [];

  const credentialPreference: SafeCredentialSource[] = role.endsWith("_branch_b")
    ? ["system_backup", "system_primary"] : ["system_primary", "system_backup"];
  const stableProAvailable = policies.some(p => p.family === "PRO" &&
    evaluateModelEligibility(p).canAutoPromote && credentialPreference.some(source =>
      isModelCredentialOperationallyEligible(p.modelId, source, "generateContent")
    ));
  const targetFamily: ModelFamily = role === "validity" ? "FLASH_LITE"
    : role.endsWith("_branch_b") ? (stableProAvailable ? "PRO" : "FLASH_LITE") : "FLASH";

  for (const policy of policies) {
    const eligibility = evaluateModelEligibility(policy);
    const roleEligible = eligibility.canAutoPromote && policy.family === targetFamily;
    const operationallyEligibleSources = credentialPreference.filter(source =>
      isModelCredentialOperationallyEligible(policy.modelId, source, "generateContent")
    );
    // Role/workflow-specific compatibility check
    const configRevision = buildRoleAssignmentsForMatrix(DEFAULT_FROZEN_MATRIX)[role].compatibilityConfigIdentity!;
    const isCompatible = isModelCompatibilityVerified(policy.modelId, role, configRevision);
    const healthScore = getCombinedModelHealthScore(policy.modelId);

    let compositeScore = 0;
    let rejectionReason: string | undefined;

    if (!roleEligible) rejectionReason = `Role [${role}] requires ${targetFamily}; ${policy.family} is not a primary candidate`;
    if (roleEligible && operationallyEligibleSources.length === 0) {
      rejectionReason = `No operationally eligible generateContent credential remains for model [${policy.modelId}]`;
    }
    if (!eligibility.isEligible) {
      rejectionReason = eligibility.reason;
    }

    // 1. Lifecycle: Stable (40 pts) vs Preview (10 pts)
    if (policy.lifecycle === "STABLE") {
      compositeScore += 40;
    } else {
      compositeScore += 10;
      if (!rejectionReason) rejectionReason = "Non-stable preview model; barred from auto-promotion";
    }

    // 2. Compatibility (30 pts)
    if (isCompatible) {
      compositeScore += 30;
    } else {
      if (!rejectionReason && policy.lifecycle === "STABLE") {
        rejectionReason = `Compatibility verification pending for role [${role}]`;
      }
    }

    // 3. Runtime Health (up to 25 pts)
    compositeScore += Math.round((healthScore / 100) * 25);

    // 4. Role Family Alignment (up to 20 pts)
    if (policy.family === targetFamily) {
      compositeScore += 20;
    } else if (targetFamily === "FLASH_LITE" && policy.family === "FLASH") {
      compositeScore += 10;
    } else if (targetFamily === "PRO" && policy.family === "FLASH") {
      compositeScore += 10;
    }

    // 5. Incumbent stability bonus (+10 pts to prevent thrashing)
    if (policy.modelId === incumbentModel) {
      compositeScore += 10;
    }

    // 6. Version freshness (0-5 pts secondary factor)
    compositeScore += getVersionFreshnessScore(policy.modelId);

    if (!roleEligible || operationallyEligibleSources.length === 0) compositeScore = 0;
    evaluations.push({
      modelId: policy.modelId,
      role,
      family: policy.family,
      lifecycle: policy.lifecycle,
      isEligible: eligibility.isEligible,
      globalPolicyEligible: eligibility.canAutoPromote,
      roleEligible,
      isCompatible,
      healthScore,
      compositeScore,
      rejectionReason,
      operationallyEligibleSources,
    });
  }

  // Filter candidates that are genuinely eligible and auto-promotable (strictly exact model IDs)
  const qualified = evaluations
    .filter(
      (e) =>
        e.isEligible && e.roleEligible && (e.operationallyEligibleSources?.length || 0) > 0 &&
        e.lifecycle === "STABLE" &&
        isExactModelId(e.modelId) &&
        (options.planningOnly || e.isCompatible || (e.modelId === incumbentModel && isExactModelId(incumbentModel)))
    )
    .sort((a, b) => b.compositeScore - a.compositeScore);

  let selectedModel = incumbentModel;
  let rationale = `Retained incumbent [${incumbentModel}]`;

  if (qualified.length > 0) {
    const topCandidate = qualified[0];
    if (topCandidate.modelId !== incumbentModel) {
      // Candidate must beat incumbent by at least 5 points to trigger replacement
      const incumbentEval = evaluations.find((e) => e.modelId === incumbentModel);
      const incumbentScore = incumbentEval?.roleEligible ? incumbentEval.compositeScore : 0;
      if (topCandidate.compositeScore > incumbentScore + 5) {
        selectedModel = topCandidate.modelId;
        rationale = `Promoted [${selectedModel}] (Score: ${topCandidate.compositeScore} vs Incumbent: ${incumbentScore})`;
      } else {
        rationale = `Retained incumbent [${incumbentModel}] (Score: ${incumbentScore} held against top candidate ${topCandidate.modelId}: ${topCandidate.compositeScore})`;
      }
    } else {
      rationale = `Incumbent [${incumbentModel}] ranked highest among qualified candidates (Score: ${topCandidate.compositeScore})`;
    }
  }

  return { candidates: evaluations, selectedModel, rationale };
}

/**
 * Read-only historical diagnostics. Cohort persistence requires an explicit dedicated operation.
 */
export function resolveControlPlaneState(): ControlPlaneState {
  const mode = getPolicyMode();
  const activeMatrix: Record<AnalysisRole, string> = { ...DEFAULT_FROZEN_MATRIX };
  const selectionRationales: Record<AnalysisRole, string> = {
    validity: "Cohort frozen default",
    technical_branch_a: "Cohort frozen default",
    technical_branch_b: "Cohort frozen default",
    pathology_branch_a: "Cohort frozen default",
    pathology_branch_b: "Cohort frozen default",
  };

  const allCandidates: CandidateEvaluation[] = [];

  const roles: AnalysisRole[] = [
    "validity",
    "technical_branch_a",
    "technical_branch_b",
    "pathology_branch_a",
    "pathology_branch_b",
  ];

  if (mode === "cohort_frozen") {
    const loaded = loadCohortFrozenRecordFromDisk();
    if (loaded.record) {
      for (const role of roles) {
        activeMatrix[role] = loaded.record.activeMatrix[role];
        selectionRationales[role] = `Cohort frozen [${loaded.record.cohortId}]: persisted matrix enforced.`;
      }
    } else if (loaded.error) {
      serverLog(
        "WARN",
        "ModelResolver",
        `Cohort frozen integrity error: ${loaded.error}. Safe fallback retained without silent re-resolution.`
      );
    }
  }

  for (const role of roles) {
    const incumbent = activeMatrix[role];
    const { candidates, selectedModel, rationale } = evaluateCandidatesForRole(role, incumbent);

    if (mode === "adaptive") {
      activeMatrix[role] = selectedModel;
      selectionRationales[role] = rationale;
    } else if (mode === "cohort_frozen") {
      // Retain cohort incumbent, but record shadow adaptive evaluation
      if (!selectionRationales[role]?.startsWith("Cohort frozen [")) {
        selectionRationales[role] = `Cohort frozen: retained incumbent [${incumbent}]. (Adaptive top pick: ${selectedModel})`;
      }
    }

    for (const c of candidates) {
      if (!allCandidates.some((existing) => existing.modelId === c.modelId && existing.role === c.role)) {
        allCandidates.push(c);
      }
    }
  }

  const ladders = buildRoleLadders({ activeMatrix });
  const roleAssignments = mode === "cohort_frozen"
    ? buildRoleAssignmentsForMatrix(activeMatrix)
    : buildRoleAssignmentsForLadders(ladders, activeMatrix);
  const matrixRevision = computeMatrixRevisionHash({
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    policyMode: mode,
    roleAssignments,
  });

  return {
    policyMode: mode,
    cohortId: mode === "cohort_frozen" ? getCohortId() : undefined,
    matrixRevision,
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    activeMatrix,
    roleAssignments,
    roleLadders: ladders,
    selectionRationales,
    candidates: allCandidates,
  };
}

/**
 * Resolves model for a role according to current control plane state.
 */
export function resolveModelForRole(
  role: AnalysisRole,
  source?: SafeCredentialSource
): ModelResolutionResult {
  const controlPlane = resolveControlPlaneState();
  const modelId = controlPlane.activeMatrix[role];
  const normId = normalizeModelId(modelId);

  let isDiscovered = false;
  if (source) {
    const registry = getActiveRegistrySnapshot();
    const sourceEntry = registry.sources[source];
    if (sourceEntry && sourceEntry.models) {
      isDiscovered = sourceEntry.models.some((m) => m.id === normId);
    }
  }

  const policyApproved = APPROVED_MODEL_MATRIX.includes(normId as any);

  return {
    modelId,
    role,
    isDiscovered,
    source,
    policyApproved,
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    matrixRevision: controlPlane.matrixRevision,
    selectionRationale: controlPlane.selectionRationales[role],
  };
}

/**
 * Checks if a given model ID is part of the approved matrix.
 */
export function isModelApproved(modelId: string): boolean {
  return APPROVED_MODEL_MATRIX.includes(normalizeModelId(modelId) as any);
}

/**
 * Resolves model with preferredModel fallback.
 */
export function resolveModelWithFallback(
  role: AnalysisRole,
  preferredModel?: string,
  source?: SafeCredentialSource
): ModelResolutionResult {
  if (preferredModel && isModelApproved(preferredModel)) {
    const normId = normalizeModelId(preferredModel);
    let isDiscovered = false;
    if (source) {
      const registry = getActiveRegistrySnapshot();
      const sourceEntry = registry.sources[source];
      if (sourceEntry && sourceEntry.models) {
        isDiscovered = sourceEntry.models.some((m) => m.id === normId);
      }
    }
    const controlPlane = resolveControlPlaneState();
    return {
      modelId: preferredModel,
      role,
      isDiscovered,
      source,
      policyApproved: true,
      analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
      matrixRevision: controlPlane.matrixRevision,
      selectionRationale: `User preferred approved model [${preferredModel}]`,
    };
  }

  return resolveModelForRole(role, source);
}

/**
 * Creates and freezes the complete model matrix snapshot for an assessment session.
 * Snapshot is immutable and completely insulates the assessment from concurrent refreshes.
 */
export function resolveAssessmentModelSnapshot(
  preferredRoleModels?: Partial<Record<AnalysisRole, string>>
): AssessmentModelSnapshot {
  // Production selection is independent of the historical R34 scoring/promotion view.
  const policyMode = getPolicyMode();
  const ladders = buildRoleLadders();
  const roleAssignments = buildRoleAssignmentsForLadders(ladders);

  if (preferredRoleModels) {
    for (const [r, m] of Object.entries(preferredRoleModels)) {
      const role = r as AnalysisRole;
      if (m) {
        const policy = getPolicyForModel(m);
        const discovered = Object.values(getActiveRegistrySnapshot().sources)
          .some(source => source.models?.some(model => normalizeModelId(model.id) === m));
        if (!isExactModelId(m) || !discovered || !policy ||
            !evaluateModelEligibility(policy).canAutoPromote || !ladders[role]?.includes(m)) {
          throw Object.assign(new Error(`Model preference [${m}] is not eligible for role [${role}]`),
            { code: 400, status: 400 });
        }
        roleAssignments[role].primaryModel = m;
        const currentLadder = roleAssignments[role].modelLadder || [m, ...roleAssignments[role].fallbackModels];
        roleAssignments[role].modelLadder = [m, ...currentLadder.filter((x: string) => x !== m)];
        roleAssignments[role].fallbackModels = roleAssignments[role].modelLadder.filter((x: string) => x !== m);
      }
    }
  }

  const matrixRevision = computeLadderRevisionHash({
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    policyMode,
    roleAssignments,
  });

  return createAssessmentModelSnapshot(
    matrixRevision,
    ANALYSIS_CONFIG_VERSION,
    policyMode,
    roleAssignments,
    { resolverPlanType: "ordered_ladder_v1" }
  );
}

// Register global resolver so assessmentModelSnapshot.ts can instantiate on demand
registerGlobalSnapshotResolver(resolveAssessmentModelSnapshot);

/** Read-only plan: no inference, activation, compatibility writes or cohort creation. */
export function buildExactCanaryPlan(matrix: Record<AnalysisRole, string>) {
  const assignments = buildRoleAssignmentsForMatrix(matrix);
  const calls = Object.entries(assignments).flatMap(([role, assignment]) =>
    [...new Set([assignment.primaryModel, ...assignment.fallbackModels])].map(modelId => ({
      modelId, role: role as AnalysisRole,
      configRevision: assignment.compatibilityConfigIdentity!,
      credentialAffinity: assignment.credentialPreference,
      compatibilityStatus: getModelCompatibilityStatus(modelId, role, assignment.compatibilityConfigIdentity!),
    })));
  if (calls.some(call => isAliasModelId(call.modelId))) throw new Error("Exact canary plan cannot contain aliases");
  return { assignments, calls, minimumCalls: calls.filter(call => call.compatibilityStatus !== "COMPATIBILITY_VERIFIED").length,
    fullyVerified: calls.every(call => call.compatibilityStatus === "COMPATIBILITY_VERIFIED") };
}

export interface FreezeRoleReadiness {
  role: AnalysisRole;
  modelId: string;
  configRevision: string;
  compatibilityStatus: string;
  preferredCredential: SafeCredentialSource;
  preferredCredentialAvailability: OperationalAvailabilityStatus;
  backupCredential: SafeCredentialSource;
  backupCredentialAvailability: OperationalAvailabilityStatus;
  alternateModelFallbacks: string[];
  ready: boolean;
  reasons: string[];
}

/** Read-only exact-matrix readiness check. It never creates or freezes a cohort. */
export function evaluateExactMatrixFreezeReadiness(matrix: Record<AnalysisRole, string>): {
  ready: boolean;
  matrixRevision: string;
  deterministicMatrixRevision: boolean;
  roles: FreezeRoleReadiness[];
} {
  const assignments = buildRoleAssignmentsForMatrix(matrix);
  const revisionInput: MatrixRevisionInputs = {
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    policyMode: "cohort_frozen",
    roleAssignments: assignments,
  };
  const matrixRevision = computeMatrixRevisionHash(revisionInput);
  const deterministicMatrixRevision = matrixRevision === computeMatrixRevisionHash(revisionInput);
  const roles = (Object.keys(assignments) as AnalysisRole[]).map(role => {
    const assignment = assignments[role];
    const configRevision = assignment.compatibilityConfigIdentity || "";
    const compatibilityStatus = getModelCompatibilityStatus(assignment.primaryModel, role, configRevision);
    const [preferredCredential, backupCredential] = assignment.credentialPreference as [SafeCredentialSource, SafeCredentialSource];
    const preferredCredentialAvailability = getModelOperationalAvailability(assignment.primaryModel, preferredCredential)?.status || "UNKNOWN";
    const backupCredentialAvailability = getModelOperationalAvailability(assignment.primaryModel, backupCredential)?.status || "UNKNOWN";
    const invalidFallbacks = assignment.fallbackModels.filter(modelId =>
      !isExactModelId(modelId) || !isModelCompatibilityVerified(modelId, role, configRevision)
    );
    const reasons: string[] = [];
    if (!isExactModelId(assignment.primaryModel)) reasons.push("PRIMARY_MODEL_IS_NOT_EXACT");
    if (compatibilityStatus !== "COMPATIBILITY_VERIFIED") reasons.push("PRIMARY_NOT_COMPATIBILITY_VERIFIED");
    if (preferredCredentialAvailability !== "AVAILABLE" && backupCredentialAvailability !== "AVAILABLE") {
      reasons.push("NO_AVAILABLE_SYSTEM_CREDENTIAL");
    }
    if (invalidFallbacks.length > 0) reasons.push("UNVERIFIED_ALTERNATE_MODEL_FALLBACK");
    return {
      role,
      modelId: assignment.primaryModel,
      configRevision,
      compatibilityStatus,
      preferredCredential,
      preferredCredentialAvailability,
      backupCredential,
      backupCredentialAvailability,
      alternateModelFallbacks: [...assignment.fallbackModels],
      ready: reasons.length === 0,
      reasons,
    };
  });
  return {
    ready: deterministicMatrixRevision && roles.every(role => role.ready),
    matrixRevision,
    deterministicMatrixRevision,
    roles,
  };
}
