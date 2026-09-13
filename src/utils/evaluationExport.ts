import { TAXONOMY_ERRORS } from '../data/taxonomyData';
import { CANONICAL_PATHOLOGY_KEYS } from './semanticValidation';
import { readPathologyEvaluation } from './pathologyEvaluation';
import { readTechnicalEvaluation } from './technicalEvaluation';
import type {
  AIDetectedError,
  AIAnalysisResult,
  AssessmentLogPayload,
  ConfirmedPathology,
  PathologyAssessmentLog,
  PathologyKey,
  TechniqueType,
  ReceptorType,
  ToothInfo,
  EvaluationInferenceLineage,
  ValidityAuditMetadata,
  TechnicalReviewVersion,
} from '../types/dental';
import { inferenceLineageForEvaluation } from './inferenceLineage';

export type EvaluationDisposition =
  | 'unreviewed'
  | 'reviewed_positive'
  | 'reviewed_negative'
  | 'incomplete'
  | 'invalid_unusable';

export interface EvaluationCaseContext {
  assessmentId: string;
  timestamp: string;
  tooth: ToothInfo;
  technique: TechniqueType;
  receptorType: ReceptorType;
  sessionStatus?: string;
}

export interface TechnicalEvaluationFinding {
  classKey: string;
  confidence: number;
  modelAScore?: number;
  modelBScore?: number;
  provenance?: AIDetectedError['provenance'];
}

export interface TechnicalEvaluationRecord {
  schemaVersion: 1;
  modality: 'technical';
  context: EvaluationCaseContext;
  disposition: EvaluationDisposition;
  supervisedMetricsEligible: boolean;
  inferenceLineage: EvaluationInferenceLineage;
  validityAudit?: ValidityAuditMetadata;
  exclusionReason?: 'unreviewed' | 'incomplete' | 'invalid_or_unusable';
  aiPredictionSnapshot: {
    overallQuality: AssessmentLogPayload['aiAnalysis']['overallQuality'];
    findings: TechnicalEvaluationFinding[];
    consensusMeta?: AssessmentLogPayload['aiAnalysis']['consensusMeta'];
  };
  humanReview?: {
    status: 'reviewed';
    version: number;
    reviewerId: string;
    reviewedAt: string;
    finalClassKeys: string[];
    notes?: string;
  };
  reviewHistory: Array<{
    version: number;
    reviewerId: string;
    reviewedAt: string;
    finalClassKeys: string[];
    notes?: string;
  }>;
}

export interface PathologyEvaluationLesion {
  id: string;
  origin: 'ai' | 'human';
  classKey: PathologyKey;
  confidence: number;
  bbox: [number, number, number, number];
  polygonPoints?: [number, number][];
  geometryStatus?: string;
  pixelArea?: number;
}

export interface PathologyEvaluationRecord {
  schemaVersion: 1;
  modality: 'pathology';
  context: EvaluationCaseContext;
  disposition: EvaluationDisposition;
  supervisedMetricsEligible: boolean;
  inferenceLineage: EvaluationInferenceLineage;
  validityAudit?: ValidityAuditMetadata;
  exclusionReason?: 'unreviewed' | 'incomplete' | 'invalid_or_unusable';
  aiPredictionSnapshot: {
    lesions: PathologyEvaluationLesion[];
  };
  humanReview?: {
    status: 'reviewed';
    version: number;
    reviewerId: string;
    reviewedAt: string;
    finalFindings: PathologyEvaluationLesion[];
  };
  localizationEvaluation: {
    status: 'deferred';
    reason: 'No lesion matching or IoU policy is currently defined.';
  };
}

export interface ClassPresenceMetric {
  classKey: string;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  agreement: number;
  disagreement: number;
  sensitivity: number | null;
  specificity: number | null;
  precision: number | null;
  recall: number | null;
}

export interface PresenceMetricSummary {
  eligibleCases: number;
  excludedCases: number;
  perClass: ClassPresenceMetric[];
  totals: Omit<ClassPresenceMetric, 'classKey'>;
}

