/**
 * Clinical Dental Periapical Radiography Taxonomy & Assessment Types
 */

export type TechniqueType = 'Paralleling' | 'Bisecting Angle';
export type ReceptorType = 'Analogue/Phosphor Plate' | 'Digital Sensor';

export type Language = 'VI' | 'EN';

export type DentalArch = 'Maxilla' | 'Mandible';
export type DentalToothType = 'Incisor' | 'Canine' | 'Premolar' | 'Molar';


export interface ToothInfo {
  fdiNumber: string; // e.g. "11", "46"
  universalNumber: string; // e.g. "#8", "#30"
  name: string; // e.g. "Upper Right Central Incisor"
  arch: DentalArch;
  quadrant: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | number;
  type: DentalToothType;
  nameVi?: string;
  nameEn?: string;
}

export type ErrorDomainId = 'domain_1' | 'domain_2' | 'domain_3';

export interface TaxonomyErrorItem {
  key: string;
  domainId: ErrorDomainId;
  label: string;
  description: string;
  remediation: string;
}

export interface BilingualTaxonomyErrorItem extends TaxonomyErrorItem {
  labelEn?: string;
  descriptionEn?: string;
  remediationEn?: string;
}

export type TechnicalFindingProvenance =
  | 'matched_consensus'
  | 'model_a_only'
  | 'model_b_only'
  | 'single_mode';

export type InferenceModality = 'technical' | 'pathology';
export type InferenceExecutionMode = 'single' | 'dual';
export type InferenceKeySource = 'custom_byok' | 'system_primary' | 'system_backup';

export interface InferenceBranchLineage {
  branch: 'single' | 'model_a' | 'model_b';
  requestedModel: string;
  actualModel: string;
  keySource: InferenceKeySource;
}

/**
 * Server-derived description of the exact provider execution which produced
 * an AI result. `attestation` is transport-only and is removed before storage.
 */
export interface InferenceLineage {
  schemaVersion: 1;
  status: 'available';
  lineageId: string;
  modality: InferenceModality;
  workflow: 'technical_quality_assessment' | 'pathology_segmentation';
  provider: 'google_gemini';
  executionMode: InferenceExecutionMode;
  branches: InferenceBranchLineage[];
  consensus: {
    mode: 'none' | 'dual_consensus';
    status: 'not_applicable' | 'consensus_synthesized' | 'partial_fallback';
  };
  promptVersion: string;
  responseSchemaVersion: string;
  analysisConfigVersion: string;
  generatedAt: string;
  attestation?: string;
}

export interface LegacyInferenceLineage {
  schemaVersion: 1;
  status: 'unavailable';
  reason: 'legacy_record';
}

export type EvaluationInferenceLineage = InferenceLineage | LegacyInferenceLineage;

/** Server-generated provenance for a synthesized Technical dual-model result. */
export interface TechnicalConsensusMeta {
  mode?: 'dual_consensus';
  models?: string[];
  status?: 'consensus_synthesized';
}

export interface AIDetectedError {
  errorKey: string;
  errorName: string;
  confidence: number; // 0 - 100: Model-generated confidence or derived consensus score (not a calibrated clinical probability)
  modelAScore?: number;
  modelBScore?: number;
  clinicalObservation: string;
  provenance?: TechnicalFindingProvenance;
}

export interface AIDomainFinding {
  domainId: ErrorDomainId;
  domainName: string; // e.g. "Domain 1: Receptor Placement Errors"
  hasErrors: boolean;
  detectedErrors: AIDetectedError[];
  domainSummary: string;
}

export interface AIAnalysisResult {
  isPeriapicalRadiograph?: boolean;
  overallQuality: 'Diagnostic' | 'Needs Retake' | 'Unsatisfactory';
  findings: AIDomainFinding[];
  observationChain?: string[];
  consensusMeta?: TechnicalConsensusMeta;
  inferenceLineage?: InferenceLineage;
  validityAudit?: ValidityAuditMetadata;
}

