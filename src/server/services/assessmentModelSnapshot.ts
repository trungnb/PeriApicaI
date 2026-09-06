import crypto from "crypto";
import { SafeCredentialSource } from "./modelRegistryService";
import { isAliasModelId } from "./modelPolicyService";
import type { AnalysisRole } from "./modelResolverService";

export interface RoleModelAssignment {
  primaryModel: string;
  fallbackModels: string[];
  modelLadder?: string[];
  credentialPreference: SafeCredentialSource[];
  generationConfig: {
    temperature: number;
    maxOutputTokens?: number;
    responseMimeType: string;
    thinkingConfig?: any;
    [key: string]: any;
  };
  compatibilityConfigIdentity?: string;
  activeStatus?: "ACTIVE" | "INACTIVE";
  compatibilityStatus?: string;
}

export interface AssessmentModelSnapshot {
  snapshotId: string;
  matrixRevision: string;
  ladderRevision?: string;
  resolverPlanType?: "ordered_ladder_v1";
  analysisConfigVersion: string;
  policyMode: "adaptive" | "cohort_frozen";
  createdAt: string;
  roles: Record<AnalysisRole, RoleModelAssignment>;
}

// In-memory cache of running assessment snapshots keyed by snapshotId
const activeAssessmentSnapshots = new Map<string, AssessmentModelSnapshot>();
// In-memory mapping from assessmentId to snapshotId
const assessmentToSnapshotMap = new Map<string, string>();

// Hoisted resolver function reference (var avoids TDZ in circular import graphs)
var globalSnapshotResolver: ((preferredRoleModels?: Partial<Record<AnalysisRole, string>>) => AssessmentModelSnapshot) | null = null;

export function registerGlobalSnapshotResolver(
  resolver: (preferredRoleModels?: Partial<Record<AnalysisRole, string>>) => AssessmentModelSnapshot
): void {
  globalSnapshotResolver = resolver;
}

/**
 * Validates that all primary and fallback model IDs in roles are exact immutable IDs (no dynamic aliases).
 */
export function validateSnapshotRolesExact(
  roles: Record<AnalysisRole, RoleModelAssignment>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [role, assignment] of Object.entries(roles)) {
    if (isAliasModelId(assignment.primaryModel)) {
      errors.push(`Role [${role}] primaryModel is dynamic alias [${assignment.primaryModel}]`);
    }
    for (const fb of assignment.fallbackModels) {
      if (isAliasModelId(fb)) {
        errors.push(`Role [${role}] fallbackModel is dynamic alias [${fb}]`);
      }
    }
    if (assignment.modelLadder) {
      for (const m of assignment.modelLadder) {
        if (isAliasModelId(m)) {
          errors.push(`Role [${role}] modelLadder contains dynamic alias [${m}]`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Creates an immutable snapshot for an assessment session.
 */
export function createAssessmentModelSnapshot(
  matrixRevision: string,
  analysisConfigVersion: string,
  policyMode: "adaptive" | "cohort_frozen",
  roles: Record<AnalysisRole, RoleModelAssignment>,
  options?: { disallowAliases?: boolean; resolverPlanType?: "ordered_ladder_v1" }
): AssessmentModelSnapshot {
  if (options?.disallowAliases) {
    const { valid, errors } = validateSnapshotRolesExact(roles);
    if (!valid) {
      throw new Error(`Cannot create assessment snapshot: dynamic aliases barred: ${errors.join("; ")}`);
    }
  }

  const snapshotId = `snap_${crypto.randomUUID()}`;
  const snapshot: AssessmentModelSnapshot = Object.freeze({
    snapshotId,
    matrixRevision,
    ...(options?.resolverPlanType === "ordered_ladder_v1"
      ? { resolverPlanType: options.resolverPlanType, ladderRevision: matrixRevision } : {}),
    analysisConfigVersion,
    policyMode,
    createdAt: new Date().toISOString(),
    roles: Object.freeze(roles),
  });

  activeAssessmentSnapshots.set(snapshotId, snapshot);
  return snapshot;
}

/**
 * Retrieves a frozen snapshot for an ongoing assessment session by snapshotId or assessmentId.
 */
export function getAssessmentModelSnapshot(snapshotOrAssessmentId: string): AssessmentModelSnapshot | undefined {
  const snapshotId = assessmentToSnapshotMap.get(snapshotOrAssessmentId) || snapshotOrAssessmentId;
  return activeAssessmentSnapshots.get(snapshotId);
}

/**
 * Gets the existing frozen snapshot for an assessmentId or creates and binds a new one.
 * Once created, this snapshot remains immutable across the assessment lifecycle.
 */
export function getOrCreateAssessmentSnapshot(
  assessmentId?: string,
  preferredRoleModels?: Partial<Record<AnalysisRole, string>>
): AssessmentModelSnapshot {
  if (assessmentId) {
    const existingSnapshotId = assessmentToSnapshotMap.get(assessmentId);
    if (existingSnapshotId) {
      const existing = activeAssessmentSnapshots.get(existingSnapshotId);
      if (existing) return existing;
    }
  }

  if (!globalSnapshotResolver) {
    // If not yet registered, try dynamically invoking modelResolverService
    try {
      const { resolveAssessmentModelSnapshot } = require("./modelResolverService");
      if (typeof resolveAssessmentModelSnapshot === "function") {
        globalSnapshotResolver = resolveAssessmentModelSnapshot;
      }
    } catch {
      // Fallback
    }
  }

  if (!globalSnapshotResolver) {
    throw new Error("Assessment model snapshot resolver is not registered");
  }

  const snapshot = globalSnapshotResolver(preferredRoleModels);
  if (assessmentId) {
    assessmentToSnapshotMap.set(assessmentId, snapshot.snapshotId);
  }
  return snapshot;
}

/**
 * Clears an assessment snapshot when execution completes.
 */
export function releaseAssessmentModelSnapshot(snapshotOrAssessmentId: string): void {
  const snapshotId = assessmentToSnapshotMap.get(snapshotOrAssessmentId) || snapshotOrAssessmentId;
  activeAssessmentSnapshots.delete(snapshotId);
  assessmentToSnapshotMap.delete(snapshotOrAssessmentId);

  for (const [aId, sId] of assessmentToSnapshotMap.entries()) {
    if (sId === snapshotId) {
      assessmentToSnapshotMap.delete(aId);
    }
  }
}

/**
 * Test Seam: Clear all active snapshots.
 */
export function resetAssessmentSnapshotsForTests(): void {
  activeAssessmentSnapshots.clear();
  assessmentToSnapshotMap.clear();
}