export interface EvaluationExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  manifest: {
    exportId: string;
    totalExportedRecordCount: number;
    scope: { modality: 'technical' | 'pathology' | 'combined'; filters: Record<string, string | boolean | undefined>; isPartial: boolean };
    canonicalContentHash: { algorithm: 'sha-256'; value: string };
  };
  technical: TechnicalEvaluationRecord[];
  pathology: PathologyEvaluationRecord[];
  metricPolicy: {
    unit: 'per-assessment-class-presence';
    unreviewedCases: 'excluded';
    confidenceMeaning: 'AI confidence score; not a calibrated probability';
    lesionMatching: 'deferred';
  };
}

export const TECHNICAL_EVALUATION_CLASS_KEYS = TAXONOMY_ERRORS.map((item) => item.key);
export const PATHOLOGY_EVALUATION_CLASS_KEYS = [...CANONICAL_PATHOLOGY_KEYS];

function contextFrom(record: AssessmentLogPayload | PathologyAssessmentLog): EvaluationCaseContext {
  return {
    assessmentId: record.assessmentId,
    timestamp: record.timestamp,
    tooth: structuredClone(record.tooth),
    technique: record.technique,
    receptorType: record.receptorType,
    ...(record.sessionStatus === undefined ? {} : { sessionStatus: record.sessionStatus }),
  };
}

function isCompleted(record: { sessionStatus?: string; lastCompletedStep?: number; stepStatus?: { step5?: boolean } }): boolean {
  return record.sessionStatus === 'COMPLETED' || record.lastCompletedStep === 5 || record.stepStatus?.step5 === true;
}

function eligibility(disposition: EvaluationDisposition) {
  if (disposition === 'reviewed_positive' || disposition === 'reviewed_negative') {
    return { supervisedMetricsEligible: true as const };
  }
  const exclusionReason = disposition === 'unreviewed'
    ? 'unreviewed' as const
    : disposition === 'incomplete'
      ? 'incomplete' as const
      : 'invalid_or_unusable' as const;
  return { supervisedMetricsEligible: false as const, exclusionReason };
}

function technicalAiFindings(aiAnalysis: AIAnalysisResult): TechnicalEvaluationFinding[] {
  return (aiAnalysis?.findings ?? []).flatMap((domain) =>
    (domain.detectedErrors ?? []).map((finding) => ({
      classKey: finding.errorKey,
      confidence: finding.confidence,
      ...(finding.modelAScore === undefined ? {} : { modelAScore: finding.modelAScore }),
      ...(finding.modelBScore === undefined ? {} : { modelBScore: finding.modelBScore }),
      ...(finding.provenance === undefined ? {} : { provenance: finding.provenance }),
    })),
  );
}

export function exportTechnicalEvaluationRecord(record: AssessmentLogPayload): TechnicalEvaluationRecord {
  const evaluation = readTechnicalEvaluation(record);
  const aiPrediction = evaluation.aiPredictionSnapshot;
  const invalid = record.sessionStatus === 'FAILED_NON_DENTAL'
    || aiPrediction?.isPeriapicalRadiograph === false
    || aiPrediction?.overallQuality === 'Unsatisfactory';
  const reviewed = !invalid && evaluation.reviewState === 'reviewed' && Boolean(evaluation.currentReview);
  const finalClassKeys = evaluation.currentReview?.finalClassKeys ?? [];
  const disposition: EvaluationDisposition = invalid
    ? 'invalid_unusable'
    : !reviewed
      ? (isCompleted(record) ? 'unreviewed' : 'incomplete')
      : finalClassKeys.length > 0 ? 'reviewed_positive' : 'reviewed_negative';

  return {
    schemaVersion: 1,
    modality: 'technical',
    context: contextFrom(record),
    disposition,
    ...eligibility(disposition),
    inferenceLineage: inferenceLineageForEvaluation(aiPrediction?.inferenceLineage),
    ...(record.validityAudit === undefined ? {} : { validityAudit: structuredClone(record.validityAudit) }),
    aiPredictionSnapshot: {
      overallQuality: aiPrediction.overallQuality,
      findings: technicalAiFindings(aiPrediction),
      ...(aiPrediction.consensusMeta === undefined ? {} : { consensusMeta: structuredClone(aiPrediction.consensusMeta) }),
    },
    ...(reviewed ? {
      humanReview: {
        status: 'reviewed' as const,
        version: evaluation.currentReview!.version,
        reviewerId: evaluation.currentReview!.reviewerId,
        reviewedAt: evaluation.currentReview!.reviewedAt,
        finalClassKeys: structuredClone(finalClassKeys),
        ...(evaluation.currentReview!.notes === undefined ? {} : { notes: evaluation.currentReview!.notes }),
      },
    } : {}),
    reviewHistory: evaluation.reviewHistory.map((review: TechnicalReviewVersion) => ({
      version: review.version,
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt,
      finalClassKeys: structuredClone(review.finalClassKeys),
      ...(review.notes === undefined ? {} : { notes: review.notes }),
    })),
  };
}