/** One immutable human-truth decision for a Technical assessment. */
export interface TechnicalReviewVersion {
  version: number;
  reviewed: true;
  reviewerId: string;
  reviewedAt: string;
  finalClassKeys: string[];
  notes?: string;
}

/** Immutable model output and append-only human-review truth for a Technical assessment. */
export interface TechnicalEvaluationData {
  schemaVersion: 1;
  aiPredictionSnapshot: AIAnalysisResult;
  reviewState: 'unreviewed' | 'reviewed';
  currentReview?: TechnicalReviewVersion;
  reviewHistory: TechnicalReviewVersion[];
}

// ─── R4: Pre-Analysis Image Validity Gate Types ─────────────────────────
export type TargetToothMatchStatus = 'match' | 'mismatch' | 'uncertain' | 'not_assessable';
export type RadiographOrientationStatus = 'plausible' | 'possibly_incorrect' | 'uncertain' | 'not_assessable';

export interface ImageValidityResult {
  isPeriapicalRadiograph: boolean;
  isAssessable: boolean;
  targetToothVisible: boolean;
  targetToothMatch: TargetToothMatchStatus;
  detectedToothCandidates: number[];
  orientation: RadiographOrientationStatus;
  reason?: string;
}

export type ValidityGateState = 'idle' | 'checking' | 'valid' | 'warning' | 'invalid' | 'unavailable' | 'user_confirmed';

export type ValidityGateIssue = 'not_periapical' | 'not_assessable' | 'target_absent' | 'mismatch' | 'uncertain';

export interface ValidityGateDecision {
  state: ValidityGateState;
  issue?: ValidityGateIssue;
}

/** Opaque, short-lived server proof required before an analysis request may run. */
export type ValidityReceipt = string;

/** Safe metadata derived from a verified receipt; it never contains the receipt or a secret. */
export interface ValidityAuditMetadata {
  schemaVersion: 1;
  sourceImageDigest: string;
  validityDecision: 'valid' | 'user_confirmed' | 'prototype_override';
  targetFdi: string;
  technique: TechniqueType;
  receptorType: ReceptorType;
  validatedAt: string;
  enforcementVersion: 'r29-v1';
  attestation?: string;
}

export interface StepCompletionStatus {
  step1?: boolean;
  step2?: boolean;
  step3: boolean;
  step4: boolean;
  step5: boolean;
}

export interface AssessmentLogPayload {
  assessmentId: string;
  userId?: string;
  userRole?: string;
  timestamp: string;
  tooth: ToothInfo;
  technique: TechniqueType;
  receptorType: ReceptorType;
  stage?: string;
  sessionStatus?: 'INCOMPLETE' | 'COMPLETED' | 'FAILED_NON_DENTAL';
  lastCompletedStep?: number;
  stepStatus?: StepCompletionStatus;
  aiAnalysis: AIAnalysisResult;
  validityAudit?: ValidityAuditMetadata;
  technicalEvaluation?: TechnicalEvaluationData;
  userValidation: {
    concurred: boolean;
    overriddenErrors: string[]; // taxonomy keys
    userNotes?: string;
  };
  userNotes?: string;
  finalConfirmedErrors: string[];
  remediationGuidelines?: string[];
  accuracyScore?: string;
  aiDetectedErrorsSummary?: string;
  finalConfirmedErrorsSummary?: string;
  shareConsent?: boolean;
  imageUrl?: string;
  imageStorageKey?: string;
  isAdminVerified?: boolean;
  verifiedErrors?: string[];
  verifiedNotes?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  imageDataUrl?: string;
}

export type BugReportSource = 'USER_SUBMITTED' | 'SYSTEM_AUTO';
export type BugReportSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface BugReport {
  bugId: string;
  timestamp: string;
  description: string;
  path: string;
  status: 'pending' | 'resolved' | 'wontfix';
  createdAt: string;
  source?: BugReportSource;
  severity?: BugReportSeverity;
  errorDetails?: {
    endpoint?: string;
    errorMessage?: string;
    stackTrace?: string;
    statusCode?: number;
  };
}
export type AppEngineMode = 'classic' | 'pathology_segmentation';

