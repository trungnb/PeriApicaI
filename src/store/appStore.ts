import { create } from 'zustand';
import {
  TechniqueType,
  ReceptorType,
  ToothInfo,
  AIAnalysisResult,
  AssessmentLogPayload,
  Language,
  AppEngineMode,
  AIDetection,
  ConfirmedPathology,
  PathologyGeminiVerification,
  PathologyKey,
  AnalysisWorkspaceSnapshot,
  ImageValidityResult,
  ValidityGateState,
  ValidityReceipt,
  ValidityAuditMetadata,
  InferenceLineage,
} from '../types/dental';
import { ALL_TEETH } from '../data/taxonomyData';
import { PATHOLOGY_DICT } from '../constants/dictionaries';
import { CompressionResult } from '../utils/imageCompressor';
import { purgeLegacyApiKeyStorage } from '../utils/apiKeySecurity';
import i18next, { getInitialLanguage } from '../i18n';

// R5 Mandate: Purge any legacy persistent personal API keys immediately on load
purgeLegacyApiKeyStorage();

const getStoreInitialLanguage = (): Language => (getInitialLanguage() === 'en' ? 'EN' : 'VI');

export interface AppState {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  language: Language;
  currentStep: number;
  currentAssessmentId: string;
  selectedTechnique: TechniqueType;
  selectedReceptor: ReceptorType;
  selectedTooth: ToothInfo;
  imageDataUrl: string | null;
  imageFile: File | null;
  isAnalyzing: boolean;
  analyzingStatusMessage: string | null;
  analysisResult: AIAnalysisResult | null;
  lastAnalyzedRequestHash: string | null;
  isFallbackAnalysis: boolean;
  confirmedErrorKeys: string[];
  logs: AssessmentLogPayload[];
  isAdminModalOpen: boolean;
  isBugModalOpen: boolean;
  isCertModalOpen: boolean;
  globalError: string | null;
  systemNoticeModal: { isOpen: boolean; title?: string; message: string; type?: 'warning' | 'info' } | null;
  customKeyErrorModal: {
    isOpen: boolean;
    message: string;
    reasonCategory?: 'invalid_key' | 'quota_or_rate_limit' | 'provider_unavailable' | 'network_or_timeout' | 'unknown_custom_key_failure';
    systemApiAvailable?: boolean;
  } | null;
  isQuotaExhausted: boolean;
  quotaResetNotice: string | null;
  shareConsent: boolean;
  userConcurred: boolean | null;
  selectedOverrideKeys: string[];
  userNotes: string;
  compressedImageBase64: string | null;
  lastCompressionMetrics: CompressionResult | null;
  setLastCompressionMetrics: (metrics: CompressionResult | null) => void;
  lastAnalysisMetrics: {
    clientCompressTimeMs: number;
    networkTimeMs: number;
    geminiTimeMs: number;
    totalTimeMs: number;
    wasCached: boolean;
    pipeline: 'classic' | 'pathology';
    modelUsed?: string;
  } | null;
  setLastAnalysisMetrics: (metrics: {
    clientCompressTimeMs: number;
    networkTimeMs: number;
    geminiTimeMs: number;
    totalTimeMs: number;
    wasCached: boolean;
    pipeline: 'classic' | 'pathology';
    modelUsed?: string;
  } | null) => void;
  apiKeyOption: 'system' | 'custom';
  customApiKey: string;
  rememberCustomApiKey: boolean;
  systemApiAvailable: boolean;
  analysisMode: 'single' | 'consensus';
  availableModels: Array<{ id: string; displayName: string }>;
  selectedModelA: string;
  selectedModelB: string;
  isLoadingModels: boolean;
  appEngineMode: AppEngineMode;

  // ─── Request Identity & Generation Guard (R2) ──────────────
  analysisGeneration: number;
  activeAnalysisId: string | null;
  startAnalysisRequest: (mode: AppEngineMode) => AnalysisWorkspaceSnapshot;
  isAnalysisCurrent: (snapshot: AnalysisWorkspaceSnapshot | null | undefined) => boolean;
  invalidateActiveAnalysis: () => void;

  // ─── Pathology Pipeline State (Luồng B) ─────────────────────
  aiDetections: AIDetection[];
  confirmedPathologies: ConfirmedPathology[];
  pathologyGeminiResult: PathologyGeminiVerification | null;
  pathologyInferenceLineage: InferenceLineage | null;
  pathologyValidityAudit: ValidityAuditMetadata | null;
  hiddenDetectionIds: Set<string>;
  pathologyAnalysisStatus: 'idle' | 'analyzing' | 'complete' | 'error';
  pathologyStatusMessage: string | null;

