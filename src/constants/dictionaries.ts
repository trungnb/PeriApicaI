import {
  PathologyTaxonomyItem,
  BilingualTaxonomyErrorItem,
} from '../types/dental';
import { PATHOLOGY_TAXONOMY } from '../data/pathologyTaxonomyData';
import { TAXONOMY_ERRORS } from '../data/taxonomyData';

/**
 * ─────────────────────────────────────────────────────────────
 * PATHOLOGY DICTIONARY (2D Spatial & Disease Findings)
 * ─────────────────────────────────────────────────────────────
 */
export const PATHOLOGY_DICT: Record<string, PathologyTaxonomyItem> = Object.fromEntries(
  PATHOLOGY_TAXONOMY.map((item) => [item.key, item])
);

/**
 * ─────────────────────────────────────────────────────────────
 * TECHNICAL FAILURE DICTIONARY (Quality & Artifact Findings)
 * ─────────────────────────────────────────────────────────────
 */
export const TECH_FAILURE_DICT: Record<string, BilingualTaxonomyErrorItem> = TAXONOMY_ERRORS.reduce(
  (acc, curr) => {
    acc[curr.key] = curr;
    return acc;
  },
  {} as Record<string, BilingualTaxonomyErrorItem>
);

/**
 * Shorthand and uppercase failure code aliases mapped to standardized taxonomy keys.
 * Enables zero-latency prompt compression (e.g. CONE_CUT, DBL_EXP) without large textual overhead.
 */
export const TECH_FAILURE_ALIASES: Record<string, string> = {
  // Direct Uppercase standard keys
  MISSING_APICAL: 'missing_apical',
  MISSING_CORONAL_MESIAL_DISTAL: 'missing_coronal_mesial_distal',
  WRONG_TARGET_TOOTH: 'wrong_target_tooth',
  NOT_PERIAPICAL: 'not_periapical',
  TILTED_OCCLUSAL: 'tilted_occlusal',
  ELONGATION: 'elongation',
  FORESHORTENING: 'foreshortening',
  OVERLAPPING: 'overlapping',
  CONE_CUT: 'cone_cut',
  UNDEREXPOSED_OVEREXPOSED: 'underexposed_overexposed',
  MOTION_BLUR: 'motion_blur',
  REVERSED_RECEPTOR: 'reversed_receptor',
  DOUBLE_EXPOSURE: 'double_exposure',

  // Clinical Abbreviations & Shorthand codes
  CONECUT: 'cone_cut',
  DBL_EXP: 'double_exposure',
  DBL_EXPOSURE: 'double_exposure',
  DOUBLE_EXP: 'double_exposure',
  MISSING_APEX: 'missing_apical',
  APEX_CUT: 'missing_apical',
  MISSING_CROWN: 'missing_coronal_mesial_distal',
  WRONG_TOOTH: 'wrong_target_tooth',
  WRONG_POSITION: 'wrong_target_tooth',
  NON_DENTAL: 'not_periapical',
  NON_PERIAPICAL: 'not_periapical',
  TILTED: 'tilted_occlusal',
  OCCLUSAL_TILT: 'tilted_occlusal',
  OVERLAP: 'overlapping',
  CONTACT_OVERLAP: 'overlapping',
  UNDEREXPOSED: 'underexposed_overexposed',
  OVEREXPOSED: 'underexposed_overexposed',
  UNDER_OVER_EXPOSURE: 'underexposed_overexposed',
  MOTION: 'motion_blur',
  MOTION_UNSHARPNESS: 'motion_blur',
  REVERSED: 'reversed_receptor',
  BACKWARDS_RECEPTOR: 'reversed_receptor',
  ARTEFACTS: 'underexposed_overexposed',
};

/**
 * Normalizes any technical error key or shorthand code into a standardized taxonomy key.
 */
export function normalizeTechFailureKey(rawKey: string): string {
  if (!rawKey) return '';
  const trimmed = rawKey.trim();
  const upper = trimmed.toUpperCase();
  if (TECH_FAILURE_ALIASES[upper]) {
    return TECH_FAILURE_ALIASES[upper];
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'radiopaque_artefacts' || lower === 'artefacts') return 'underexposed_overexposed';
  if (lower === 'motion_unsharpness') return 'motion_blur';
  if (TECH_FAILURE_DICT[lower]) return lower;
  return lower;
}

/**
 * Retrieves human-readable label for a technical failure key.
 */
export function getTechFailureLabel(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const norm = normalizeTechFailureKey(key);
  const item = TECH_FAILURE_DICT[norm];
  if (!item) return key;
  return language === 'EN' ? item.labelEn || item.label : item.label;
}

/**
 * Retrieves human-readable description for a technical failure key.
 */
export function getTechFailureDescription(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const norm = normalizeTechFailureKey(key);
  const item = TECH_FAILURE_DICT[norm];
  if (!item) return '';
  return language === 'EN' ? item.descriptionEn || item.description : item.description;
}

/**
 * Retrieves remediation / clinical guidance text for a technical error.
 */
export function getRemediationText(errorKey: string, lang: 'VI' | 'EN' = 'VI'): string {
  const normalizedKey = normalizeTechFailureKey(errorKey);
  const item = TECH_FAILURE_DICT[normalizedKey];
  if (!item) return '';
  return lang === 'EN' ? item.remediationEn : item.remediation;
}

/**
 * Retrieves human-readable label for a pathology key.
 */
export function getPathologyLabel(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return key;
  return language === 'EN' ? item.labelEn : item.label;
}

/**
 * Retrieves human-readable description for a pathology key.
 */
export function getPathologyDescription(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return '';
  return language === 'EN' ? item.descriptionEn : item.description;
}

/**
 * Retrieves treatment recommendation text for a pathology key.
 */
export function getTreatmentText(key: string, language: 'VI' | 'EN' = 'VI'): string {
  const item = PATHOLOGY_DICT[key];
  if (!item) return '';
  return language === 'EN' ? item.protocol.primaryTreatmentEn : item.protocol.primaryTreatment;
}

/**
 * Retrieves color and overlay fill for a pathology key.
 */
export function getPathologyColor(key: string): { color: string; fillColor: string } {
  const item = PATHOLOGY_DICT[key];
  return { color: item?.color ?? '#94a3b8', fillColor: item?.fillColor ?? 'rgba(148,163,184,0.22)' };
}
