import type {
  EvaluationInferenceLineage,
  InferenceBranchLineage,
  InferenceLineage,
  InferenceModality,
} from '../types/dental';

const KEY_SOURCES = new Set(['custom_byok', 'system_primary', 'system_backup']);
const BRANCHES = new Set(['single', 'model_a', 'model_b']);

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Preserves a complete server lineage envelope and rejects partial/malformed metadata. */
export function normalizeInferenceLineage(
  value: unknown,
  expectedModality?: InferenceModality,
): InferenceLineage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, any>;
  if (
    candidate.schemaVersion !== 1
    || candidate.status !== 'available'
    || !nonblank(candidate.lineageId)
    || !['technical', 'pathology'].includes(candidate.modality)
    || (expectedModality !== undefined && candidate.modality !== expectedModality)
    || candidate.workflow !== (candidate.modality === 'technical' ? 'technical_quality_assessment' : 'pathology_segmentation')
    || candidate.provider !== 'google_gemini'
    || !['single', 'dual'].includes(candidate.executionMode)
    || !Array.isArray(candidate.branches)
    || candidate.branches.length < 1
    || candidate.branches.length > 2
    || !candidate.consensus
    || typeof candidate.consensus !== 'object'
    || !['none', 'dual_consensus'].includes(candidate.consensus.mode)
    || !['not_applicable', 'consensus_synthesized', 'partial_fallback'].includes(candidate.consensus.status)
    || !nonblank(candidate.promptVersion)
    || !nonblank(candidate.responseSchemaVersion)
    || !nonblank(candidate.analysisConfigVersion)
    || !nonblank(candidate.generatedAt)
    || Number.isNaN(Date.parse(candidate.generatedAt))
  ) return undefined;

  const branches: InferenceBranchLineage[] = [];
  const seen = new Set<string>();
  for (const rawBranch of candidate.branches) {
    if (!rawBranch || typeof rawBranch !== 'object' || Array.isArray(rawBranch)) return undefined;
    if (
      !BRANCHES.has(rawBranch.branch)
      || seen.has(rawBranch.branch)
      || !nonblank(rawBranch.requestedModel)
      || !nonblank(rawBranch.actualModel)
      || !KEY_SOURCES.has(rawBranch.keySource)
    ) return undefined;
    seen.add(rawBranch.branch);
    branches.push({
      branch: rawBranch.branch,
      requestedModel: rawBranch.requestedModel,
      actualModel: rawBranch.actualModel,
      keySource: rawBranch.keySource,
    });
  }

  if (candidate.executionMode === 'single' && (branches.length !== 1 || branches[0].branch !== 'single')) return undefined;
  if (candidate.executionMode === 'dual' && !branches.every((branch) => branch.branch === 'model_a' || branch.branch === 'model_b')) return undefined;
  if (candidate.consensus.status === 'consensus_synthesized' && branches.length !== 2) return undefined;

  return {
    schemaVersion: 1,
    status: 'available',
    lineageId: candidate.lineageId,
    modality: candidate.modality,
    workflow: candidate.workflow,
    provider: 'google_gemini',
    executionMode: candidate.executionMode,
    branches,
    consensus: {
      mode: candidate.consensus.mode,
      status: candidate.consensus.status,
    },
    promptVersion: candidate.promptVersion,
    responseSchemaVersion: candidate.responseSchemaVersion,
    analysisConfigVersion: candidate.analysisConfigVersion,
    generatedAt: candidate.generatedAt,
    ...(nonblank(candidate.attestation) ? { attestation: candidate.attestation } : {}),
  };
}

export function inferenceLineageForEvaluation(value: unknown): EvaluationInferenceLineage {
  const available = normalizeInferenceLineage(value);
  if (!available) return { schemaVersion: 1, status: 'unavailable', reason: 'legacy_record' };
  const { attestation: _attestation, ...persisted } = available;
  return persisted;
}