  // Primitive State Setters
  setAppEngineMode: (mode: AppEngineMode) => void;
  setLanguage: (lang: Language) => void;
  setAnalysisMode: (mode: 'single' | 'consensus') => void;
  setAvailableModels: (models: Array<{ id: string; displayName: string }>) => void;
  setSelectedModelA: (model: string) => void;
  setSelectedModelB: (model: string) => void;
  setIsLoadingModels: (loading: boolean) => void;
  toggleLanguage: () => void;
  setCurrentStep: (step: number) => void;
  setCurrentAssessmentId: (id: string) => void;
  setSelectedTechnique: (technique: TechniqueType) => void;
  setSelectedReceptor: (receptor: ReceptorType) => void;
  setSelectedTooth: (tooth: ToothInfo) => void;
  setImageDataUrl: (url: string | null, file?: File | null) => void;
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  setAnalyzingStatusMessage: (msg: string | null) => void;
  setAnalysisResult: (result: AIAnalysisResult | null) => void;
  setGlobalError: (msg: string | null) => void;
  setSystemNoticeModal: (modal: { isOpen: boolean; title?: string; message: string; type?: 'warning' | 'info' } | null) => void;
  setCustomKeyErrorModal: (modal: {
    isOpen: boolean;
    message: string;
    reasonCategory?: 'invalid_key' | 'quota_or_rate_limit' | 'provider_unavailable' | 'network_or_timeout' | 'unknown_custom_key_failure';
    systemApiAvailable?: boolean;
  } | null) => void;
  setSystemApiAvailable: (available: boolean) => void;
  setApiKeyOption: (option: 'system' | 'custom') => void;
  setCustomApiKey: (key: string) => void;
  clearCustomApiKey: () => void;
  setRememberCustomApiKey: (remember: boolean) => void;
  setIsFallbackAnalysis: (isFallback: boolean) => void;
  setConfirmedErrorKeys: (keys: string[]) => void;
  setShareConsent: (consent: boolean) => void;
  addLog: (log: AssessmentLogPayload) => void;
  clearLogs: () => void;
  setIsAdminModalOpen: (isOpen: boolean) => void;
  setIsBugModalOpen: (isOpen: boolean) => void;
  setIsCertModalOpen: (isOpen: boolean) => void;
  setQuotaExhausted: (isExhausted: boolean, notice?: string | null) => void;
  setUserConcurred: (concurred: boolean | null) => void;
  setSelectedOverrideKeys: (keys: string[]) => void;
  setUserNotes: (notes: string) => void;
  startNewSession: () => void;

  // ─── Pathology Pipeline Actions ──────────────────────────────
  setAiDetections: (detections: AIDetection[]) => void;
  setConfirmedPathologies: (pathologies: ConfirmedPathology[]) => void;
  updateDetectionBbox: (id: string, bbox: [number, number, number, number]) => void;
  updateDetectionPolygon: (id: string, polygonPoints: [number, number][]) => void;
  updateDetectionKey: (id: string, newKey: PathologyKey) => void;
  toggleDetectionVisibility: (id: string) => void;
  setPathologyGeminiResult: (result: PathologyGeminiVerification | null) => void;
  setPathologyInferenceLineage: (lineage: InferenceLineage | null) => void;
  setPathologyValidityAudit: (audit: ValidityAuditMetadata | null) => void;
  setPathologyAnalysisStatus: (status: 'idle' | 'analyzing' | 'complete' | 'error') => void;
  setPathologyStatusMessage: (msg: string | null) => void;
  resetPathologyState: () => void;

