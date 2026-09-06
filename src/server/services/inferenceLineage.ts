import crypto from 'crypto';
import { getInferenceLineageSigningSecret } from '../config/env';
import { normalizeInferenceLineage } from '../../utils/inferenceLineage';
import type {
  InferenceBranchLineage,
  InferenceKeySource,
  InferenceLineage,
  InferenceModality,
} from '../../types/dental';

export const TECHNICAL_PROMPT_VERSION = 'technical-quality-prompt-v1';
export const TECHNICAL_RESPONSE_SCHEMA_VERSION = 'technical-analysis-schema-v1';
export const PATHOLOGY_PROMPT_VERSION = 'pathology-segmentation-prompt-v2';
export const PATHOLOGY_RESPONSE_SCHEMA_VERSION = 'pathology-segmentation-schema-v1';
export const ANALYSIS_CONFIG_VERSION = 'r28a-v1';

export interface ExecutedInferenceBranch {
  branch: InferenceBranchLineage['branch'];
  requestedModel: string;
  actualModel: string;
  usedKeyType: string;
}

function safeKeySource(usedKeyType: string): InferenceKeySource {
  if (usedKeyType === 'custom_byok') return 'custom_byok';
  if (usedKeyType.includes('(Backup)')) return 'system_backup';
  return 'system_primary';
}

function unsigned(lineage: InferenceLineage): Omit<InferenceLineage, 'attestation'> {
  const { attestation: _attestation, ...value } = lineage;
  return value;
}

function signature(value: Omit<InferenceLineage, 'attestation'>): string {
  return crypto
    .createHmac('sha256', getInferenceLineageSigningSecret())
    .update(JSON.stringify(value))
    .digest('base64url');
}

export function createInferenceLineage(input: {
  modality: InferenceModality;
  executionMode: 'single' | 'dual';
  branches: ExecutedInferenceBranch[];
  consensusStatus: 'not_applicable' | 'consensus_synthesized' | 'partial_fallback';
  generatedAt?: string;
}): InferenceLineage {
  const isTechnical = input.modality === 'technical';
  const base: InferenceLineage = {
    schemaVersion: 1,
    status: 'available',
    lineageId: `inference_${crypto.randomUUID()}`,
    modality: input.modality,
    workflow: isTechnical ? 'technical_quality_assessment' : 'pathology_segmentation',
    provider: 'google_gemini',
    executionMode: input.executionMode,
    branches: input.branches.map((branch) => ({
      branch: branch.branch,
      requestedModel: branch.requestedModel,
      actualModel: branch.actualModel,
      keySource: safeKeySource(branch.usedKeyType),
    })),
    consensus: {
      mode: input.executionMode === 'dual' ? 'dual_consensus' : 'none',
      status: input.consensusStatus,
    },
    promptVersion: isTechnical ? TECHNICAL_PROMPT_VERSION : PATHOLOGY_PROMPT_VERSION,
    responseSchemaVersion: isTechnical ? TECHNICAL_RESPONSE_SCHEMA_VERSION : PATHOLOGY_RESPONSE_SCHEMA_VERSION,
    analysisConfigVersion: ANALYSIS_CONFIG_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  return { ...base, attestation: signature(base) };
}

/**
 * Public clients transport the envelope but cannot author it. Invalid or
 * modified server metadata is rejected before it reaches persistence.
 */
export function verifyAttestedInferenceLineage(
  value: unknown,
  expectedModality: InferenceModality,
): InferenceLineage | undefined {
  if (value === undefined) return undefined;
  const parsed = normalizeInferenceLineage(value, expectedModality);
  if (!parsed?.attestation) throw new Error('INFERENCE_LINEAGE_ATTESTATION_INVALID');
  const expected = signature(unsigned(parsed));
  const actualBuffer = Buffer.from(parsed.attestation);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('INFERENCE_LINEAGE_ATTESTATION_INVALID');
  }
  return unsigned(parsed);
}

export function preserveImmutableInferenceLineage(previous: unknown, next: unknown): InferenceLineage | undefined {
  return normalizeInferenceLineage(previous) ?? normalizeInferenceLineage(next);
}
