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
