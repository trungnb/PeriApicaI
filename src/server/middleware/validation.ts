import { Request, Response, NextFunction } from 'express';
import { TechniqueType, ReceptorType, ToothInfo } from '../../types/dental';
import { ALL_TEETH, getToothDisplayName } from '../../data/taxonomyData';

const MAX_DECODED_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB decoded limit

export function detectImageMagicMime(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ValidatedImageInfo {
  cleanBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** Extract base64 image data, inspect true magic bytes, and enforce MIME matching. */
export function extractAndValidateImage(input: string, explicitMime?: string): ValidatedImageInfo | null {
  if (!input || typeof input !== 'string') return null;
  
  let cleanStr = input.trim();
  let prefixMime: string | null = null;
  if (cleanStr.startsWith('data:')) {
    const match = cleanStr.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i);
    if (match) {
      prefixMime = match[1].toLowerCase();
      cleanStr = cleanStr.slice(match[0].length);
    } else {
      const parts = cleanStr.split(';base64,');
      if (parts.length >= 2) {
        cleanStr = parts.slice(1).join(';base64,');
      } else {
        cleanStr = cleanStr.replace(/^data:image\/[^;]+;base64,/i, '');
      }
    }
  }
  
  cleanStr = cleanStr.replace(/[\r\n\s]/g, '');
  if (cleanStr.length < 50) return null;

  // Base64 regex supporting standard and URL-safe base64 characters
  const base64Regex = /^[A-Za-z0-9+/=\-_]+$/;
  if (!base64Regex.test(cleanStr)) return null;

  // Approximate decoded size check before Buffer allocation
  const estimatedBytes = (cleanStr.length * 3) / 4;
  if (estimatedBytes > MAX_DECODED_IMAGE_BYTES) return null;

  try {
    const buffer = Buffer.from(cleanStr, 'base64');
    if (buffer.length > MAX_DECODED_IMAGE_BYTES) return null;
    const detectedMime = detectImageMagicMime(buffer);
    if (!detectedMime) return null;

    const declared = (prefixMime || explicitMime || '').trim().toLowerCase();
    if (declared) {
      const normDeclared = declared === 'image/jpg' ? 'image/jpeg' : declared;
      if (normDeclared !== detectedMime) return null;
    }
    return { cleanBase64: cleanStr, mimeType: detectedMime };
  } catch {
    return null;
  }
}

// Check if a string is a valid Base64 encoded image (JPEG, PNG, or WebP) with genuine magic bytes
export function isValidBase64Image(str: string, explicitMime?: string): boolean {
  return extractAndValidateImage(str, explicitMime) !== null;
}

// ─── Canonical Production Enumerations (Units R3-B & R3-C) ────
export const CANONICAL_TECHNIQUES = ['Paralleling', 'Bisecting Angle'] as const;
export const CANONICAL_RECEPTORS = ['Digital Sensor', 'Analogue/Phosphor Plate'] as const;

export interface CanonicalToothInfo extends ToothInfo {
  nameVi: string;
  nameEn: string;
}

// ─── Canonical Primary Teeth Definitions (FDI 51-55, 61-65, 71-75, 81-85) ───
const PRIMARY_TEETH: CanonicalToothInfo[] = [
  // Maxilla Right (Q5)
  { fdiNumber: '55', universalNumber: '#A', name: 'Răng sữa cối thứ 2 hàm trên bên phải', nameVi: 'Răng sữa cối thứ 2 hàm trên bên phải', nameEn: 'Primary Maxillary Right 2nd Molar', arch: 'Maxilla', quadrant: 5, type: 'Molar' },
  { fdiNumber: '54', universalNumber: '#B', name: 'Răng sữa cối thứ 1 hàm trên bên phải', nameVi: 'Răng sữa cối thứ 1 hàm trên bên phải', nameEn: 'Primary Maxillary Right 1st Molar', arch: 'Maxilla', quadrant: 5, type: 'Molar' },
  { fdiNumber: '53', universalNumber: '#C', name: 'Răng sữa nanh hàm trên bên phải', nameVi: 'Răng sữa nanh hàm trên bên phải', nameEn: 'Primary Maxillary Right Canine', arch: 'Maxilla', quadrant: 5, type: 'Canine' },
  { fdiNumber: '52', universalNumber: '#D', name: 'Răng sữa cửa bên hàm trên bên phải', nameVi: 'Răng sữa cửa bên hàm trên bên phải', nameEn: 'Primary Maxillary Right Lateral Incisor', arch: 'Maxilla', quadrant: 5, type: 'Incisor' },
  { fdiNumber: '51', universalNumber: '#E', name: 'Răng sữa cửa giữa hàm trên bên phải', nameVi: 'Răng sữa cửa giữa hàm trên bên phải', nameEn: 'Primary Maxillary Right Central Incisor', arch: 'Maxilla', quadrant: 5, type: 'Incisor' },

  // Maxilla Left (Q6)
  { fdiNumber: '61', universalNumber: '#F', name: 'Răng sữa cửa giữa hàm trên bên trái', nameVi: 'Răng sữa cửa giữa hàm trên bên trái', nameEn: 'Primary Maxillary Left Central Incisor', arch: 'Maxilla', quadrant: 6, type: 'Incisor' },
  { fdiNumber: '62', universalNumber: '#G', name: 'Răng sữa cửa bên hàm trên bên trái', nameVi: 'Răng sữa cửa bên hàm trên bên trái', nameEn: 'Primary Maxillary Left Lateral Incisor', arch: 'Maxilla', quadrant: 6, type: 'Incisor' },
  { fdiNumber: '63', universalNumber: '#H', name: 'Răng sữa nanh hàm trên bên trái', nameVi: 'Răng sữa nanh hàm trên bên trái', nameEn: 'Primary Maxillary Left Canine', arch: 'Maxilla', quadrant: 6, type: 'Canine' },
  { fdiNumber: '64', universalNumber: '#I', name: 'Răng sữa cối thứ 1 hàm trên bên trái', nameVi: 'Răng sữa cối thứ 1 hàm trên bên trái', nameEn: 'Primary Maxillary Left 1st Molar', arch: 'Maxilla', quadrant: 6, type: 'Molar' },
  { fdiNumber: '65', universalNumber: '#J', name: 'Răng sữa cối thứ 2 hàm trên bên trái', nameVi: 'Răng sữa cối thứ 2 hàm trên bên trái', nameEn: 'Primary Maxillary Left 2nd Molar', arch: 'Maxilla', quadrant: 6, type: 'Molar' },

  // Mandible Left (Q7)
  { fdiNumber: '71', universalNumber: '#O', name: 'Răng sữa cửa giữa hàm dưới bên trái', nameVi: 'Răng sữa cửa giữa hàm dưới bên trái', nameEn: 'Primary Mandibular Left Central Incisor', arch: 'Mandible', quadrant: 7, type: 'Incisor' },
  { fdiNumber: '72', universalNumber: '#N', name: 'Răng sữa cửa bên hàm dưới bên trái', nameVi: 'Răng sữa cửa bên hàm dưới bên trái', nameEn: 'Primary Mandibular Left Lateral Incisor', arch: 'Mandible', quadrant: 7, type: 'Incisor' },
  { fdiNumber: '73', universalNumber: '#M', name: 'Răng sữa nanh hàm dưới bên trái', nameVi: 'Răng sữa nanh hàm dưới bên trái', nameEn: 'Primary Mandibular Left Canine', arch: 'Mandible', quadrant: 7, type: 'Canine' },
  { fdiNumber: '74', universalNumber: '#L', name: 'Răng sữa cối thứ 1 hàm dưới bên trái', nameVi: 'Răng sữa cối thứ 1 hàm dưới bên trái', nameEn: 'Primary Mandibular Left 1st Molar', arch: 'Mandible', quadrant: 7, type: 'Molar' },
  { fdiNumber: '75', universalNumber: '#K', name: 'Răng sữa cối thứ 2 hàm dưới bên trái', nameVi: 'Răng sữa cối thứ 2 hàm dưới bên trái', nameEn: 'Primary Mandibular Left 2nd Molar', arch: 'Mandible', quadrant: 7, type: 'Molar' },

  // Mandible Right (Q8)
  { fdiNumber: '81', universalNumber: '#P', name: 'Răng sữa cửa giữa hàm dưới bên phải', nameVi: 'Răng sữa cửa giữa hàm dưới bên phải', nameEn: 'Primary Mandibular Right Central Incisor', arch: 'Mandible', quadrant: 8, type: 'Incisor' },
  { fdiNumber: '82', universalNumber: '#Q', name: 'Răng sữa cửa bên hàm dưới bên phải', nameVi: 'Răng sữa cửa bên hàm dưới bên phải', nameEn: 'Primary Mandibular Right Lateral Incisor', arch: 'Mandible', quadrant: 8, type: 'Incisor' },
  { fdiNumber: '83', universalNumber: '#R', name: 'Răng sữa nanh hàm dưới bên phải', nameVi: 'Răng sữa nanh hàm dưới bên phải', nameEn: 'Primary Mandibular Right Canine', arch: 'Mandible', quadrant: 8, type: 'Canine' },
  { fdiNumber: '84', universalNumber: '#S', name: 'Răng sữa cối thứ 1 hàm dưới bên phải', nameVi: 'Răng sữa cối thứ 1 hàm dưới bên phải', nameEn: 'Primary Mandibular Right 1st Molar', arch: 'Mandible', quadrant: 8, type: 'Molar' },
  { fdiNumber: '85', universalNumber: '#T', name: 'Răng sữa cối thứ 2 hàm dưới bên phải', nameVi: 'Răng sữa cối thứ 2 hàm dưới bên phải', nameEn: 'Primary Mandibular Right 2nd Molar', arch: 'Mandible', quadrant: 8, type: 'Molar' },
];

// ─── Single Source of Truth Canonical Tooth Registry ─────────
const CANONICAL_TEETH_MAP = new Map<string, CanonicalToothInfo>();

// 1. Ingest all 32 permanent teeth directly from authoritative ALL_TEETH
ALL_TEETH.forEach((t) => {
  const tooth: CanonicalToothInfo = {
    ...t,
    nameVi: t.name,
    nameEn: getToothDisplayName(t, 'EN'),
  };
  CANONICAL_TEETH_MAP.set(t.fdiNumber, Object.freeze(tooth));
});

// 2. Ingest 20 primary teeth
PRIMARY_TEETH.forEach((t) => {
  CANONICAL_TEETH_MAP.set(t.fdiNumber, Object.freeze(t));
});

// Authoritative set of all 52 supported canonical FDI strings
export const CANONICAL_FDI_SET = new Set<string>(CANONICAL_TEETH_MAP.keys());

/**
 * Unit R3-A: Strict canonical FDI membership validation.
 * Rejects loose ranges, out-of-bound numbers (e.g. 19, 30, 56), and prompt-injected strings.
 */
export function isValidFdi(fdi: unknown): boolean {
  if (fdi === undefined || fdi === null) return false;
  if (typeof fdi === 'number') {
    if (!Number.isInteger(fdi)) return false;
    return CANONICAL_FDI_SET.has(String(fdi));
  }
  if (typeof fdi === 'string') {
    const trimmed = fdi.trim();
    if (!/^[1-8][1-8]$/.test(trimmed)) return false;
    return CANONICAL_FDI_SET.has(trimmed);
  }
  return false;
}

// Backward-compatible alias
export const isValidFdiNumber = isValidFdi;

/**
 * Unit R3-B: Explicit canonical technique allow-list validation.
 * Rejects arbitrary strings, prompt-like injections, and unexpected objects.
 */
export function isValidTechnique(technique: unknown): technique is TechniqueType {
  if (typeof technique !== 'string') return false;
  return technique === 'Paralleling' || technique === 'Bisecting Angle';
}

/**
 * Unit R3-C: Explicit canonical receptor allow-list validation.
 * Rejects unsupported receptor values and prompt injections.
 */
export function isValidReceptor(receptor: unknown): receptor is ReceptorType {
  if (typeof receptor !== 'string') return false;
  return receptor === 'Digital Sensor' || receptor === 'Analogue/Phosphor Plate';
}

/**
 * Unit R3-D: Authoritative server-side tooth record reconstruction.
 * Uses validated FDI to produce trusted canonical metadata for AI instruction construction.
 */
export function getCanonicalToothByFdi(fdi: unknown): CanonicalToothInfo | null {
  if (!isValidFdi(fdi)) return null;
  const key = typeof fdi === 'number' ? String(fdi) : String(fdi).trim();
  return CANONICAL_TEETH_MAP.get(key) || null;
}

// ─── Route Middlewares ────────────────────────────────────────

export function validateRadiographAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    let rawTooth = req.body.tooth;
    if (typeof rawTooth === 'string') {
      try {
        rawTooth = JSON.parse(rawTooth);
      } catch {
        return res.status(400).json({ error: 'Thông số tooth không đúng định dạng JSON.' });
      }
    }

    const rawReceptor = req.body.receptorType !== undefined ? req.body.receptorType : req.body.receptor;
    const technique = req.body.technique;
    const imageBase64 = req.body.imageBase64;

    if (!rawTooth || technique === undefined || technique === null || rawReceptor === undefined || rawReceptor === null) {
      return res.status(400).json({ error: 'Thiếu các thông số bắt buộc: tooth, technique, receptorType.' });
    }

    const fdiNumber = rawTooth?.fdiNumber !== undefined
      ? rawTooth.fdiNumber
      : (typeof rawTooth === 'string' || typeof rawTooth === 'number' ? rawTooth : undefined);

    if (!isValidFdi(fdiNumber)) {
      return res.status(400).json({ error: 'Mã răng FDI không hợp lệ.' });
    }

    if (!isValidTechnique(technique)) {
      return res.status(400).json({ error: 'Kỹ thuật chụp không hợp lệ. Chỉ chấp nhận "Paralleling" hoặc "Bisecting Angle".' });
    }

    if (!isValidReceptor(rawReceptor)) {
      return res.status(400).json({ error: 'Loại bộ nhận ảnh không hợp lệ. Chỉ chấp nhận "Digital Sensor" hoặc "Analogue/Phosphor Plate".' });
    }

    if (!imageBase64 || !isValidBase64Image(imageBase64)) {
      return res.status(400).json({ error: 'Dữ liệu ảnh X-quang (imageBase64) không hợp lệ hoặc bị rỗng.' });
    }

    // Trusted canonical tooth reconstruction (Unit R3-D)
    const canonicalTooth = getCanonicalToothByFdi(fdiNumber);
    if (!canonicalTooth) {
      return res.status(400).json({ error: 'Mã răng FDI không hợp lệ.' });
    }

    // Overwrite client-supplied tooth metadata with immutable canonical server data
    req.body.tooth = canonicalTooth;
    req.body.technique = technique;
    req.body.receptorType = rawReceptor;
    res.locals.canonicalTooth = canonicalTooth;
    res.locals.canonicalTechnique = technique;
    res.locals.canonicalReceptor = rawReceptor;

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Lỗi kiểm tra dữ liệu đầu vào.' });
  }
}

export function validatePathologySegment(req: Request, res: Response, next: NextFunction) {
  try {
    const { imageBase64, toothFdi } = req.body;

    if (!imageBase64 || toothFdi === undefined || toothFdi === null) {
      return res.status(400).json({ error: 'Thiếu thông số imageBase64 hoặc toothFdi.' });
    }

    if (!isValidFdi(toothFdi)) {
      return res.status(400).json({ error: 'Mã răng FDI không hợp lệ.' });
    }

    if (!isValidBase64Image(imageBase64)) {
      return res.status(400).json({ error: 'Dữ liệu ảnh X-quang (imageBase64) không hợp lệ hoặc bị rỗng.' });
    }

    req.body.toothFdi = typeof toothFdi === 'number' ? String(toothFdi) : String(toothFdi).trim();

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Lỗi kiểm tra dữ liệu đầu vào.' });
  }
}

