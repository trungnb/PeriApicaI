import crypto from 'crypto';
import { getValidityReceiptSigningSecret } from '../config/env';
import type { ReceptorType, TechniqueType, ValidityGateIssue } from '../../types/dental';

export const VALIDITY_RECEIPT_TTL_MS = 5 * 60 * 1000;

export type ProceedValidityDecision = 'valid' | 'user_confirmed' | 'prototype_override';

export type ValidityReceiptPayload = {
  v: 1;
  purpose: 'proceed' | 'confirmation';
  imageDigest: string;
  toothFdi: string;
  technique: TechniqueType;
  receptorType: ReceptorType;
  assessmentId: string;
  decision: ProceedValidityDecision | 'uncertain';
  issue?: ValidityGateIssue;
  issuedAt: number;
  expiresAt: number;
};

export type ValidityReceiptBinding = Pick<ValidityReceiptPayload,
  'imageDigest' | 'toothFdi' | 'technique' | 'receptorType' | 'assessmentId'>;

export type ReceiptVerification =
  | { ok: true; payload: ValidityReceiptPayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'tampered' | 'expired' | 'mismatch' | 'purpose' };

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', getValidityReceiptSigningSecret())
    .update(`validity-receipt:v1:${encodedPayload}`)
    .digest('base64url');
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function createToken(payload: ValidityReceiptPayload): string {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function parseToken(token: unknown): ReceiptVerification {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'missing' };
  const pieces = token.split('.');
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return { ok: false, reason: 'malformed' };
  if (!safeEqual(pieces[1], sign(pieces[0]))) return { ok: false, reason: 'tampered' };
  try {
    const parsed = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8')) as ValidityReceiptPayload;
    if (parsed?.v !== 1 || (parsed.purpose !== 'proceed' && parsed.purpose !== 'confirmation')
      || typeof parsed.imageDigest !== 'string' || typeof parsed.toothFdi !== 'string'
      || typeof parsed.technique !== 'string' || typeof parsed.receptorType !== 'string'
      || typeof parsed.assessmentId !== 'string' || typeof parsed.issuedAt !== 'number'
      || typeof parsed.expiresAt !== 'number') {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Digest the exact bytes submitted to the provider, independent of data-URL spelling. */
export function digestValidityImage(image: unknown): string | null {
  if (typeof image !== 'string' || !image.trim()) return null;
  let clean = image.trim();
  if (clean.startsWith('data:')) {
    const separator = clean.indexOf(';base64,');
    if (separator < 0) return null;
    clean = clean.slice(separator + ';base64,'.length);
  }
  clean = clean.replace(/[\r\n\s]/g, '');
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

export function createValidityReceipt(
  binding: ValidityReceiptBinding,
  decision: ProceedValidityDecision,
  options: { issue?: ValidityGateIssue; now?: number; ttlMs?: number } = {},
): string {
  const issuedAt = options.now ?? Date.now();
  return createToken({
    v: 1,
    purpose: 'proceed',
    ...binding,
    decision,
    ...(options.issue === undefined ? {} : { issue: options.issue }),
    issuedAt,
    expiresAt: issuedAt + (options.ttlMs ?? VALIDITY_RECEIPT_TTL_MS),
  });
}

export function createValidityConfirmationToken(
  binding: ValidityReceiptBinding,
  options: { now?: number; ttlMs?: number } = {},
): string {
  const issuedAt = options.now ?? Date.now();
  return createToken({
    v: 1,
    purpose: 'confirmation',
    ...binding,
    decision: 'uncertain',
    issue: 'uncertain',
    issuedAt,
    expiresAt: issuedAt + (options.ttlMs ?? VALIDITY_RECEIPT_TTL_MS),
  });
}

function matches(payload: ValidityReceiptPayload, binding: ValidityReceiptBinding): boolean {
  return payload.imageDigest === binding.imageDigest
    && payload.toothFdi === binding.toothFdi
    && payload.technique === binding.technique
    && payload.receptorType === binding.receptorType
    && payload.assessmentId === binding.assessmentId;
}

export function verifyValidityReceipt(
  token: unknown,
  binding: ValidityReceiptBinding,
  now = Date.now(),
): ReceiptVerification {
  const parsed = parseToken(token);
  if (!parsed.ok) return parsed;
  if (parsed.payload.purpose !== 'proceed') return { ok: false, reason: 'purpose' };
  if (now > parsed.payload.expiresAt || parsed.payload.issuedAt > now + 60_000) return { ok: false, reason: 'expired' };
  if (!matches(parsed.payload, binding)) return { ok: false, reason: 'mismatch' };
  return parsed;
}

export function verifyValidityConfirmationToken(
  token: unknown,
  binding: ValidityReceiptBinding,
  now = Date.now(),
): ReceiptVerification {
  const parsed = parseToken(token);
  if (!parsed.ok) return parsed;
  if (parsed.payload.purpose !== 'confirmation') return { ok: false, reason: 'purpose' };
  if (now > parsed.payload.expiresAt || parsed.payload.issuedAt > now + 60_000) return { ok: false, reason: 'expired' };
  if (!matches(parsed.payload, binding)) return { ok: false, reason: 'mismatch' };
  return parsed;
}
