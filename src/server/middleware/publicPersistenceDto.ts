import {
  getCanonicalToothByFdi,
  isValidBase64Image,
  isValidReceptor,
  isValidTechnique,
} from './validation';
import { CANONICAL_PATHOLOGY_KEYS } from '../../utils/semanticValidation';
import { appendPathologyReview, createUnreviewedPathologyEvaluation } from '../../utils/pathologyEvaluation';
import { createUnreviewedTechnicalEvaluation } from '../../utils/technicalEvaluation';
import { verifyAttestedInferenceLineage } from '../services/inferenceLineage';
import { verifyAttestedValidityAudit } from '../services/validityAudit';
import type { AIAnalysisResult, InferenceModality } from '../../types/dental';

const MAX_ID_LENGTH = 100;
const MAX_USER_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 2_000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_ARRAY_LENGTH = 100;
const MAX_IMAGE_DATA_URL_LENGTH = 3 * 1024 * 1024;

const ADMIN_AND_SERVER_FIELDS = new Set([
  'userRole',
  'verifiedBy',
  'verifiedAt',
  'verifiedNotes',
  'verifiedErrors',
  'isAdminVerified',
  'isReviewedByAdmin',
  'reviewedBy',
  'reviewHistory',
  'technicalEvaluation',
  'adminReviewedAt',
  'finalConfirmedPathologies',
  'firestoreSynced',
  'lastSyncedAt',
  'syncRetryCount',
  'imageUrl',
  'imageStorageKey',
  'storagePath',
  'storageLocation',
  'wasStored',
  'createdAt',
  'updatedAt',
  'savedAt',
  'collectionVersion',
  'accuracyScore',
  'aiDetectedErrorsSummary',
  'finalConfirmedErrorsSummary',
]);

const SESSION_STATUSES = new Set(['INCOMPLETE', 'COMPLETED', 'FAILED_NON_DENTAL']);
const QUALITY_VALUES = new Set(['Diagnostic', 'Needs Retake', 'Unsatisfactory']);
const TECHNICAL_DOMAINS = new Set(['domain_1', 'domain_2', 'domain_3']);
const PATHOLOGY_DOMAINS = new Set(['domain_p1', 'domain_p2', 'domain_p3']);
const PATHOLOGY_KEYS = new Set<string>(CANONICAL_PATHOLOGY_KEYS);
const PROVENANCE_VALUES = new Set(['matched_consensus', 'model_a_only', 'model_b_only', 'single_mode']);
const GEOMETRY_STATUSES = new Set(['valid', 'unavailable', 'malformed']);
const PATHOLOGY_ORIGINS = new Set(['ai', 'human']);

export class PublicPersistenceValidationError extends Error {
  statusCode = 400;
}

function fail(message: string): never {
  throw new PublicPersistenceValidationError(message);
}

function objectValue(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, any>;
}

function rejectServerOwnedFields(value: Record<string, any>): void {
  for (const field of ADMIN_AND_SERVER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      fail('Payload contains a server-owned or administrator-owned field.');
    }
  }
}

function parseAttestedInferenceLineage(value: unknown, modality: InferenceModality) {
  try {
    return verifyAttestedInferenceLineage(value, modality);
  } catch {
    fail('Inference lineage is not a valid server-issued envelope.');
  }
}

function parseAttestedValidityAudit(value: unknown) {
  try {
    return verifyAttestedValidityAudit(value);
  } catch {
    fail('Validity audit is not a valid server-issued envelope.');
  }
}

function requiredString(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001F\u007F]/.test(normalized)) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value;
}

