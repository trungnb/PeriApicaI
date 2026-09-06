import { PATHOLOGY_DICT } from '../constants/dictionaries';
import type { AIDetection, ConfirmedPathology, PathologyKey } from '../types/dental';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Turns one immutable AI lesion instance into an independently editable review finding. */
export function makeConfirmedPathology(
  detection: AIDetection,
  options: Partial<Pick<ConfirmedPathology, 'geminiVerified' | 'geminiNote' | 'isUserEdited' | 'humanReviewed'>> = {},
): ConfirmedPathology {
  const taxonomy = PATHOLOGY_DICT[detection.pathologyKey];
  return {
    ...clone(detection),
    origin: detection.origin ?? 'ai',
    label: taxonomy?.label ?? detection.pathologyKey,
    labelEn: taxonomy?.labelEn ?? detection.pathologyKey,
    description: taxonomy?.description ?? '',
    descriptionEn: taxonomy?.descriptionEn ?? '',
    geminiVerified: options.geminiVerified ?? false,
    ...(options.geminiNote === undefined ? {} : { geminiNote: options.geminiNote }),
    isUserEdited: options.isUserEdited ?? false,
    ...(options.humanReviewed === undefined ? {} : { humanReviewed: options.humanReviewed }),
  };
}

/** Selects or rejects exactly one lesion instance; same-class siblings are untouched. */
export function toggleReviewedLesion(
  findings: ConfirmedPathology[],
  lesion: AIDetection | ConfirmedPathology,
): ConfirmedPathology[] {
  if (findings.some((finding) => finding.id === lesion.id)) {
    return findings.filter((finding) => finding.id !== lesion.id);
  }
  return [...findings, makeConfirmedPathology(lesion, { isUserEdited: true, humanReviewed: true })];
}

/** Human findings have an opaque human-owned identity and never replace an AI prediction. */
export function createHumanPathology(key: PathologyKey): ConfirmedPathology {
  const taxonomy = PATHOLOGY_DICT[key];
  const bbox: [number, number, number, number] = [150, 150, 350, 350];
  return {
    id: `human_${crypto.randomUUID()}`,
    origin: 'human',
    pathologyKey: key,
    domainId: taxonomy.domainId,
    confidence: 100,
    bbox,
    polygonPoints: [[150, 150], [350, 150], [350, 350], [150, 350]],
    geometryStatus: 'valid',
    color: taxonomy.color,
    fillColor: taxonomy.fillColor,
    label: taxonomy.label,
    labelEn: taxonomy.labelEn,
    description: taxonomy.description,
    descriptionEn: taxonomy.descriptionEn,
    geminiVerified: false,
    isUserEdited: true,
    humanReviewed: true,
  };
}

/** Applies clinician geometry/label edits over their matching AI lesion without mutating the snapshot. */
export function mergeReviewCandidates(
  aiSnapshot: AIDetection[],
  reviewedFindings: ConfirmedPathology[],
): ConfirmedPathology[] {
  const reviewedById = new Map(reviewedFindings.map((finding) => [finding.id, finding]));
  const candidates = aiSnapshot.map((prediction) => clone(reviewedById.get(prediction.id) ?? makeConfirmedPathology(prediction)));
  for (const finding of reviewedFindings) {
    if (!aiSnapshot.some((prediction) => prediction.id === finding.id)) candidates.push(clone(finding));
  }
  return candidates;
}

/** Returns the selected instances in source order. An empty ID list is an explicit negative review. */
export function selectReviewFindingsById(
  candidates: ConfirmedPathology[],
  selectedIds: string[],
  options: Partial<Pick<ConfirmedPathology, 'geminiVerified' | 'isUserEdited' | 'humanReviewed'>> = {},
): ConfirmedPathology[] {
  const selected = new Set(selectedIds);
  return candidates
    .filter((finding) => selected.has(finding.id))
    .map((finding) => ({
      ...clone(finding),
      geminiVerified: options.geminiVerified ?? finding.geminiVerified,
      isUserEdited: options.isUserEdited ?? finding.isUserEdited,
      humanReviewed: options.humanReviewed ?? finding.humanReviewed,
    }));
}
