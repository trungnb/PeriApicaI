import { PATHOLOGY_DICT, TECH_FAILURE_DICT, normalizeTechFailureKey } from '../constants/dictionaries';
import { validateWirePolygon, WirePointYX } from './polygonAdapter';

export function validateClassicOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON structure returned by classic AI model');
  }

  if (
    typeof parsed.isPeriapicalRadiograph !== 'boolean' ||
    typeof parsed.overallQuality !== 'string' ||
    !Array.isArray(parsed.errors)
  ) {
    throw new Error('Malformed AI Output: Missing required root fields (isPeriapicalRadiograph, overallQuality, errors)');
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

      if (err.confidence === undefined || err.confidence === null) {
        throw new Error(`Malformed AI Output: Technical error "${normalizedKey}" is missing required confidence`);
      }
      const numConf = Number(err.confidence);
      if (!Number.isFinite(numConf) || isNaN(numConf)) {
        throw new Error(`Malformed AI Output: Technical error "${normalizedKey}" has non-numeric confidence: ${err.confidence}`);
      }
      const clampedConf = Math.max(0, Math.min(100, Math.round(numConf)));

      if (!seenKeys.has(normalizedKey)) {
        seenKeys.add(normalizedKey);
        validErrors.push({
          ...err,
          errorKey: normalizedKey,
          confidence: clampedConf,
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

export const CANONICAL_PATHOLOGY_KEYS = Object.keys(PATHOLOGY_DICT) as Array<keyof typeof PATHOLOGY_DICT>;

export function validatePathologyOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON structure returned by pathology AI model');
  }

  if (
    typeof parsed.overallSummary !== 'string' ||
    !Array.isArray(parsed.observationChain) ||
    !Array.isArray(parsed.pathologies)
  ) {
    throw new Error('Malformed AI Output: Missing required root fields (overallSummary, observationChain, pathologies)');
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

      if (p.confidence === undefined || p.confidence === null) {
        throw new Error(`Malformed AI Output: Pathology finding "${key}" is missing required confidence`);
      }
      const numConf = Number(p.confidence);
      if (!Number.isFinite(numConf) || isNaN(numConf)) {
        throw new Error(`Malformed AI Output: Pathology finding "${key}" has non-numeric confidence: ${p.confidence}`);
      }
      const clampedConf = Math.max(0, Math.min(100, Math.round(numConf)));

      // Determine geometry status and normalize polygon contour points
      const rawPoints = p.polygon_points || p.polygonPoints;
      let geometryStatus: 'valid' | 'unavailable' | 'malformed' = 'valid';
      let validPoints: WirePointYX[] = [];

      if (!rawPoints || (Array.isArray(rawPoints) && rawPoints.length === 0)) {
        geometryStatus = 'unavailable';
        validPoints = [];
      } else {
        validPoints = validateWirePolygon(rawPoints);
        if (validPoints.length < 3) {
          geometryStatus = 'malformed';
          validPoints = [];
        } else {
          geometryStatus = 'valid';
        }
      }

      validPathologies.push({
        key,
        confidence: clampedConf,
        polygon_points: validPoints,
        geometryStatus,
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

