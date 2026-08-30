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
  quadrant: 1 | 2 | 3 | 4;
  type: DentalToothType;
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

export interface AIDetectedError {
  errorKey: string;
  errorName: string;
  confidence: number; // 0 - 100
  clinicalObservation: string;
  provenance?: 'matched_consensus' | 'model_a_only' | 'model_b_only' | 'single_mode';
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

export interface AIDetection {
  id: string;
  pathologyKey: PathologyKey;
  domainId: PathologyDomainId;
  confidence: number; // 0-100
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in pixels relative to canvas
  polygonPoints?: [number, number][]; // pixel coords for smooth boundary contour
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
  detectedPathologies?: AIDetection[];
  confirmedPathologies?: ConfirmedPathology[];
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
    uniqueUsersCount: number;
    todayUsersCount: number;
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
    uniqueUsersCount: number;
    todayUsersCount: number;
    userList?: Array<{
      deviceId: string;
      totalUploads: number;
      lastActive: string;
      firstActive: string;
    }>;
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
  lastRecalculatedAt: string;
  lastUpdatedAt?: any;
}

export type SystemMetadata = SystemMetrics;

export interface DateRangeFilter {
  preset: 'all' | 'today' | '7days' | '30days' | 'custom';
  startDate?: string;
  endDate?: string;
}


