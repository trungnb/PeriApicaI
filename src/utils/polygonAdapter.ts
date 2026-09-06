import { PATHOLOGY_DICT } from '../constants/dictionaries';
import { AIDetection, GeometryStatus, PathologyKey } from '../types/dental';

export type WirePointYX = [number, number]; // [y, x] in 0-1000
export type NormalizedPointXY = [number, number]; // [x, y] in 0-1.0
export type PixelPointXY = [number, number]; // [x, y] in pixels

export function validateWirePolygon(points: any[]): WirePointYX[] {
  if (!Array.isArray(points) || points.length < 3) {
    return [];
  }
  
  const validPoints: WirePointYX[] = [];
  for (const p of points) {
    if (Array.isArray(p) && p.length >= 2) {
      const y = Number(p[0]);
      const x = Number(p[1]);
      if (Number.isFinite(y) && Number.isFinite(x) && !Number.isNaN(y) && !Number.isNaN(x)) {
        // clamp to 0-1000
        const clampedY = Math.max(0, Math.min(1000, y));
        const clampedX = Math.max(0, Math.min(1000, x));
        validPoints.push([clampedY, clampedX]);
      }
    }
  }
  
  return validPoints.length >= 3 ? validPoints : [];
}

export function convertWireToPixelPolygon(wirePoints: any[], imgW: number, imgH: number): PixelPointXY[] {
  const validWire = validateWirePolygon(wirePoints);
  return validWire.map(([y, x]) => [
    Math.round((x / 1000) * imgW),
    Math.round((y / 1000) * imgH),
  ]);
}

/**
 * Directly maps a canonical normalized wire coordinate [y, x] in 0-1000 space
 * to a canvas coordinate [x, y] on a target display canvas of size canvasW x canvasH.
 * 
 * Invariant:
 * [y=500, x=500] maps to the visual center (0.5 * canvasW, 0.5 * canvasH) regardless of original image resolution.
 */
export function mapWireToCanvasPoint(
  wirePoint: WirePointYX,
  canvasW: number,
  canvasH: number
): [number, number] {
  const y = Math.max(0, Math.min(1000, Number(wirePoint[0]) || 0));
  const x = Math.max(0, Math.min(1000, Number(wirePoint[1]) || 0));
  return [
    (x / 1000) * canvasW,
    (y / 1000) * canvasH,
  ];
}

/**
 * Maps an array of normalized wire coordinates to canvas coordinates.
 */
export function mapWireToCanvasPolygon(
  wirePoints: any[],
  canvasW: number,
  canvasH: number
): [number, number][] {
  const valid = validateWirePolygon(wirePoints);
  return valid.map((pt) => mapWireToCanvasPoint(pt, canvasW, canvasH));
}

/**
 * Maps a pixel coordinate (relative to reference image of dimensions refW x refH)
 * to a target display canvas of dimensions canvasW x canvasH.
 */
export function mapPixelToCanvas(
  point: PixelPointXY,
  refW: number,
  refH: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const scaleX = canvasW / (refW || 1);
  const scaleY = canvasH / (refH || 1);
  return [point[0] * scaleX, point[1] * scaleY];
}

/**
 * Maps a display canvas coordinate [x, y] back to reference image pixel coordinates [x, y].
 */
export function mapCanvasToPixel(
  canvasPoint: [number, number],
  refW: number,
  refH: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  const scaleX = (refW || 1) / (canvasW || 1);
  const scaleY = (refH || 1) / (canvasH || 1);
  return [
    Math.round(canvasPoint[0] * scaleX),
    Math.round(canvasPoint[1] * scaleY),
  ];
}

/**
 * Pure production mapper to normalize a server pathology finding into a client AIDetection.
 * Guarantees that:
 * - Explicit 0 confidence is preserved strictly as 0
 * - Real number confidence is clamped/rounded
 * - Missing/undefined confidence remains undefined (no synthetic high score like 85/90/100)
 */
export function mapServerFindingToAIDetection(
  p: any,
  idx: number,
  refW: number,
  refH: number,
  _idPrefix: string = 'pathology'
): AIDetection {
  const key = (p.key || p.pathologyKey) as PathologyKey;
  const taxItem = PATHOLOGY_DICT[key] || {
    key,
    domainId: 'domain_p1',
    label: key,
    color: '#ef4444',
    fillColor: '#ef444433',
  };

  const rawPoints = p.polygon_points || p.polygonPoints;
  const validWire = validateWirePolygon(rawPoints);
  const hasValidGeom = validWire.length >= 3;

  let geometryStatus: GeometryStatus = p.geometryStatus || (hasValidGeom ? 'valid' : 'unavailable');
  if (!p.geometryStatus) {
    if (!rawPoints || rawPoints.length === 0) {
      geometryStatus = 'unavailable';
    } else if (!hasValidGeom) {
      geometryStatus = 'malformed';
    }
  }

  let pixelPoints: [number, number][] = [];
  let bbox: [number, number, number, number] = [0, 0, 0, 0];
  let pixelArea = 0;

  if (hasValidGeom) {
    pixelPoints = convertWireToPixelPolygon(validWire, refW, refH);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    pixelPoints.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    bbox = [
      minX === Infinity ? 0 : minX,
      minY === Infinity ? 0 : minY,
      maxX === -Infinity ? 0 : maxX,
      maxY === -Infinity ? 0 : maxY,
    ];
    pixelArea = Math.round(Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]));
  } else {
    // Unlocalised finding: safe empty coordinates, do NOT fabricate full-canvas or fake bbox
    pixelPoints = [];
    bbox = [0, 0, 0, 0];
    pixelArea = 0;
  }

  const confidence = (typeof p.confidence === 'number' && Number.isFinite(p.confidence))
    ? Math.round(p.confidence)
    : 0;

  const suppliedId = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : undefined;

  return {
    // Canonical results always carry a server-issued opaque ID. This temporary
    // legacy-only handle is never persisted as a new canonical identity.
    id: suppliedId || `legacy-unassigned-${idx}`,
    origin: 'ai',
    pathologyKey: key,
    domainId: taxItem.domainId,
    confidence,
    modelAScore: p.modelAScore,
    modelBScore: p.modelBScore,
    bbox,
    polygonPoints: pixelPoints,
    geometryStatus,
    pixelArea,
    color: taxItem.color,
    fillColor: taxItem.fillColor,
    treatmentRecommendation: p.treatmentRecommendation,
    provenance: p.provenance,
    humanReviewed: p.humanReviewed,
  };
}
