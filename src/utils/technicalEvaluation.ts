import type {
  AIAnalysisResult,
  AssessmentLogPayload,
  TechnicalEvaluationData,
  TechnicalReviewVersion,
} from '../types/dental';

function hasStoredEvaluation(value: unknown): value is TechnicalEvaluationData {
  const candidate = value as TechnicalEvaluationData | undefined;
  return candidate?.schemaVersion === 1
    && Boolean(candidate.aiPredictionSnapshot)
    && Array.isArray(candidate.reviewHistory)
    && (candidate.reviewState === 'unreviewed' || candidate.reviewState === 'reviewed');
}

function isCompleted(record: Partial<AssessmentLogPayload>): boolean {
  return record.sessionStatus === 'COMPLETED'
    || record.lastCompletedStep === 5
    || record.stepStatus?.step5 === true;
}

function isInvalid(record: Partial<AssessmentLogPayload>): boolean {
  return record.sessionStatus === 'FAILED_NON_DENTAL'
    || record.aiAnalysis?.isPeriapicalRadiograph === false
    || record.finalConfirmedErrors?.includes('not_periapical') === true;
}

/** Creates the immutable Technical prediction before any Admin review occurs. */
export function createUnreviewedTechnicalEvaluation(aiAnalysis: AIAnalysisResult): TechnicalEvaluationData {
  return {
    schemaVersion: 1,
    aiPredictionSnapshot: structuredClone(aiAnalysis),
    reviewState: 'unreviewed',
    reviewHistory: [],
  };
}

/**
 * Reads legacy records without rewriting them. Historical completed Technical
 * records predate explicit review state, so their existing final truth is exposed
 * as a derived version 1 while the persisted record remains unchanged.
 */
export function readTechnicalEvaluation(
  record: Partial<AssessmentLogPayload> & Record<string, any>,
): TechnicalEvaluationData {
  if (hasStoredEvaluation(record.technicalEvaluation)) {
    return structuredClone(record.technicalEvaluation);
  }

  const evaluation = createUnreviewedTechnicalEvaluation(structuredClone(record.aiAnalysis));
  const legacyReviewed = !isInvalid(record)
    && (Boolean(record.verifiedAt || record.verifiedBy) || isCompleted(record));
  if (!legacyReviewed) return evaluation;

  const review: TechnicalReviewVersion = {
    version: 1,
    reviewed: true,
    reviewerId: typeof record.verifiedBy === 'string' && record.verifiedBy
      ? record.verifiedBy
      : typeof record.userId === 'string' && record.userId
        ? record.userId
        : 'reviewer-unavailable:legacy-record',
    reviewedAt: String(record.verifiedAt || record.updatedAt || record.timestamp || ''),
    finalClassKeys: structuredClone((record.finalConfirmedErrors || []).filter((key: string) => key !== 'not_periapical')),
    ...(typeof record.verifiedNotes === 'string'
      ? { notes: record.verifiedNotes }
      : typeof record.userValidation?.userNotes === 'string'
        ? { notes: record.userValidation.userNotes }
        : typeof record.userNotes === 'string'
          ? { notes: record.userNotes }
          : {}),
  };
  return {
    ...evaluation,
    reviewState: 'reviewed',
    currentReview: structuredClone(review),
    reviewHistory: [review],
  };
}

/** Appends human truth without changing the model snapshot or prior decisions. */
export function appendTechnicalReview(
  evaluation: TechnicalEvaluationData,
  input: Omit<TechnicalReviewVersion, 'version' | 'reviewed'>,
): TechnicalEvaluationData {
  const history = structuredClone(evaluation.reviewHistory || []);
  const version = history.reduce((highest, review) => Math.max(highest, review.version), 0) + 1;
  const review: TechnicalReviewVersion = {
    version,
    reviewed: true,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    finalClassKeys: structuredClone(input.finalClassKeys),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
  history.push(review);
  return {
    schemaVersion: 1,
    aiPredictionSnapshot: structuredClone(evaluation.aiPredictionSnapshot),
    reviewState: 'reviewed',
    currentReview: structuredClone(review),
    reviewHistory: history,
  };
}

/**
 * Keeps the first real server result immutable while allowing an early workflow
 * placeholder to be replaced once by an attested inference result. Public saves
 * can never remove or overwrite an existing Admin review.
 */
export function mergeTechnicalEvaluation(
  previousRecord: (Partial<AssessmentLogPayload> & Record<string, any>) | undefined,
  incoming: TechnicalEvaluationData | undefined,
): TechnicalEvaluationData | undefined {
  if (!previousRecord?.technicalEvaluation) return incoming ? structuredClone(incoming) : undefined;
  const previous = readTechnicalEvaluation(previousRecord);
  if (!incoming) return previous;

  const previousHasLineage = previous.aiPredictionSnapshot.inferenceLineage?.status === 'available';
  const incomingHasLineage = incoming.aiPredictionSnapshot.inferenceLineage?.status === 'available';
  const aiPredictionSnapshot = !previousHasLineage && incomingHasLineage
    ? structuredClone(incoming.aiPredictionSnapshot)
    : structuredClone(previous.aiPredictionSnapshot);

  if (previous.reviewState === 'reviewed') {
    return { ...previous, aiPredictionSnapshot };
  }
  return {
    ...structuredClone(incoming),
    aiPredictionSnapshot,
  };
}
