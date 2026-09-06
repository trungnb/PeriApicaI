import { Request, Response, NextFunction } from 'express';
import { TechniqueType, ReceptorType, ToothInfo } from '../../types/dental';
import { ALL_TEETH, getToothDisplayName } from '../../data/taxonomyData';

// Check if a string is a valid Base64 encoded image
export function isValidBase64Image(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  
  // Strip potential data URL prefix safely
  let cleanStr = str.trim();
  if (cleanStr.startsWith('data:')) {
    const parts = cleanStr.split(';base64,');
    if (parts.length >= 2) {
      cleanStr = parts.slice(1).join(';base64,');
    } else {
      cleanStr = cleanStr.replace(/^data:image\/[^;]+;base64,/, '');
    }
  }
  
  cleanStr = cleanStr.replace(/[\r\n\s]/g, '');
  if (cleanStr.length < 50) return false;

  // Base64 regex supporting standard and URL-safe base64 characters
  const base64Regex = /^[A-Za-z0-9+/=\-_]+$/;
  return base64Regex.test(cleanStr);
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

