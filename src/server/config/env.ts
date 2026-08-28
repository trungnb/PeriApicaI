import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export const PORT = 3000;

// Directory for storing temporary compressed medical images
export const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
        const secretKeys = ['GEMINI_API_KEY', 'apiKey', 'token', 'password', 'secret', 'key'];
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

// Helper: Save image as compressed JPEG file and return short URL path
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

    // Very basic magic number verification for common image types (JPEG, PNG, WEBP)
    if (rawBuffer.length > 4) {
      const hex = rawBuffer.subarray(0, 4).toString('hex').toLowerCase();
      const isJpeg = hex.startsWith('ffd8');
      const isPng = hex.startsWith('89504e47');
      const isWebp = hex.startsWith('52494646');
      if (!isJpeg && !isPng && !isWebp) {
        throw new Error('Invalid image format detected.');
      }
    }

    const safeFilename = `${assessmentId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    const filePath = path.join(uploadsDir, safeFilename);

    await fs.promises.writeFile(filePath, rawBuffer);

    return {
      localUrl: `/api/images/${safeFilename}`
    };
  } catch (err: any) {
    serverLog('WARN', 'ImageSave', 'Unable to save optimized image file', err instanceof Error ? err : new Error(String(err)));
    return { localUrl: '' };
  }
}
