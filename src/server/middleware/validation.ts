import { Request, Response, NextFunction } from 'express';

// Check if a string is a valid Base64 encoded image
function isValidBase64Image(str: string): boolean {
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

// Check if a string is a valid FDI Tooth Number (11-18, 21-28, 31-38, 41-48, or primary teeth 51-55, 61-65, 71-75, 81-85)
function isValidFdiNumber(fdi: any): boolean {
  if (fdi === undefined || fdi === null) return false;
  const fdiStr = String(fdi).trim();
  const fdiInt = parseInt(fdiStr, 10);
  if (isNaN(fdiInt)) return false;
  
  // Permanent dentition quadrant (1-4) or primary dentition quadrant (5-8)
  const isPermanent = fdiInt >= 11 && fdiInt <= 48 && (fdiInt % 10 >= 1 && fdiInt % 10 <= 8);
  const isPrimary = fdiInt >= 51 && fdiInt <= 85 && (fdiInt % 10 >= 1 && fdiInt % 10 <= 5);
  
  return isPermanent || isPrimary;
}

export function validateRadiographAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    let tooth = req.body.tooth;
    if (typeof tooth === 'string') {
      try {
        tooth = JSON.parse(tooth);
      } catch {
        return res.status(400).json({ error: 'Thông số tooth không đúng định dạng JSON.' });
      }
    }

    const { technique, receptorType, imageBase64 } = req.body;

    if (!tooth || !technique || !receptorType) {
      return res.status(400).json({ error: 'Thiếu các thông số bắt buộc: tooth, technique, receptorType.' });
    }

    if (!isValidFdiNumber(tooth.fdiNumber)) {
      return res.status(400).json({ error: 'Mã răng FDI không hợp lệ.' });
    }

    if (!imageBase64 || !isValidBase64Image(imageBase64)) {
      return res.status(400).json({ error: 'Dữ liệu ảnh X-quang (imageBase64) không hợp lệ hoặc bị rỗng.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Lỗi kiểm tra dữ liệu đầu vào.' });
  }
}

export function validatePathologySegment(req: Request, res: Response, next: NextFunction) {
  try {
    const { imageBase64, toothFdi } = req.body;

    if (!imageBase64 || !toothFdi) {
      return res.status(400).json({ error: 'Thiếu thông số imageBase64 hoặc toothFdi.' });
    }

    if (!isValidFdiNumber(toothFdi)) {
      return res.status(400).json({ error: 'Mã răng FDI không hợp lệ.' });
    }

    if (!isValidBase64Image(imageBase64)) {
      return res.status(400).json({ error: 'Dữ liệu ảnh X-quang (imageBase64) không hợp lệ hoặc bị rỗng.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Lỗi kiểm tra dữ liệu đầu vào.' });
  }
}
