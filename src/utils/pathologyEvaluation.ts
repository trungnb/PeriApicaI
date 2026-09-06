import type {
  AIDetection,
  PathologyAssessmentLog,
  PathologyEvaluationData,
  PathologyReviewVersion,
} from '../types/dental';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hasLesionId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function issueLegacyLesionId(): string {
  return `lesion_${crypto.randomUUID()}`;
}

/**
 * Materializes IDs only while writing a legacy record. Reads remain non-mutating.
 * Existing nonblank IDs are preserved verbatim.
 */
export function materializePathologyEvaluationLesionIds(evaluation: PathologyEvaluationData): PathologyEvaluationData {
  return {
    ...clone(evaluation),
    aiPredictionSnapshot: evaluation.aiPredictionSnapshot.map((detection) => ({
      ...clone(detection),
      ...(hasLesionId(detection.id) ? {} : { id: issueLegacyLesionId() }),
    })),
  };
}

/** Creates the immutable AI snapshot before any clinician or admin edit occurs. */
export function createUnreviewedPathologyEvaluation(detections: AIDetection[]): PathologyEvaluationData {
  return {
    schemaVersion: 1,
    aiPredictionSnapshot: clone(detections),
    reviewState: 'unreviewed',
    reviewHistory: [],
  };
}

/**
 * Reads both R26A and legacy records without rewriting legacy data. Legacy review
 * flags are represented as a single derived review so existing records stay usable.
 */
export function readPathologyEvaluation(record: Partial<PathologyAssessmentLog> & Record<string, any>): PathologyEvaluationData {
  const existing = record.pathologyEvaluation as PathologyEvaluationData | undefined;
  if (existing?.schemaVersion === 1 && Array.isArray(existing.aiPredictionSnapshot) && Array.isArray(existing.reviewHistory)) {
    return clone(existing);
  }

  const aiPredictionSnapshot = clone(Array.isArray(record.detectedPathologies) ? record.detectedPathologies : []);
  const legacyReviewed = Boolean(record.isReviewedByAdmin || record.verifiedBy || record.verifiedAt);
  if (!legacyReviewed) return createUnreviewedPathologyEvaluation(aiPredictionSnapshot);

  const finalFindings = clone(
    Array.isArray(record.finalConfirmedPathologies)
      ? record.finalConfirmedPathologies
      : Array.isArray(record.confirmedPathologies)
        ? record.confirmedPathologies
        : [],
  );
  const review: PathologyReviewVersion = {
    version: 1,
    reviewed: true,
    reviewerId: typeof record.verifiedBy === 'string' && record.verifiedBy ? record.verifiedBy : 'legacy-reviewer-unknown',
    reviewedAt: typeof record.verifiedAt === 'string' && record.verifiedAt ? record.verifiedAt : String(record.updatedAt || record.timestamp || ''),
    finalFindings,
    ...(typeof record.verifiedNotes === 'string' ? { notes: record.verifiedNotes } : {}),
  };
  return {
    schemaVersion: 1,
    aiPredictionSnapshot,
    reviewState: 'reviewed',
    currentReview: clone(review),
    reviewHistory: [review],
  };
}

/** Appends a new human truth version without mutating model output or prior reviews. */
export function appendPathologyReview(
  evaluation: PathologyEvaluationData,
  input: Omit<PathologyReviewVersion, 'version' | 'reviewed'>,
): PathologyEvaluationData {
  const history = clone(evaluation.reviewHistory || []);
  const version = history.reduce((highest, review) => Math.max(highest, review.version), 0) + 1;
  const review: PathologyReviewVersion = {
    version,
    reviewed: true,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    finalFindings: clone(input.finalFindings),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
  history.push(review);
  return {
    schemaVersion: 1,
    aiPredictionSnapshot: clone(evaluation.aiPredictionSnapshot),
    reviewState: 'reviewed',
    currentReview: clone(review),
    reviewHistory: history,
  };
}
