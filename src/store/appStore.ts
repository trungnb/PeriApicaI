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
} from '../types/dental';
import { ALL_TEETH } from '../data/taxonomyData';
import { PATHOLOGY_DICT } from '../constants/dictionaries';
import { imageBlobCache } from '../utils/imageBlobCache';
import i18next from '../i18n';


const getInitialLanguage = (): Language => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('periapical_language');
    if (saved === 'VI' || saved === 'EN') return saved;
  }
  return 'VI';
};

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
  globalError: string | null;
  systemNoticeModal: { isOpen: boolean; title?: string; message: string; type?: 'warning' | 'info' } | null;
  customKeyErrorModal: { isOpen: boolean; message: string } | null;
  isQuotaExhausted: boolean;
  quotaResetNotice: string | null;
  shareConsent: boolean;
  userConcurred: boolean | null;
  selectedOverrideKeys: string[];
  userNotes: string;
  compressedImageBase64: string | null;
  lastCompressionMetrics: any | null;
  setLastCompressionMetrics: (metrics: any | null) => void;
  lastAnalysisMetrics: {
    clientCompressTimeMs: number;
    networkTimeMs: number;
    geminiTimeMs: number;
    totalTimeMs: number;
    wasCached: boolean;
    pipeline: 'classic' | 'pathology';
    modelUsed?: string;
  } | null;
  setLastAnalysisMetrics: (metrics: any | null) => void;
  apiKeyOption: 'system' | 'custom';
  customApiKey: string;
  rememberCustomApiKey: boolean;
  analysisMode: 'single' | 'consensus';
  availableModels: Array<{ id: string; displayName: string }>;
  selectedModelA: string;
  selectedModelB: string;
  isLoadingModels: boolean;
  appEngineMode: AppEngineMode;

  // ─── Pathology Pipeline State (Luồng B) ─────────────────────
  aiDetections: AIDetection[];
  confirmedPathologies: ConfirmedPathology[];
  pathologyGeminiResult: PathologyGeminiVerification | null;
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
  setCustomKeyErrorModal: (modal: { isOpen: boolean; message: string } | null) => void;
  setApiKeyOption: (option: 'system' | 'custom') => void;
  setCustomApiKey: (key: string) => void;
  setRememberCustomApiKey: (remember: boolean) => void;
  setIsFallbackAnalysis: (isFallback: boolean) => void;
  setConfirmedErrorKeys: (keys: string[]) => void;
  setShareConsent: (consent: boolean) => void;
  addLog: (log: AssessmentLogPayload) => void;
  clearLogs: () => void;
  setIsAdminModalOpen: (isOpen: boolean) => void;
  setIsBugModalOpen: (isOpen: boolean) => void;
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
  setPathologyAnalysisStatus: (status: 'idle' | 'analyzing' | 'complete' | 'error') => void;
  setPathologyStatusMessage: (msg: string | null) => void;
  resetPathologyState: () => void;
}

const getInitialApiKeyOption = (): 'system' | 'custom' => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('periapical_api_key_option');
    if (saved === 'system' || saved === 'custom') return saved;
    // If a custom key was already saved on device, default to custom option
    if (localStorage.getItem('periapical_user_api_key')) return 'custom';
  }
  return 'system';
};

const getInitialCustomApiKey = (): string => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('periapical_user_api_key') || '';
  }
  return '';
};

const getInitialRememberCustomApiKey = (): boolean => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('periapical_remember_custom_api_key');
    // If explicitly set to false, respect it; otherwise default to true for user convenience
    if (saved === 'false') return false;
    return true;
  }
  return true;
};


