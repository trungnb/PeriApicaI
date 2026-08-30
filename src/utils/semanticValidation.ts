import { PATHOLOGY_DICT, TECH_FAILURE_DICT, normalizeTechFailureKey } from '../constants/dictionaries';
import { validateWirePolygon } from './polygonAdapter';

export function validateClassicOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON structure returned by classic AI model');
  }
  
  const validErrors: any[] = [];
  const seenKeys = new Set<string>();

  if (Array.isArray(parsed.errors)) {
    for (const err of parsed.errors) {
      if (!err || typeof err !== 'object') continue;
      const rawKey = err.errorKey || err.key || err.code;
      if (typeof rawKey !== 'string') continue;

      const normalizedKey = normalizeTechFailureKey(rawKey);
      if (!TECH_FAILURE_DICT[normalizedKey]) {
        // Must belong to standardized technical failure taxonomy
        continue;
      }
      
      if (!seenKeys.has(normalizedKey)) {
        seenKeys.add(normalizedKey);
        
        // Clamp confidence strictly 0-100
        let conf = Number(err.confidence);
        if (isNaN(conf) || !Number.isFinite(conf)) conf = 85;
        conf = Math.max(0, Math.min(100, Math.round(conf)));
        
        validErrors.push({
          ...err,
          errorKey: normalizedKey,
          confidence: conf,
        });
      }
    }
  }

  const overallQuality = typeof parsed.overallQuality === 'string' &&
    ['Diagnostic', 'Needs Retake', 'Unsatisfactory'].includes(parsed.overallQuality)
      ? parsed.overallQuality
      : 'Diagnostic';

  return {
    isPeriapicalRadiograph: typeof parsed.isPeriapicalRadiograph === 'boolean' ? parsed.isPeriapicalRadiograph : true,
    overallQuality,
    errors: validErrors.slice(0, 15),
    anomalyNote: typeof parsed.anomalyNote === 'string' ? parsed.anomalyNote.slice(0, 300) : '',
    observationChain: Array.isArray(parsed.observationChain) ? parsed.observationChain.filter(s => typeof s === 'string').slice(0, 10) : [],
  };
}

export function validatePathologyOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON structure returned by pathology AI model');
  }

  const validPathologies: any[] = [];
  
  if (Array.isArray(parsed.pathologies)) {
    for (const p of parsed.pathologies) {
      if (!p || typeof p !== 'object') continue;
      
      const key = p.key;
      if (typeof key !== 'string' || !PATHOLOGY_DICT[key]) {
        // Must belong to 8-class pathology taxonomy
        continue;
      }

      // Validate polygon contour points
      const rawPoints = p.polygon_points || p.polygonPoints;
      const validPoints = validateWirePolygon(rawPoints);
      
      // Require at least 3 vertices to form a valid spatial closed contour
      if (validPoints.length < 3) {
        continue;
      }

      // Clamp confidence strictly 0-100
      let conf = Number(p.confidence);
      if (isNaN(conf) || !Number.isFinite(conf)) conf = 85;
      conf = Math.max(0, Math.min(100, Math.round(conf)));
      
      validPathologies.push({
        key,
        confidence: conf,
        polygon_points: validPoints,
        clinicalNote: typeof p.clinicalNote === 'string' ? p.clinicalNote : '',
        treatmentRecommendation: typeof p.treatmentRecommendation === 'string' ? p.treatmentRecommendation : '',
        provenance: p.provenance || 'single_mode',
      });
    }
  }
  
  let obs = parsed.observationChain;
  if (Array.isArray(obs)) {
    obs = obs.filter(item => typeof item === 'string' && item.trim().length > 0).slice(0, 20);
  } else {
    obs = [];
  }

  const overallSummary = typeof parsed.overallSummary === 'string' ? parsed.overallSummary.trim() : '';

  return {
    overallSummary,
    observationChain: obs,
    pathologies: validPathologies.slice(0, 20),
  };
}

