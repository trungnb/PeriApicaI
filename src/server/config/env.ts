import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export const PORT = 3000;

// Directory for storing temporary compressed medical images (outside public/dist for security)
export const uploadsDir = path.join(process.cwd(), 'runtime', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Safely deletes an image file by filename if it exists in uploadsDir.
 */
export function deleteImageFile(filename: string): boolean {
  try {
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadsDir, safeFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    serverLog('WARN', 'ImageDelete', `Failed to delete image file: ${filename}`, err);
  }
  return false;
}

// In-memory runtime HMAC secret generated once when process starts
const RUNTIME_IMAGE_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

/**
 * Retrieves secret key for HMAC URL signing.
 * Uses an in-memory random secret generated once when the Node process starts.
 */
export function getImageSigningSecret(): string {
  return RUNTIME_IMAGE_SIGNING_SECRET;
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
      formattedDetail = ` | ${detail.name}: ${detail.message}`;
    } else if (typeof detail === 'object') {
      try {
        const safeDetail = { ...detail };
        // Mask potential secrets
        const secretKeys = ['GEMINI_API_KEY', 'apiKey', 'token', 'password', 'secret', 'key', 'sig', 'signature'];
        for (const [k, v] of Object.entries(safeDetail)) {
          if (secretKeys.some(sk => k.toLowerCase().includes(sk.toLowerCase())) && typeof v === 'string') {
            safeDetail[k] = '*** MASKED ***';
          }
        }
        const json = JSON.stringify(safeDetail);
        formattedDetail = ` | ${json.length > 250 ? json.slice(0, 250) + '...' : json}`;
      } catch {
        formattedDetail = ` | [Object]`;
      }
    } else {
      const str = String(detail);
      formattedDetail = ` | ${str.length > 250 ? str.slice(0, 250) + '...' : str}`;
    }
  }
  const output = `[${timestamp}] [${level}] [${tag}] ${message}${formattedDetail}`;
  if (level === 'ERROR') {
    console.error(output);
  } else if (level === 'WARN') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

// Helper: Save image with accurate MIME extension, verify magic bytes, and return signed URL
export async function saveAndOptimizeImageFile(assessmentId: string, base64DataUrl: string): Promise<{ localUrl: string }> {
  try {
    if (!base64DataUrl) return { localUrl: '' };
    if (base64DataUrl.startsWith('/api/images/') || base64DataUrl.startsWith('http')) {
      return { localUrl: base64DataUrl };
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
    const filePath = path.join(uploadsDir, safeFilename);

    await fs.promises.writeFile(filePath, rawBuffer);

    // Return signed URL with 1-hour validity
    const signedUrl = generateSignedImageUrl(safeFilename, 3600);

    return {
      localUrl: signedUrl,
    };
  } catch (err: any) {
    serverLog('WARN', 'ImageSave', 'Unable to save optimized image file', err instanceof Error ? err : new Error(String(err)));
    return { localUrl: '' };
  }
}