  // ─── R4: Pre-Analysis Image Validity Gate State ────────────
  validityGateState: ValidityGateState;
  validityResult: ImageValidityResult | null;
  validityReceipt: ValidityReceipt | null;
  validityConfirmationToken: string | null;
  validityConfirmedSnapshot: AnalysisWorkspaceSnapshot | null;
  validityModal: {
    isOpen: boolean;
    type: 'invalid' | 'warning' | 'unavailable';
    issue?: 'not_periapical' | 'not_assessable' | 'target_absent' | 'mismatch' | 'uncertain';
    result?: ImageValidityResult | null;
    message?: string;
    onConfirm?: () => void;
    onRetry?: () => void;
    onCancel?: () => void;
  } | null;
  setValidityGateState: (state: ValidityGateState) => void;
  setValidityResult: (result: ImageValidityResult | null) => void;
  setValidityReceipt: (receipt: ValidityReceipt | null, confirmationToken?: string | null) => void;
  setValidityModal: (modal: AppState['validityModal']) => void;
  confirmValidityForCurrentSnapshot: (snapshot: AnalysisWorkspaceSnapshot, receipt?: ValidityReceipt) => void;
  resetValidityState: () => void;
}

const getInitialApiKeyOption = (): 'system' | 'custom' => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('periapical_api_key_option');
    if (saved === 'system' || saved === 'custom') return saved;
  }
  return 'system';
};

export const generateSessionId = (mode: AppEngineMode = 'classic'): string => {
  const prefix = mode === 'pathology_segmentation' ? 'pathology-session' : 'classic-session';
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
};


const getInitialTheme = (): 'dark' | 'light' => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('periapical_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    const legacy = localStorage.getItem('periapical_dark_mode');
    if (legacy !== null) return legacy === 'true' ? 'dark' : 'light';
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  }
  return 'dark';
};