export interface AnalysisWorkspaceSnapshot {
  generation: number;
  requestId: string;
  mode: AppEngineMode;
  assessmentId: string;
  toothFdi: string;
  technique: TechniqueType;
  receptor: ReceptorType;
  imageDataUrl: string | null;
}

export type PathologyType = 'periapical_lesion' | 'bone_loss' | 'caries' | 'pulp_anatomy';

// ============================================================
// PATHOLOGY PIPELINE TYPES (Luồng B — YOLOv11m + SAM2 Hybrid)
// ============================================================

export type PathologyDomainId =
  | 'domain_p1'  // Quanh chóp & Nha chu
  | 'domain_p2'  // Sâu răng & Tủy
  | 'domain_p3'; // Phục hình & Cấy ghép

export type PathologyKey =
  | 'periapical_radiolucency'
  | 'alveolar_bone_loss'
  | 'enamel_radiolucency'
  | 'dentin_radiolucency'
  | 'crown_restoration'
  | 'filling_restoration'
  | 'root_canal_filling'
  | 'dental_implant';

export type PathologySeverity = 'info' | 'mild' | 'moderate' | 'severe' | 'urgent';

export type GeometryStatus = 'valid' | 'unavailable' | 'malformed';

export interface AIDetection {
  id: string;
  /** The source of this lesion instance. Legacy records may omit this field. */
  origin?: 'ai' | 'human';
  pathologyKey: PathologyKey;
  domainId: PathologyDomainId;
  confidence: number; // 0-100: Model-generated confidence or derived consensus score (not a calibrated clinical probability)
  modelAScore?: number;
  modelBScore?: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in pixels relative to canvas
  polygonPoints?: [number, number][]; // pixel coords for smooth boundary contour
  geometryStatus?: GeometryStatus;
  pixelArea?: number;
  color: string;
  fillColor: string;
  treatmentRecommendation?: string;
  provenance?: 'matched_consensus' | 'model_a_only' | 'model_b_only' | 'single_mode';
  humanReviewed?: boolean;
}

export interface TreatmentProtocol {
  pathologyKey: PathologyKey;
  severity: PathologySeverity;
  urgency: 'routine' | 'soon' | 'urgent' | 'emergency';
  primaryTreatment: string;
  primaryTreatmentEn: string;
  alternativeTreatment?: string;
  alternativeTreatmentEn?: string;
  followUp: string;
  followUpEn: string;
  referralNeeded?: boolean;
}

export interface PathologyTaxonomyItem {
  key: PathologyKey;
  domainId: PathologyDomainId;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  color: string;
  fillColor: string;
  protocol: TreatmentProtocol;
}

export interface ConfirmedPathology extends AIDetection {
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  geminiVerified: boolean;
  geminiNote?: string;
  isUserEdited: boolean;
}

/** Immutable model output and append-only human-review truth for a pathology assessment. */
export interface PathologyReviewVersion {
  version: number;
  reviewed: true;
  reviewerId: string;
  reviewedAt: string;
  finalFindings: ConfirmedPathology[];
  notes?: string;
}

export interface PathologyEvaluationData {
  schemaVersion: 1;
  aiPredictionSnapshot: AIDetection[];
  reviewState: 'unreviewed' | 'reviewed';
  currentReview?: PathologyReviewVersion;
  reviewHistory: PathologyReviewVersion[];
}

export interface PathologyGeminiVerification {
  confirmedIds: string[];
  rejectedIds: string[];
  additionalNotes: Record<string, string>; // id → clinical note
  overallSummary: string;
  overallSummaryEn: string;
}

