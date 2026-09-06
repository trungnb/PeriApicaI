import crypto from 'crypto';
import { getValidityReceiptSigningSecret } from '../config/env';
import type { ValidityAuditMetadata } from '../../types/dental';
import type { ValidityReceiptPayload } from './validityReceipt';

function unsigned(value: ValidityAuditMetadata): Omit<ValidityAuditMetadata, 'attestation'> {
  const { attestation: _attestation, ...metadata } = value;
  return metadata;
}

function signature(value: Omit<ValidityAuditMetadata, 'attestation'>): string {
  return crypto.createHmac('sha256', getValidityReceiptSigningSecret())
    .update(`validity-audit:v1:${JSON.stringify(value)}`)
    .digest('base64url');
}

export function createValidityAudit(receipt: ValidityReceiptPayload): ValidityAuditMetadata {
  const metadata: Omit<ValidityAuditMetadata, 'attestation'> = {
    schemaVersion: 1,
    sourceImageDigest: receipt.imageDigest,
    validityDecision: receipt.decision as ValidityAuditMetadata['validityDecision'],
    targetFdi: receipt.toothFdi,
    technique: receipt.technique,
    receptorType: receipt.receptorType,
    validatedAt: new Date(receipt.issuedAt).toISOString(),
    enforcementVersion: 'r29-v1',
  };
  return { ...metadata, attestation: signature(metadata) };
}

/** Accept only a server-attested audit envelope, then omit its transport proof before persistence. */
export function verifyAttestedValidityAudit(value: unknown): ValidityAuditMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const valid = candidate.schemaVersion === 1
    && typeof candidate.sourceImageDigest === 'string' && /^[a-f0-9]{64}$/.test(candidate.sourceImageDigest)
    && ['valid', 'user_confirmed', 'prototype_override'].includes(String(candidate.validityDecision))
    && typeof candidate.targetFdi === 'string' && /^\d{2}$/.test(candidate.targetFdi)
    && typeof candidate.technique === 'string' && typeof candidate.receptorType === 'string'
    && typeof candidate.validatedAt === 'string' && !Number.isNaN(Date.parse(candidate.validatedAt))
    && candidate.enforcementVersion === 'r29-v1'
    && typeof candidate.attestation === 'string';
  if (!valid) throw new Error('VALIDITY_AUDIT_ATTESTATION_INVALID');
  const parsed = candidate as unknown as ValidityAuditMetadata;
  const expected = signature(unsigned(parsed));
  const actualBuffer = Buffer.from(parsed.attestation!);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('VALIDITY_AUDIT_ATTESTATION_INVALID');
  }
  return unsigned(parsed);
}