export const useAppStore = create<AppState>((set, get) => ({
  language: getStoreInitialLanguage(),
  theme: getInitialTheme(),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('periapical_theme', theme);
      } catch {
        // Ignore storage errors in restricted contexts
      }
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
    set({ theme });
  },

  apiKeyOption: getInitialApiKeyOption(),
  customApiKey: '',
  rememberCustomApiKey: false,
  systemApiAvailable: true,
  analysisMode: 'single',
  availableModels: [],
  selectedModelA: '',
  selectedModelB: '',
  isLoadingModels: false,
  appEngineMode: 'classic',
  currentStep: 1,
  currentAssessmentId: generateSessionId('classic'),
  selectedTechnique: 'Paralleling',
  selectedReceptor: 'Digital Sensor',
  selectedTooth: ALL_TEETH[7], // R11 default
  imageDataUrl: null,
  imageFile: null,
  isAnalyzing: false,
  analyzingStatusMessage: null,
  analysisResult: null,
  lastAnalyzedRequestHash: null,
  isFallbackAnalysis: false,
  confirmedErrorKeys: [],
  logs: [],
  isAdminModalOpen: false,
  isBugModalOpen: false,
  isCertModalOpen: false,
  globalError: null,
  systemNoticeModal: null,
  customKeyErrorModal: null,
  isQuotaExhausted: false,
  quotaResetNotice: null,
  shareConsent: false,
  userConcurred: null,
  selectedOverrideKeys: [],
  userNotes: '',
  compressedImageBase64: null,
  lastCompressionMetrics: null,
  lastAnalysisMetrics: null,

  // ─── Request Identity & Generation Guard (R2) ──────────────
  analysisGeneration: 0,
  activeAnalysisId: null,

  // ─── R4: Pre-Analysis Image Validity Gate Initial State ─────
  validityGateState: 'idle',
  validityResult: null,
  validityReceipt: null,
  validityConfirmationToken: null,
  validityConfirmedSnapshot: null,
  validityModal: null,

  setValidityGateState: (state) => set({ validityGateState: state }),
  setValidityResult: (result) => set({ validityResult: result }),
  setValidityReceipt: (receipt, confirmationToken = null) => set({ validityReceipt: receipt, validityConfirmationToken: confirmationToken }),
  setValidityModal: (modal) => set({ validityModal: modal }),
  confirmValidityForCurrentSnapshot: (snapshot, receipt) => set((state) => ({
    validityGateState: 'user_confirmed',
    validityConfirmedSnapshot: snapshot,
    validityReceipt: receipt ?? state.validityReceipt,
    validityConfirmationToken: null,
  })),
  resetValidityState: () => set({
    validityGateState: 'idle',
    validityResult: null,
    validityReceipt: null,
    validityConfirmationToken: null,
    validityConfirmedSnapshot: null,
    validityModal: null,
  }),

  // ─── Pathology Pipeline Initial State ─────────────────────────────
  aiDetections: [],
  confirmedPathologies: [],
  pathologyGeminiResult: null,
  pathologyInferenceLineage: null,
  pathologyValidityAudit: null,
  hiddenDetectionIds: new Set<string>(),
  pathologyAnalysisStatus: 'idle',
  pathologyStatusMessage: null,

  setAppEngineMode: (mode) => set((state) => {
    if (state.appEngineMode === mode) return {};
    // When changing flow at Welcome/Setup stage, immediately assign flow-specific Session ID
    const newId = state.currentStep <= 2 ? generateSessionId(mode) : state.currentAssessmentId;
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      appEngineMode: mode,
      currentAssessmentId: newId,
      
      // Reset Pathology state
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      
      // Reset Validity Gate
      validityGateState: 'idle',
      validityResult: null,
      validityReceipt: null,
      validityConfirmationToken: null,
      validityConfirmedSnapshot: null,
      validityModal: null,

      // Reset Classic state
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      userConcurred: null,
      selectedOverrideKeys: [],
      userNotes: '',
      isAnalyzing: false,
      analyzingStatusMessage: null,
    };
  }),
  setAnalysisMode: (mode) => set({ analysisMode: mode }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setSelectedModelA: (model) => set({ selectedModelA: model }),
  setSelectedModelB: (model) => set({ selectedModelB: model }),
  setIsLoadingModels: (loading) => set({ isLoadingModels: loading }),

  setLanguage: (lang) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('periapical_language', lang);
      } catch {
        // Ignore storage errors in restricted contexts
      }
    }
    i18next.changeLanguage(lang.toLowerCase());
    set({ language: lang });
  },

  toggleLanguage: () => {
    const nextLang = get().language === 'VI' ? 'EN' : 'VI';
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('periapical_language', nextLang);
      } catch {
        // Ignore storage errors in restricted contexts
      }
    }
    i18next.changeLanguage(nextLang.toLowerCase());
    set({ language: nextLang });
  },

  setCurrentStep: (step) => set((state) => {
    if (state.currentStep === step) return {};
    const shouldInvalidate = state.isAnalyzing && step < state.currentStep;
    return {
      currentStep: step,
      ...(shouldInvalidate ? {
        analysisGeneration: state.analysisGeneration + 1,
        activeAnalysisId: null,
        isAnalyzing: false,
        analyzingStatusMessage: null,
        pathologyAnalysisStatus: 'idle',
        pathologyStatusMessage: null,
      } : {}),
    };
  }),
  setCurrentAssessmentId: (id) => set({
    currentAssessmentId: id,
    validityReceipt: null,
    validityConfirmationToken: null,
    validityConfirmedSnapshot: null,
    validityGateState: 'idle',
  }),
  setSelectedTechnique: (technique) => set((state) => {
    if (state.selectedTechnique === technique) return {};
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      selectedTechnique: technique,
      validityReceipt: null,
      validityConfirmationToken: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      isAnalyzing: false,
      analyzingStatusMessage: null,
    };
  }),
  setSelectedReceptor: (receptor) => set((state) => {
    if (state.selectedReceptor === receptor) return {};
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      selectedReceptor: receptor,
      validityReceipt: null,
      validityConfirmationToken: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      isAnalyzing: false,
      analyzingStatusMessage: null,
    };
  }),
  setSelectedTooth: (tooth) => set((state) => {
    if (state.selectedTooth.fdiNumber === tooth.fdiNumber) return {};
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      selectedTooth: tooth,
      validityGateState: 'idle',
      validityResult: null,
      validityReceipt: null,
      validityConfirmationToken: null,
      validityConfirmedSnapshot: null,
      validityModal: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      isAnalyzing: false,
      analyzingStatusMessage: null,
    };
  }),
  setImageDataUrl: (url, file?: File | null) => set((state) => {
    if (state.imageDataUrl === url && state.imageFile === (file || null)) return {};
    if (state.imageDataUrl && state.imageDataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.imageDataUrl);
    }
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      imageDataUrl: url,
      imageFile: file || null,
      compressedImageBase64: null,
      lastCompressionMetrics: null,
      lastAnalysisMetrics: null,
      validityGateState: 'idle',
      validityResult: null,
      validityReceipt: null,
      validityConfirmationToken: null,
      validityConfirmedSnapshot: null,
      validityModal: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      userConcurred: null,
      selectedOverrideKeys: [],
      // Stale Pathology State Reset when changing/uploading image
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      isAnalyzing: false,
      analyzingStatusMessage: null,
    };
  }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setLastCompressionMetrics: (metrics) => set({ lastCompressionMetrics: metrics }),
  setLastAnalysisMetrics: (metrics) => set({ lastAnalysisMetrics: metrics }),
  setAnalyzingStatusMessage: (msg) => set({ analyzingStatusMessage: msg }),
  setAnalysisResult: (result) => set({ analysisResult: result }),
  setGlobalError: (msg) => set({ globalError: msg }),
  setSystemNoticeModal: (modal) => set({ systemNoticeModal: modal }),
  setCustomKeyErrorModal: (modal) => set({ customKeyErrorModal: modal }),
  setSystemApiAvailable: (available) => set({ systemApiAvailable: available }),
  setApiKeyOption: (option) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('periapical_api_key_option', option);
    }
    // Mode switch: Active mode is updated. In-memory custom key is retained in volatile memory for later switch-back.
    set({ apiKeyOption: option });
  },
  setCustomApiKey: (key) => {
    // Volatile memory-only update. NEVER write to persistent storage.
    set({ customApiKey: key });
  },
  clearCustomApiKey: () => {
    // Explicit user action: clears volatile custom key from memory
    set({ customApiKey: '' });
  },
  setRememberCustomApiKey: (_remember) => {
    // R5 Mandate: Persistent storage of personal keys is deprecated and permanently disabled.
    set({ rememberCustomApiKey: false });
  },
  setIsFallbackAnalysis: (isFallback) => set({ isFallbackAnalysis: isFallback }),
  setConfirmedErrorKeys: (keys) => set({ confirmedErrorKeys: keys }),
  setShareConsent: (consent) => set({ shareConsent: consent }),
  addLog: (log) => set((state) => {
    const idx = state.logs.findIndex((l) => l.assessmentId === log.assessmentId);
    if (idx >= 0) {
      const updated = [...state.logs];
      updated[idx] = log;
      return { logs: updated };
    }
    return { logs: [log, ...state.logs] };
  }),
  clearLogs: () => set({ logs: [] }),
  setIsAdminModalOpen: (isOpen) => set({ isAdminModalOpen: isOpen }),
  setIsBugModalOpen: (isOpen) => set({ isBugModalOpen: isOpen }),
  setIsCertModalOpen: (isOpen) => set({ isCertModalOpen: isOpen }),
  setQuotaExhausted: (isExhausted, notice) => set({
    isQuotaExhausted: isExhausted,
    quotaResetNotice: notice || (isExhausted ? '1 phút (Giả lập thử nghiệm)' : null),
  }),
  setUserConcurred: (concurred) => set({ userConcurred: concurred }),
  setSelectedOverrideKeys: (keys) => set({ selectedOverrideKeys: keys }),
  setUserNotes: (notes) => set({ userNotes: notes }),

  startNewSession: () => set((state) => {
    if (state.imageDataUrl && state.imageDataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.imageDataUrl);
    }
    return {
      analysisGeneration: state.analysisGeneration + 1,
      activeAnalysisId: null,
      currentAssessmentId: generateSessionId(state.appEngineMode),
      imageDataUrl: null,
      imageFile: null,
      compressedImageBase64: null,
      lastCompressionMetrics: null,
      lastAnalysisMetrics: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      validityGateState: 'idle',
      validityResult: null,
      validityReceipt: null,
      validityConfirmationToken: null,
      validityConfirmedSnapshot: null,
      validityModal: null,
      currentStep: 1,
      shareConsent: false,
      apiKeyOption: 'system',
      customApiKey: '',
      selectedTechnique: 'Paralleling',
      selectedReceptor: 'Digital Sensor',
      selectedTooth: ALL_TEETH[7], // R11 default
      globalError: null,
      isAnalyzing: false,
      analyzingStatusMessage: null,
      userConcurred: null,
      selectedOverrideKeys: [],
      userNotes: '',
      // Reset pathology state too
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      pathologyInferenceLineage: null,
      pathologyValidityAudit: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
    };
  }),

  // ─── Request Identity & Generation Guard (R2) ──────────────
  startAnalysisRequest: (mode) => {
    const nextGen = get().analysisGeneration + 1;
    const reqId = `${mode}-${Date.now()}-${nextGen}`;
    set({
      analysisGeneration: nextGen,
      activeAnalysisId: reqId,
      isAnalyzing: true,
    });
    return {
      generation: nextGen,
      requestId: reqId,
      mode: get().appEngineMode,
      assessmentId: get().currentAssessmentId,
      toothFdi: get().selectedTooth.fdiNumber,
      technique: get().selectedTechnique,
      receptor: get().selectedReceptor,
      imageDataUrl: get().imageDataUrl,
    };
  },

  isAnalysisCurrent: (snapshot) => {
    if (!snapshot) return false;
    const state = get();
    if (state.analysisGeneration !== snapshot.generation) return false;
    if (state.activeAnalysisId !== snapshot.requestId) return false;
    if (state.currentAssessmentId !== snapshot.assessmentId) return false;
    if (state.appEngineMode !== snapshot.mode) return false;
    if (state.imageDataUrl !== snapshot.imageDataUrl) return false;
    if (state.selectedTooth.fdiNumber !== snapshot.toothFdi) return false;
    if (snapshot.mode === 'classic') {
      if (state.selectedTechnique !== snapshot.technique) return false;
      if (state.selectedReceptor !== snapshot.receptor) return false;
    }
    return true;
  },

  invalidateActiveAnalysis: () => {
    const nextGen = get().analysisGeneration + 1;
    const wasAnalyzing = get().isAnalyzing;
    set({
      analysisGeneration: nextGen,
      activeAnalysisId: null,
      ...(wasAnalyzing
        ? {
            isAnalyzing: false,
            analyzingStatusMessage: null,
            pathologyAnalysisStatus: 'idle',
            pathologyStatusMessage: null,
          }
        : {}),
    });
  },

  // ─── Pathology Pipeline Actions ──────────────────────────────
  setAiDetections: (detections) => set({ aiDetections: detections }),
  setConfirmedPathologies: (pathologies) => set({ confirmedPathologies: pathologies }),

  updateDetectionBbox: (id, bbox) => set((state) => ({
    // AI detections are the immutable prediction snapshot. Human geometry edits
    // belong only to the separately confirmed/reviewed lesion instance.
    aiDetections: state.aiDetections,
    confirmedPathologies: state.confirmedPathologies.map((d) => d.id === id ? { ...d, bbox, polygonPoints: undefined, isUserEdited: true, humanReviewed: true } : d),
  })),

  updateDetectionPolygon: (id, polygonPoints) => set((state) => ({
    aiDetections: state.aiDetections,
    confirmedPathologies: state.confirmedPathologies.map((d) => d.id === id ? {
      ...d,
      polygonPoints,
      geometryStatus: polygonPoints.length >= 3 ? 'valid' : d.geometryStatus,
      isUserEdited: true,
      humanReviewed: true,
    } : d),
  })),

  updateDetectionKey: (id, newKey) => {
    const taxItem = PATHOLOGY_DICT[newKey];
    set((state) => ({
      confirmedPathologies: state.confirmedPathologies.map((d) =>
        d.id === id ? {
          ...d,
          pathologyKey: newKey,
          label: taxItem?.label ?? newKey,
          labelEn: taxItem?.labelEn ?? newKey,
          description: taxItem?.description ?? '',
          descriptionEn: taxItem?.descriptionEn ?? '',
          color: taxItem?.color ?? d.color,
          fillColor: taxItem?.fillColor ?? d.fillColor,
          isUserEdited: true, humanReviewed: true,
        } : d
      ),
    }));
  },

  toggleDetectionVisibility: (id) => set((state) => {
    const next = new Set(state.hiddenDetectionIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { hiddenDetectionIds: next };
  }),

  setPathologyGeminiResult: (result) => set({ pathologyGeminiResult: result }),
  setPathologyInferenceLineage: (lineage) => set({ pathologyInferenceLineage: lineage }),
  setPathologyValidityAudit: (audit) => set({ pathologyValidityAudit: audit }),
  setPathologyAnalysisStatus: (status) => set({ pathologyAnalysisStatus: status }),
  setPathologyStatusMessage: (msg) => set({ pathologyStatusMessage: msg }),

  resetPathologyState: () => set((state) => ({
    analysisGeneration: state.analysisGeneration + 1,
    activeAnalysisId: null,
    aiDetections: [],
    confirmedPathologies: [],
    pathologyGeminiResult: null,
    pathologyInferenceLineage: null,
    pathologyValidityAudit: null,
    hiddenDetectionIds: new Set<string>(),
    pathologyAnalysisStatus: 'idle',
    pathologyStatusMessage: null,
    isAnalyzing: false,
    analyzingStatusMessage: null,
  })),
}));