function exportLesion(
  finding: any,
  origin: 'ai' | 'human',
): PathologyEvaluationLesion {
  return {
    id: finding.id,
    origin,
    classKey: finding.pathologyKey,
    confidence: finding.confidence,
    bbox: structuredClone(finding.bbox),
    ...(finding.polygonPoints === undefined ? {} : { polygonPoints: structuredClone(finding.polygonPoints) }),
    ...(finding.geometryStatus === undefined ? {} : { geometryStatus: finding.geometryStatus }),
    ...(finding.pixelArea === undefined ? {} : { pixelArea: finding.pixelArea }),
  };
}

export function exportPathologyEvaluationRecord(record: PathologyAssessmentLog): PathologyEvaluationRecord {
  const evaluation = readPathologyEvaluation(record as PathologyAssessmentLog & Record<string, any>);
  const invalid = record.sessionStatus === 'FAILED_NON_DENTAL';
  const reviewed = !invalid && evaluation.reviewState === 'reviewed' && Boolean(evaluation.currentReview);
  const incomplete = !reviewed && !isCompleted(record);
  const finalFindings = evaluation.currentReview?.finalFindings ?? [];
  const disposition: EvaluationDisposition = invalid
    ? 'invalid_unusable'
    : incomplete
      ? 'incomplete'
      : !reviewed
        ? 'unreviewed'
        : finalFindings.length > 0 ? 'reviewed_positive' : 'reviewed_negative';
  const aiIds = new Set(evaluation.aiPredictionSnapshot.map((finding) => finding.id));

  return {
    schemaVersion: 1,
    modality: 'pathology',
    context: contextFrom(record),
    disposition,
    ...eligibility(disposition),
    inferenceLineage: inferenceLineageForEvaluation(record.inferenceLineage),
    ...(record.validityAudit === undefined ? {} : { validityAudit: structuredClone(record.validityAudit) }),
    aiPredictionSnapshot: {
      lesions: evaluation.aiPredictionSnapshot.map((finding) => exportLesion(finding, 'ai')),
    },
    ...(reviewed && evaluation.currentReview ? {
      humanReview: {
        status: 'reviewed' as const,
        version: evaluation.currentReview.version,
        reviewerId: evaluation.currentReview.reviewerId,
        reviewedAt: evaluation.currentReview.reviewedAt,
        finalFindings: evaluation.currentReview.finalFindings.map((finding: ConfirmedPathology) =>
          exportLesion(finding, finding.origin ?? (aiIds.has(finding.id) ? 'ai' : 'human')),
        ),
      },
    } : {}),
    localizationEvaluation: {
      status: 'deferred',
      reason: 'No lesion matching or IoU policy is currently defined.',
    },
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function summarizeMetric(classKey: string, counts: Omit<ClassPresenceMetric, 'classKey' | 'agreement' | 'disagreement' | 'sensitivity' | 'specificity' | 'precision' | 'recall'>): ClassPresenceMetric {
  const { truePositive, falsePositive, falseNegative, trueNegative } = counts;
  return {
    classKey,
    ...counts,
    agreement: truePositive + trueNegative,
    disagreement: falsePositive + falseNegative,
    sensitivity: ratio(truePositive, truePositive + falseNegative),
    specificity: ratio(trueNegative, trueNegative + falsePositive),
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
  };
}

function computePresenceMetrics(
  records: Array<TechnicalEvaluationRecord | PathologyEvaluationRecord>,
  classKeys: string[],
): PresenceMetricSummary {
  const eligible = records.filter((record) => record.supervisedMetricsEligible && record.humanReview);
  const perClass = classKeys.map((classKey) => {
    const counts = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
    for (const record of eligible) {
      const aiClasses = new Set(record.modality === 'technical'
        ? record.aiPredictionSnapshot.findings.map((finding) => finding.classKey)
        : record.aiPredictionSnapshot.lesions.map((finding) => finding.classKey));
      const truthClasses = new Set(record.modality === 'technical'
        ? record.humanReview!.finalClassKeys
        : record.humanReview!.finalFindings.map((finding) => finding.classKey));
      const aiPositive = aiClasses.has(classKey);
      const truthPositive = truthClasses.has(classKey);
      if (aiPositive && truthPositive) counts.truePositive++;
      else if (aiPositive) counts.falsePositive++;
      else if (truthPositive) counts.falseNegative++;
      else counts.trueNegative++;
    }
    return summarizeMetric(classKey, counts);
  });
  const summed = perClass.reduce((total, metric) => ({
    truePositive: total.truePositive + metric.truePositive,
    falsePositive: total.falsePositive + metric.falsePositive,
    falseNegative: total.falseNegative + metric.falseNegative,
    trueNegative: total.trueNegative + metric.trueNegative,
  }), { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 });

  return {
    eligibleCases: eligible.length,
    excludedCases: records.length - eligible.length,
    perClass,
    totals: (({ classKey: _classKey, ...summary }) => summary)(summarizeMetric('all', summed)),
  };
}

export function computeTechnicalPresenceMetrics(records: TechnicalEvaluationRecord[]): PresenceMetricSummary {
  return computePresenceMetrics(records, TECHNICAL_EVALUATION_CLASS_KEYS);
}

export function computePathologyPresenceMetrics(records: PathologyEvaluationRecord[]): PresenceMetricSummary {
  return computePresenceMetrics(records, PATHOLOGY_EVALUATION_CLASS_KEYS);
}

/** Stable JSON independent of object insertion order; undefined object fields follow JSON.stringify omission semantics. */
function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : canonicalSerialize(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`).join(',')}}`;
}

/** Synchronous SHA-256 keeps export generation browser-safe while avoiding secret material. */
function sha256(value: string): string {
  const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotate = (word: number, count: number) => (word >>> count) | (word << (32 - count));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function createEvaluationExportBundle(input: {
  technical?: AssessmentLogPayload[];
  pathology?: PathologyAssessmentLog[];
  exportedAt?: string;
  exportId?: string;
  scope?: { modality: 'technical' | 'pathology' | 'combined'; filters?: Record<string, string | boolean | undefined>; isPartial?: boolean };
}): EvaluationExportBundle {
  const technical = (input.technical ?? []).map(exportTechnicalEvaluationRecord);
  const pathology = (input.pathology ?? []).map(exportPathologyEvaluationRecord);
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const canonicalContentHash = sha256(canonicalSerialize({ technical, pathology }));
  const scope = input.scope ?? {
    modality: technical.length && pathology.length ? 'combined' : pathology.length ? 'pathology' : 'technical',
    filters: {},
    isPartial: false,
  };
  return {
    schemaVersion: 1,
    exportedAt,
    manifest: {
      exportId: input.exportId ?? `evaluation_${exportedAt.replace(/[^0-9]/g, '').slice(0, 14)}_${canonicalContentHash}`,
      totalExportedRecordCount: technical.length + pathology.length,
      scope: { ...scope, filters: scope.filters ?? {}, isPartial: scope.isPartial ?? false },
      canonicalContentHash: { algorithm: 'sha-256', value: canonicalContentHash },
    },
    technical,
    pathology,
    metricPolicy: {
      unit: 'per-assessment-class-presence',
      unreviewedCases: 'excluded',
      confidenceMeaning: 'AI confidence score; not a calibrated probability',
      lesionMatching: 'deferred',
    },
  };
}