export const generateSessionId = (mode: AppEngineMode = 'classic'): string => {
  const prefix = mode === 'pathology_segmentation' ? 'pathology-session' : 'classic-session';
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
  language: getInitialLanguage(),
  theme: getInitialTheme(),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('periapical_theme', theme);
      localStorage.setItem('periapical_dark_mode', theme === 'dark' ? 'true' : 'false');
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
  customApiKey: getInitialCustomApiKey(),
  rememberCustomApiKey: getInitialRememberCustomApiKey(),
  analysisMode: 'single',
  availableModels: [],
  selectedModelA: 'gemini-flash-latest',
  selectedModelB: 'gemini-flash-lite-latest',
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
  globalError: null,
  systemNoticeModal: null,
  customKeyErrorModal: null,
  isQuotaExhausted: false,
  quotaResetNotice: null,
  shareConsent: true,
  userConcurred: null,
  selectedOverrideKeys: [],
  userNotes: '',
  compressedImageBase64: null,
  lastCompressionMetrics: null,
  lastAnalysisMetrics: null,

  // ─── Pathology Pipeline Initial State ─────────────────────────────
  aiDetections: [],
  confirmedPathologies: [],
  pathologyGeminiResult: null,
  hiddenDetectionIds: new Set<string>(),
  pathologyAnalysisStatus: 'idle',
  pathologyStatusMessage: null,

  setAppEngineMode: (mode) => set((state) => {
    if (state.appEngineMode === mode) return {};
    // When changing flow at Welcome/Setup stage, immediately assign flow-specific Session ID
    const newId = state.currentStep <= 2 ? generateSessionId(mode) : state.currentAssessmentId;
    return {
      appEngineMode: mode,
      currentAssessmentId: newId,
      
      // Reset Pathology state
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
      
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
      localStorage.setItem('periapical_language', lang);
    }
    i18next.changeLanguage(lang.toLowerCase());
    set({ language: lang });
  },

  toggleLanguage: () => {
    const nextLang = get().language === 'VI' ? 'EN' : 'VI';
    if (typeof window !== 'undefined') {
      localStorage.setItem('periapical_language', nextLang);
    }
    i18next.changeLanguage(nextLang.toLowerCase());
    set({ language: nextLang });
  },

  setCurrentStep: (step) => set((state) => {
    if (step === 1 || step === 2) {
      return { currentStep: step, shareConsent: true };
    }
    return { currentStep: step };
  }),
  setCurrentAssessmentId: (id) => set({ currentAssessmentId: id }),
  setSelectedTechnique: (technique) => set((state) => {
    if (state.selectedTechnique === technique) return {};
    return { selectedTechnique: technique, analysisResult: null, lastAnalyzedRequestHash: null, confirmedErrorKeys: [] };
  }),
  setSelectedReceptor: (receptor) => set((state) => {
    if (state.selectedReceptor === receptor) return {};
    return { selectedReceptor: receptor, analysisResult: null, lastAnalyzedRequestHash: null, confirmedErrorKeys: [] };
  }),
  setSelectedTooth: (tooth) => set((state) => {
    if (state.selectedTooth.fdiNumber === tooth.fdiNumber) return {};
    return { selectedTooth: tooth, analysisResult: null, lastAnalyzedRequestHash: null, confirmedErrorKeys: [] };
  }),
  setImageDataUrl: (url, file?: File | null) => set((state) => {
    if (state.imageDataUrl === url && state.imageFile === (file || null)) return {};
    if (state.imageDataUrl && state.imageDataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.imageDataUrl);
    }
    if (url && state.currentAssessmentId) {
      imageBlobCache.set(state.currentAssessmentId, { blob: file || undefined, dataUrl: url });
    }
    return { imageDataUrl: url, imageFile: file || null, compressedImageBase64: null, lastCompressionMetrics: null, lastAnalysisMetrics: null, analysisResult: null, lastAnalyzedRequestHash: null, confirmedErrorKeys: [] };
  }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setLastCompressionMetrics: (metrics) => set({ lastCompressionMetrics: metrics }),
  setLastAnalysisMetrics: (metrics) => set({ lastAnalysisMetrics: metrics }),
  setAnalyzingStatusMessage: (msg) => set({ analyzingStatusMessage: msg }),
  setAnalysisResult: (result) => set({ analysisResult: result }),
  setGlobalError: (msg) => set({ globalError: msg }),
  setSystemNoticeModal: (modal) => set({ systemNoticeModal: modal }),
  setCustomKeyErrorModal: (modal) => set({ customKeyErrorModal: modal }),
  setApiKeyOption: (option) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('periapical_api_key_option', option);
    }
    set({ apiKeyOption: option });
  },
  setCustomApiKey: (key) => {
    const trimmed = key.trim();
    if (typeof window !== 'undefined') {
      if (get().rememberCustomApiKey && trimmed) {
        localStorage.setItem('periapical_user_api_key', trimmed);
      } else if (!get().rememberCustomApiKey || !trimmed) {
        localStorage.removeItem('periapical_user_api_key');
      }
    }
    set({ customApiKey: key });
  },
  setRememberCustomApiKey: (remember) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('periapical_remember_custom_api_key', remember ? 'true' : 'false');
      const currentKey = get().customApiKey.trim();
      if (remember && currentKey) {
        localStorage.setItem('periapical_user_api_key', currentKey);
      } else if (!remember) {
        localStorage.removeItem('periapical_user_api_key');
      }
    }
    set({ rememberCustomApiKey: remember });
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
    if (state.currentAssessmentId) {
      imageBlobCache.evictSessionImage(state.currentAssessmentId);
    }
    return {
      currentAssessmentId: generateSessionId(state.appEngineMode),
      imageDataUrl: null,
      imageFile: null,
      compressedImageBase64: null,
      lastCompressionMetrics: null,
      lastAnalysisMetrics: null,
      analysisResult: null,
      lastAnalyzedRequestHash: null,
      confirmedErrorKeys: [],
      currentStep: 1,
      selectedTechnique: 'Paralleling',
      selectedReceptor: 'Digital Sensor',
      selectedTooth: ALL_TEETH[7], // R11 default
      globalError: null,
      isAnalyzing: false,
      userConcurred: null,
      selectedOverrideKeys: [],
      userNotes: '',
      // Reset pathology state too
      aiDetections: [],
      confirmedPathologies: [],
      pathologyGeminiResult: null,
      hiddenDetectionIds: new Set<string>(),
      pathologyAnalysisStatus: 'idle',
      pathologyStatusMessage: null,
    };
  }),

  // ─── Pathology Pipeline Actions ──────────────────────────────
  setAiDetections: (detections) => set({ aiDetections: detections }),
  setConfirmedPathologies: (pathologies) => set({ confirmedPathologies: pathologies }),

  updateDetectionBbox: (id, bbox) => set((state) => ({
    aiDetections: state.aiDetections.map((d) => d.id === id ? { ...d, bbox, polygonPoints: undefined } : d),
    confirmedPathologies: state.confirmedPathologies.map((d) => d.id === id ? { ...d, bbox, polygonPoints: undefined, isUserEdited: true } : d),
  })),

  updateDetectionPolygon: (id, polygonPoints) => set((state) => ({
    aiDetections: state.aiDetections.map((d) => d.id === id ? { ...d, polygonPoints } : d),
    confirmedPathologies: state.confirmedPathologies.map((d) => d.id === id ? { ...d, polygonPoints, isUserEdited: true } : d),
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
          isUserEdited: true,
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
  setPathologyAnalysisStatus: (status) => set({ pathologyAnalysisStatus: status }),
  setPathologyStatusMessage: (msg) => set({ pathologyStatusMessage: msg }),

  resetPathologyState: () => set({
    aiDetections: [],
    confirmedPathologies: [],
    pathologyGeminiResult: null,
    hiddenDetectionIds: new Set<string>(),
    pathologyAnalysisStatus: 'idle',
    pathologyStatusMessage: null,
  }),
}));