function finiteNumber(value: unknown, label: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number.`);
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) fail(`${label} is out of range.`);
  return value;
}

function stringArray(value: unknown, label: string, maxItems = MAX_ARRAY_LENGTH): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be a bounded array.`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`, MAX_SHORT_TEXT_LENGTH));
}

function parseAssessmentId(value: unknown): string {
  return requiredString(value, 'assessmentId', MAX_ID_LENGTH);
}

function parseUserId(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value, 'userId', MAX_USER_ID_LENGTH);
}

function parseTooth(value: unknown) {
  const tooth = objectValue(value, 'tooth');
  const canonical = getCanonicalToothByFdi(tooth.fdiNumber);
  if (!canonical) fail('tooth.fdiNumber is invalid.');
  return canonical;
}

function parseTechnique(value: unknown) {
  if (!isValidTechnique(value)) fail('technique is invalid.');
  return value;
}

function parseReceptor(value: unknown) {
  if (!isValidReceptor(value)) fail('receptorType is invalid.');
  return value;
}

function parseSessionStatus(value: unknown) {
  if (typeof value !== 'string' || !SESSION_STATUSES.has(value)) fail('sessionStatus is invalid.');
  return value as 'INCOMPLETE' | 'COMPLETED' | 'FAILED_NON_DENTAL';
}

function parseLastCompletedStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
    fail('lastCompletedStep must be an integer from 0 through 5.');
  }
  return value;
}

function parseStepStatus(value: unknown): { step3: boolean; step4: boolean; step5: boolean } | undefined {
  if (value === undefined) return undefined;
  const status = objectValue(value, 'stepStatus');
  for (const key of ['step3', 'step4', 'step5']) {
    if (typeof status[key] !== 'boolean') fail(`stepStatus.${key} must be a boolean.`);
  }
  return { step3: status.step3, step4: status.step4, step5: status.step5 };
}

function parseConsent(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail('shareConsent must be a boolean.');
  return value;
}

function parseImageDataUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    value.length > MAX_IMAGE_DATA_URL_LENGTH ||
    !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) ||
    !isValidBase64Image(value)
  ) {
    fail('imageDataUrl must be a supported bounded image data URL.');
  }
  return value;
}

function parseTechnicalError(value: unknown, index: number) {
  const error = objectValue(value, `detectedErrors[${index}]`);
  const provenance = optionalString(error.provenance, `detectedErrors[${index}].provenance`, 40);
  if (provenance !== undefined && !PROVENANCE_VALUES.has(provenance)) fail('Technical provenance is invalid.');
  return {
    errorKey: requiredString(error.errorKey, `detectedErrors[${index}].errorKey`, 100),
    errorName: requiredString(error.errorName, `detectedErrors[${index}].errorName`, MAX_SHORT_TEXT_LENGTH),
    confidence: finiteNumber(error.confidence, `detectedErrors[${index}].confidence`, 0, 100),
    ...(error.modelAScore === undefined ? {} : { modelAScore: finiteNumber(error.modelAScore, 'modelAScore', 0, 100) }),
    ...(error.modelBScore === undefined ? {} : { modelBScore: finiteNumber(error.modelBScore, 'modelBScore', 0, 100) }),
    clinicalObservation: requiredString(error.clinicalObservation, `detectedErrors[${index}].clinicalObservation`, MAX_TEXT_LENGTH),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function parseTechnicalConsensusMeta(value: unknown) {
  const metadata = objectValue(value, 'aiAnalysis.consensusMeta');
  const mode = metadata.mode === undefined
    ? undefined
    : requiredString(metadata.mode, 'aiAnalysis.consensusMeta.mode', 40);
  const status = metadata.status === undefined
    ? undefined
    : requiredString(metadata.status, 'aiAnalysis.consensusMeta.status', 80);
  if (mode !== undefined && mode !== 'dual_consensus') fail('Technical consensus mode is invalid.');
  if (status !== undefined && status !== 'consensus_synthesized') fail('Technical consensus status is invalid.');
  const models = metadata.models === undefined
    ? undefined
    : stringArray(metadata.models, 'aiAnalysis.consensusMeta.models', 2);

  // Preserve only the server's established consensus shape. Do not fabricate
  // metadata for single-model records that did not include it.
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(models === undefined ? {} : { models }),
    ...(status === undefined ? {} : { status }),
  };
}

function parseTechnicalAnalysis(value: unknown): AIAnalysisResult {
  const analysis = objectValue(value, 'aiAnalysis');
  if (typeof analysis.overallQuality !== 'string' || !QUALITY_VALUES.has(analysis.overallQuality)) {
    fail('aiAnalysis.overallQuality is invalid.');
  }
  if (!Array.isArray(analysis.findings) || analysis.findings.length > 10) fail('aiAnalysis.findings must be a bounded array.');
  const findings = analysis.findings.map((raw: unknown, findingIndex: number) => {
    const finding = objectValue(raw, `aiAnalysis.findings[${findingIndex}]`);
    if (typeof finding.domainId !== 'string' || !TECHNICAL_DOMAINS.has(finding.domainId)) fail('Technical domain is invalid.');
    if (typeof finding.hasErrors !== 'boolean') fail('Technical hasErrors must be a boolean.');
    if (!Array.isArray(finding.detectedErrors) || finding.detectedErrors.length > 50) fail('detectedErrors must be a bounded array.');
    return {
      domainId: finding.domainId,
      domainName: requiredString(finding.domainName, 'domainName', MAX_SHORT_TEXT_LENGTH),
      hasErrors: finding.hasErrors,
      detectedErrors: finding.detectedErrors.map(parseTechnicalError),
      domainSummary: requiredString(finding.domainSummary, 'domainSummary', MAX_TEXT_LENGTH),
    };
  });
  const observationChain = analysis.observationChain === undefined
    ? undefined
    : stringArray(analysis.observationChain, 'aiAnalysis.observationChain', 50);
  const consensusMeta = analysis.consensusMeta === undefined
    ? undefined
    : parseTechnicalConsensusMeta(analysis.consensusMeta);
  const inferenceLineage = parseAttestedInferenceLineage(analysis.inferenceLineage, 'technical');
  const validityAudit = parseAttestedValidityAudit(analysis.validityAudit);
  return {
    ...(analysis.isPeriapicalRadiograph === undefined
      ? {}
      : { isPeriapicalRadiograph: optionalBoolean(analysis.isPeriapicalRadiograph, 'aiAnalysis.isPeriapicalRadiograph') }),
    overallQuality: analysis.overallQuality as AIAnalysisResult['overallQuality'],
    findings: findings as AIAnalysisResult['findings'],
    ...(observationChain === undefined ? {} : { observationChain }),
    ...(consensusMeta === undefined
      ? {}
      : { consensusMeta: consensusMeta as AIAnalysisResult['consensusMeta'] }),
    ...(inferenceLineage === undefined ? {} : { inferenceLineage }),
    ...(validityAudit === undefined ? {} : { validityAudit }),
  };
}

function parseUserValidation(value: unknown) {
  const validation = objectValue(value, 'userValidation');
  if (typeof validation.concurred !== 'boolean') fail('userValidation.concurred must be a boolean.');
  return {
    concurred: validation.concurred,
    overriddenErrors: stringArray(validation.overriddenErrors, 'userValidation.overriddenErrors', 50),
    ...(validation.userNotes === undefined
      ? {}
      : { userNotes: optionalString(validation.userNotes, 'userValidation.userNotes', MAX_TEXT_LENGTH) }),
  };
}

function parsePathologyDetection(value: unknown, index: number) {
  const detection = objectValue(value, `pathology[${index}]`);
  if (typeof detection.pathologyKey !== 'string' || !PATHOLOGY_KEYS.has(detection.pathologyKey)) {
    fail('Pathology key is outside the canonical 8-class taxonomy.');
  }
  if (typeof detection.domainId !== 'string' || !PATHOLOGY_DOMAINS.has(detection.domainId)) fail('Pathology domain is invalid.');
  if (!Array.isArray(detection.bbox) || detection.bbox.length !== 4) fail('Pathology bbox must contain four coordinates.');

  let polygonPoints: [number, number][] | undefined;
  if (detection.polygonPoints !== undefined) {
    if (!Array.isArray(detection.polygonPoints) || detection.polygonPoints.length > 1_000) fail('polygonPoints is invalid.');
    polygonPoints = detection.polygonPoints.map((point: unknown, pointIndex: number) => {
      if (!Array.isArray(point) || point.length !== 2) fail(`polygonPoints[${pointIndex}] is invalid.`);
      return [finiteNumber(point[0], 'polygon x'), finiteNumber(point[1], 'polygon y')];
    });
  }

  const provenance = optionalString(detection.provenance, 'pathology provenance', 40);
  if (provenance !== undefined && !PROVENANCE_VALUES.has(provenance)) fail('Pathology provenance is invalid.');
  const geometryStatus = optionalString(detection.geometryStatus, 'geometryStatus', 20);
  if (geometryStatus !== undefined && !GEOMETRY_STATUSES.has(geometryStatus)) fail('geometryStatus is invalid.');
  const origin = optionalString(detection.origin, 'pathology origin', 20);
  if (origin !== undefined && !PATHOLOGY_ORIGINS.has(origin)) fail('pathology origin is invalid.');

  return {
    id: requiredString(detection.id, 'pathology id', MAX_USER_ID_LENGTH),
    ...(origin === undefined ? {} : { origin }),
    pathologyKey: detection.pathologyKey,
    domainId: detection.domainId,
    confidence: finiteNumber(detection.confidence, 'pathology confidence', 0, 100),
    ...(detection.modelAScore === undefined ? {} : { modelAScore: finiteNumber(detection.modelAScore, 'modelAScore', 0, 100) }),
    ...(detection.modelBScore === undefined ? {} : { modelBScore: finiteNumber(detection.modelBScore, 'modelBScore', 0, 100) }),
    bbox: detection.bbox.map((coordinate: unknown) => finiteNumber(coordinate, 'bbox coordinate')),
    ...(polygonPoints === undefined ? {} : { polygonPoints }),
    ...(geometryStatus === undefined ? {} : { geometryStatus }),
    ...(detection.pixelArea === undefined ? {} : { pixelArea: finiteNumber(detection.pixelArea, 'pixelArea', 0) }),
    color: requiredString(detection.color, 'pathology color', 100),
    fillColor: requiredString(detection.fillColor, 'pathology fillColor', 100),
    ...(detection.treatmentRecommendation === undefined
      ? {}
      : { treatmentRecommendation: optionalString(detection.treatmentRecommendation, 'treatmentRecommendation', MAX_TEXT_LENGTH) }),
    ...(provenance === undefined ? {} : { provenance }),
    ...(detection.humanReviewed === undefined
      ? {}
      : { humanReviewed: optionalBoolean(detection.humanReviewed, 'humanReviewed') }),
    ...(detection.label === undefined ? {} : { label: optionalString(detection.label, 'pathology label', MAX_SHORT_TEXT_LENGTH) }),
    ...(detection.labelEn === undefined ? {} : { labelEn: optionalString(detection.labelEn, 'pathology labelEn', MAX_SHORT_TEXT_LENGTH) }),
    ...(detection.description === undefined ? {} : { description: optionalString(detection.description, 'pathology description', MAX_TEXT_LENGTH) }),
    ...(detection.descriptionEn === undefined ? {} : { descriptionEn: optionalString(detection.descriptionEn, 'pathology descriptionEn', MAX_TEXT_LENGTH) }),
    ...(detection.geminiVerified === undefined
      ? {}
      : { geminiVerified: optionalBoolean(detection.geminiVerified, 'geminiVerified') }),
    ...(detection.geminiNote === undefined ? {} : { geminiNote: optionalString(detection.geminiNote, 'geminiNote', MAX_TEXT_LENGTH) }),
    ...(detection.isUserEdited === undefined
      ? {}
      : { isUserEdited: optionalBoolean(detection.isUserEdited, 'isUserEdited') }),
  };
}

function parsePathologyArray(value: unknown, label: string): any[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH) fail(`${label} must be a bounded array.`);
  return value.map(parsePathologyDetection);
}

function parsePublicPathologyEvaluation(value: unknown, detectedPathologies: any[]) {
  if (value === undefined) return createUnreviewedPathologyEvaluation(detectedPathologies);
  const evaluation = objectValue(value, 'pathologyEvaluation');
  if (evaluation.reviewState !== 'unreviewed') fail('Public pathology payload cannot submit review truth.');
  if (evaluation.currentReview !== undefined || (Array.isArray(evaluation.reviewHistory) && evaluation.reviewHistory.length > 0)) {
    fail('Public pathology payload cannot submit review history.');
  }
  const snapshot = parsePathologyArray(evaluation.aiPredictionSnapshot, 'pathologyEvaluation.aiPredictionSnapshot');
  return createUnreviewedPathologyEvaluation(snapshot);
}

export interface ParsedPublicTechnicalSave {
  record: Record<string, any>;
  imageDataUrl?: string;
}

export function parsePublicTechnicalSaveDto(body: unknown, serverTimestamp = new Date().toISOString()): ParsedPublicTechnicalSave {
  const envelope = objectValue(body, 'request body');
  const payload = objectValue(envelope.payload, 'payload');
  rejectServerOwnedFields(payload);

  const imageDataUrl = parseImageDataUrl(envelope.imageDataUrl);
  const shareConsent = parseConsent(payload.shareConsent);
  const aiAnalysis = parseTechnicalAnalysis(payload.aiAnalysis);
  const record = {
    assessmentId: parseAssessmentId(payload.assessmentId),
    ...(payload.userId === undefined ? {} : { userId: parseUserId(payload.userId) }),
    timestamp: serverTimestamp,
    tooth: parseTooth(payload.tooth),
    technique: parseTechnique(payload.technique),
    receptorType: parseReceptor(payload.receptorType),
    sessionStatus: parseSessionStatus(payload.sessionStatus),
    lastCompletedStep: parseLastCompletedStep(payload.lastCompletedStep),
    ...(payload.stage === undefined ? {} : { stage: optionalString(payload.stage, 'stage', MAX_SHORT_TEXT_LENGTH) }),
    ...(payload.stepStatus === undefined ? {} : { stepStatus: parseStepStatus(payload.stepStatus) }),
    aiAnalysis,
    ...(aiAnalysis.validityAudit === undefined ? {} : { validityAudit: aiAnalysis.validityAudit }),
    ...(aiAnalysis.inferenceLineage
      ? { technicalEvaluation: createUnreviewedTechnicalEvaluation(aiAnalysis) }
      : {}),
    userValidation: parseUserValidation(payload.userValidation),
    ...(payload.userNotes === undefined ? {} : { userNotes: optionalString(payload.userNotes, 'userNotes', MAX_TEXT_LENGTH) }),
    finalConfirmedErrors: stringArray(payload.finalConfirmedErrors, 'finalConfirmedErrors', 50),
    shareConsent,
  };

  return { record, imageDataUrl: shareConsent ? imageDataUrl : undefined };
}

export interface ParsedPublicPathologySave {
  record: Record<string, any>;
  imageDataUrl?: string;
}

export function parsePublicPathologySaveDto(body: unknown, serverTimestamp = new Date().toISOString()): ParsedPublicPathologySave {
  const payload = objectValue(body, 'request body');
  rejectServerOwnedFields(payload);

  const imageDataUrl = parseImageDataUrl(payload.imageDataUrl);
  const shareConsent = parseConsent(payload.shareConsent);
  const analysisMode = payload.analysisMode === undefined
    ? undefined
    : requiredString(payload.analysisMode, 'analysisMode', 60);
  if (analysisMode !== undefined && analysisMode !== 'pathology_segmentation') fail('analysisMode is invalid.');
  const inferenceLineage = parseAttestedInferenceLineage(payload.inferenceLineage, 'pathology');
  const validityAudit = parseAttestedValidityAudit(payload.validityAudit);

  const detectedPathologies = parsePathologyArray(payload.detectedPathologies, 'detectedPathologies');
  const userId = payload.userId === undefined ? undefined : parseUserId(payload.userId);
  const sessionStatus = parseSessionStatus(payload.sessionStatus);
  const lastCompletedStep = parseLastCompletedStep(payload.lastCompletedStep);
  const confirmedPathologies = parsePathologyArray(payload.confirmedPathologies, 'confirmedPathologies');
  const unreviewedEvaluation = parsePublicPathologyEvaluation(payload.pathologyEvaluation, detectedPathologies);
  // The public client may submit its lesion selections, but it never writes a
  // review history. A completed session becomes exactly one server-derived
  // clinician review; an empty selection is therefore an explicit negative.
  const pathologyEvaluation = sessionStatus === 'COMPLETED' && lastCompletedStep >= 5
    ? appendPathologyReview(unreviewedEvaluation, {
      reviewerId: userId ?? 'clinician-unidentified',
      reviewedAt: serverTimestamp,
      finalFindings: confirmedPathologies,
    })
    : unreviewedEvaluation;
  const record = {
    assessmentId: parseAssessmentId(payload.assessmentId),
    ...(userId === undefined ? {} : { userId }),
    timestamp: serverTimestamp,
    tooth: parseTooth(payload.tooth),
    technique: parseTechnique(payload.technique),
    receptorType: parseReceptor(payload.receptorType),
    ...(payload.aiModel === undefined ? {} : { aiModel: optionalString(payload.aiModel, 'aiModel', 100) }),
    ...(analysisMode === undefined ? {} : { analysisMode }),
    ...(inferenceLineage === undefined ? {} : { inferenceLineage }),
    ...(validityAudit === undefined ? {} : { validityAudit }),
    sessionStatus,
    lastCompletedStep,
    ...(payload.stage === undefined ? {} : { stage: optionalString(payload.stage, 'stage', MAX_SHORT_TEXT_LENGTH) }),
    ...(payload.stepStatus === undefined ? {} : { stepStatus: parseStepStatus(payload.stepStatus) }),
    detectedPathologies,
    confirmedPathologies,
    pathologyEvaluation,
    ...(payload.userNotes === undefined ? {} : { userNotes: optionalString(payload.userNotes, 'userNotes', MAX_TEXT_LENGTH) }),
    shareConsent,
  };

  return { record, imageDataUrl: shareConsent ? imageDataUrl : undefined };
}