export interface PathologyAssessmentLog {
  assessmentId: string;
  timestamp: string;
  tooth: ToothInfo;
  technique: TechniqueType;
  receptorType: ReceptorType;
  aiModel?: string;
  analysisMode?: string;
  inferenceLineage?: InferenceLineage;
  validityAudit?: ValidityAuditMetadata;
  detectedPathologies?: AIDetection[];
  confirmedPathologies?: ConfirmedPathology[];
  pathologyEvaluation?: PathologyEvaluationData;
  geminiVerification?: PathologyGeminiVerification | null;
  treatmentPlan?: Array<{ pathologyKey: PathologyKey; protocol: TreatmentProtocol }>;
  treatmentItems?: Array<{
    id: string;
    key: PathologyKey;
    label: string;
    domainId: PathologyDomainId;
    domainName?: string;
    description?: string;
    treatment: string;
    color: string;
    confidence: number;
  }>;
  userNotes?: string;
  sessionStatus: 'INCOMPLETE' | 'COMPLETED' | 'FAILED_NON_DENTAL';
  lastCompletedStep?: number;
  stage?: string;
  stepStatus?: { step3?: boolean; step4?: boolean; step5?: boolean };
  shareConsent?: boolean;
  imageUrl?: string;
  imageStorageKey?: string;
  firestoreSynced?: boolean;
  finalConfirmedPathologies?: ConfirmedPathology[];
  verifiedBy?: string;
  verifiedAt?: string;
  verifiedNotes?: string;
  isReviewedByAdmin?: boolean;
  createdAt?: string;
  updatedAt?: string;
  imageDataUrl?: string;
}

export interface SystemMetrics {
  reports: {
    totalSessions: number;
    completedCount: number;
    incompleteCount: number;
    invalidImageCount: number;
    accuracyCounts: {
      EXACT_MATCH: number;
      MOSTLY_ACCURATE: number;
      PARTIALLY_ACCURATE: number;
      INACCURATE: number;
    };
    errorDistribution: Record<string, number>;
    uniqueUsersCount?: number;
    todayUsersCount?: number;
    userList?: Array<{
      userId: string;
      totalSessions: number;
      completedSessions: number;
      lastActive: string;
      lastTooth: string;
      rawMs: number;
    }>;
  };
  pathology: {
    totalPathologyLogs: number;
    completedCount: number;
    incompleteCount: number;
    invalidImageCount: number;
    verifiedCount: number;
    unverifiedCount: number;
    pathologyDistribution: Record<string, number>;
    toothDistribution: Record<string, number>;
    uniqueUsersCount?: number;
    todayUsersCount?: number;
    userList?: Array<{
      deviceId: string;
      totalUploads: number;
      lastActive: string;
      firstActive: string;
    }>;
  };
  users?: {
    uniqueUsersCount: number;
    activeUsersCount: number;
  };
  bugs: {
    totalBugs: number;
    severityDistribution: {
      low: number;
      medium: number;
      high: number;
      critical: number;
      info?: number;
    };
    sourceDistribution: {
      USER_SUBMITTED: number;
      SYSTEM_AUTO: number;
    };
    statusDistribution?: {
      OPEN: number;
      IN_PROGRESS: number;
      RESOLVED: number;
      CLOSED: number;
    };
  };
  dailyStats?: Record<string, {
    reports?: {
      totalSessions: number;
      completedCount: number;
      incompleteCount: number;
      invalidImageCount: number;
      accuracyCounts?: {
        EXACT_MATCH: number;
        MOSTLY_ACCURATE: number;
        PARTIALLY_ACCURATE: number;
        INACCURATE: number;
      };
      errorDistribution?: Record<string, number>;
    };
    pathology?: {
      totalPathologyLogs: number;
      completedCount: number;
      incompleteCount: number;
      invalidImageCount: number;
      verifiedCount: number;
      unverifiedCount: number;
      pathologyDistribution?: Record<string, number>;
    };
    bugs?: {
      totalBugs: number;
      severityDistribution?: Record<string, number>;
      sourceDistribution?: {
        USER_SUBMITTED: number;
        SYSTEM_AUTO: number;
      };
      statusDistribution?: Record<string, number>;
    };
  }>;
  lastRecalculatedAt?: string;
  updatedAt?: string;
  schemaVersion?: number;
  lastUpdatedAt?: any;
}

export type SystemMetadata = SystemMetrics;

export interface DateRangeFilter {
  preset: 'all' | 'today' | '7days' | '30days' | 'custom';
  startDate?: string;
  endDate?: string;
}
