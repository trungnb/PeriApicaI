import { validateWirePolygon, convertWireToPixelPolygon } from './polygonAdapter';

function testAdapter() {
  const invalid = validateWirePolygon([[100, 200]]);
  if (invalid.length !== 0) throw new Error("Should reject <3 points");

  const valid = validateWirePolygon([[100, 200], [300, 400], [100, 400]]);
  if (valid.length !== 3) throw new Error("Should accept 3 points");

  // Out of bounds
  const clamped = validateWirePolygon([[-10, 2000], [100, 100], [50, 50]]);
  if (clamped[0][0] !== 0 || clamped[0][1] !== 1000) throw new Error("Should clamp to 0-1000");

  const pixels = convertWireToPixelPolygon([[500, 500], [0, 1000], [1000, 0]], 1000, 2000);
  // [y, x] = [500, 500] -> [x, y] = [ (500/1000)*1000, (500/1000)*2000 ] = [500, 1000]
  if (pixels[0][0] !== 500 || pixels[0][1] !== 1000) throw new Error(`Expected [500, 1000], got [${pixels[0][0]}, ${pixels[0][1]}]`);
  
  console.log('✅ polygonAdapter tests passed!');
}

testAdapter();
