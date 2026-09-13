import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { sanitizeCredentialString, redactObjectSecrets } from '../../utils/apiKeySecurity';
import { ensureUploadsDirectory, resolveUploadFilePath } from './storagePaths';

if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) process.loadEnvFile();

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) || 3000 : 3000;

// In-memory runtime HMAC secret generated once when process starts
const RUNTIME_IMAGE_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

/**
 * Retrieves secret key for HMAC URL signing.
 * Uses an in-memory random secret generated once when the Node process starts.
 */
export function getImageSigningSecret(): string {
  return RUNTIME_IMAGE_SIGNING_SECRET;
}

function requiresStableSigningSecrets(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_ENV === 'staging';
}

export function assertSigningSecretConfiguration(): void {
  const lineage = process.env.INFERENCE_LINEAGE_SIGNING_SECRET?.trim();
  const validity = process.env.VALIDITY_RECEIPT_SIGNING_SECRET?.trim();
  if (!requiresStableSigningSecrets()) return;
  if (!lineage || !validity) throw new Error('STAGING_SIGNING_SECRETS_REQUIRED: configure INFERENCE_LINEAGE_SIGNING_SECRET and VALIDITY_RECEIPT_SIGNING_SECRET.');
  if (lineage === validity || lineage === process.env.ADMIN_PASSWORD?.trim() || validity === process.env.ADMIN_PASSWORD?.trim()) {
    throw new Error('STAGING_SIGNING_SECRETS_MUST_BE_INDEPENDENT');
  }
}

/** Dedicated stable secret; development alone may use a process-local fallback. */
export function getInferenceLineageSigningSecret(): string {
  const configured = process.env.INFERENCE_LINEAGE_SIGNING_SECRET?.trim();
  assertSigningSecretConfiguration();
  if (!configured) return RUNTIME_IMAGE_SIGNING_SECRET;
  return crypto.createHash('sha256').update(`periapicai:inference-lineage:${configured}`).digest('hex');
}

/** Independent secret for short-lived validity receipts and safe audit envelopes. */
export function getValidityReceiptSigningSecret(): string {
  const configured = process.env.VALIDITY_RECEIPT_SIGNING_SECRET?.trim();
  assertSigningSecretConfiguration();
  if (!configured) return RUNTIME_IMAGE_SIGNING_SECRET;
  return crypto.createHash('sha256').update(`periapicai:validity-receipt:${configured}`).digest('hex');
}

/**
 * Generates a signed, time-limited URL for temporary medical image access.
 */
export function generateSignedImageUrl(filename: string, expiresInSeconds: number = 3600): string {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = getImageSigningSecret();
  const signature = crypto.createHmac('sha256', secret).update(`${filename}:${expires}`).digest('hex');
  return `/api/images/${filename}?expires=${expires}&sig=${signature}`;
}

/**
 * Verifies the HMAC signature and expiry for a requested image filename.
 */
export function verifySignedImageUrl(filename: string, expiresStr: string, sig: string): boolean {
  if (!filename || !expiresStr || !sig) return false;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || Math.floor(Date.now() / 1000) > expires) {
    return false; // Expired
  }
  const secret = getImageSigningSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(`${filename}:${expires}`).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

// Structured server logger utility
export type ServerLogLevel = 'INFO' | 'WARN' | 'ERROR';

export function serverLog(level: ServerLogLevel, tag: string, message: string, detail?: any) {
  const timestamp = new Date().toISOString();
  let formattedDetail = '';
  if (detail !== undefined && detail !== null) {
    if (detail instanceof Error) {
      formattedDetail = ` | ${detail.name}: ${sanitizeCredentialString(detail.message)}`;
    } else if (typeof detail === 'object') {
      try {
        const safeDetail = redactObjectSecrets(detail);
        const json = JSON.stringify(safeDetail);
        formattedDetail = ` | ${json.length > 250 ? json.slice(0, 250) + '...' : json}`;
      } catch {
        formattedDetail = ` | [Object]`;
      }
    } else {
      const str = sanitizeCredentialString(String(detail));
      formattedDetail = ` | ${str.length > 250 ? str.slice(0, 250) + '...' : str}`;
    }
  }
  const cleanMessage = sanitizeCredentialString(message);
  const output = `[${timestamp}] [${level}] [${tag}] ${cleanMessage}${formattedDetail}`;
  if (level === 'ERROR') {
    console.error(output);
  } else if (level === 'WARN') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

// Helper: Save image with accurate MIME extension, verify magic bytes, and return signed URL
export async function saveAndOptimizeImageFile(assessmentId: string, base64DataUrl: string): Promise<{ localUrl: string, imageStorageKey?: string }> {
  try {
    if (!base64DataUrl) return { localUrl: '' };
    if (base64DataUrl.startsWith('/api/images/') || base64DataUrl.startsWith('http')) {
      return { localUrl: base64DataUrl, imageStorageKey: base64DataUrl };
    }
    if (!base64DataUrl.includes('base64,')) {
      return { localUrl: '' };
    }

    const cleanBase64 = base64DataUrl.split('base64,')[1];
    const rawBuffer = Buffer.from(cleanBase64, 'base64');

    if (rawBuffer.length < 4) {
      throw new Error('Image buffer too small or corrupted.');
    }

    // Inspect magic numbers for JPEG, PNG, and WebP
    const hex = rawBuffer.subarray(0, 12).toString('hex').toLowerCase();
    let ext = '.jpg';

    if (hex.startsWith('ffd8')) {
      ext = '.jpg';
    } else if (hex.startsWith('89504e47')) {
      ext = '.png';
    } else if (hex.startsWith('52494646') && hex.includes('57454250')) { // RIFF ... WEBP
      ext = '.webp';
    } else {
      throw new Error('Unsupported image format. Only JPEG, PNG, and WebP are supported.');
    }

    const safeAssessmentId = assessmentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = `${safeAssessmentId}${ext}`;
    ensureUploadsDirectory();
    const filePath = resolveUploadFilePath(safeFilename);

    await fs.promises.writeFile(filePath, rawBuffer);

    // Return signed URL with 1-hour validity
    const signedUrl = generateSignedImageUrl(safeFilename, 3600);

    return {
      localUrl: signedUrl,
      imageStorageKey: safeFilename,
    };
  } catch (err: any) {
    serverLog('WARN', 'ImageSave', 'Unable to save optimized image file', err instanceof Error ? err : new Error(String(err)));
    return { localUrl: '' };
  }
}


export async function deleteImageFile(storageKey: string): Promise<boolean> {
  if (!storageKey || storageKey.startsWith('http')) return false;
  
  // Extract filename safely, handling query parameters & legacy paths
  const cleanKey = storageKey.split('?')[0];
  const filename = path.basename(cleanKey);
  if (!filename) return false;
  
  // Prevent path traversal
  const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safeFilename || safeFilename.includes('..')) return false;
  
  const filePath = resolveUploadFilePath(safeFilename);
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      serverLog('WARN', 'ImageDelete', `Failed to delete file ${safeFilename}`, err);
    }
    return false; // Idempotent handling for ENOENT
  }
}
