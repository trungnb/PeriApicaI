import {
  TECH_FAILURE_DICT,
  normalizeTechFailureKey,
  getTechFailureLabel,
  getTechFailureDescription,
  getRemediationText,
} from '../constants/dictionaries';
import { reportAutoSystemError } from '../services/apiService';
import { useAppStore } from '../store/appStore';
import { AnalysisWorkspaceSnapshot } from '../types/dental';

export type ErrorCategory =
  | 'TECHNICAL_FAILURE'
  | 'QUOTA_EXHAUSTED'
  | 'CUSTOM_KEY_FAILED'
  | 'NON_DENTAL'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export type ErrorActionType =
  | 'SHOW_TOAST'
  | 'SHOW_ALERT'
  | 'SHOW_BYOK_MODAL'
  | 'SHOW_SYSTEM_NOTICE'
  | 'SET_QUOTA_LOCKED';

export interface StandardizedAIError {
  category: ErrorCategory;
  title: string;
  message: string;
  technicalKey?: string;
  remediation?: string;
  details?: string;
  actionType: ErrorActionType;
  reasonCategory?: 'invalid_key' | 'quota_or_rate_limit' | 'provider_unavailable' | 'network_or_timeout' | 'unknown_custom_key_failure';
  resetNotice?: string;
  rawMessage: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, any>;
}

export interface ErrorClassificationInput {
  error?: unknown;
  errorNotice?: string;
  userMessage?: string;
  errorCode?: string;
  status?: number;
  isCustomKeyFailed?: boolean;
  isQuotaExhausted?: boolean;
  isAllExhausted?: boolean;
  resetNotice?: string;
  type?: 'classic' | 'pathology';
  language?: 'VI' | 'EN';
  context?: Record<string, any>;
}

type CustomKeyReason = NonNullable<StandardizedAIError['reasonCategory']>;

const HTTP_ERROR_CATEGORIES: Record<number, ErrorCategory> = {
  429: 'QUOTA_EXHAUSTED',
  500: 'SERVER_ERROR',
  502: 'SERVER_ERROR',
  503: 'SERVER_ERROR',
  504: 'SERVER_ERROR',
};
const ERROR_CODE_CATEGORIES: Record<string, ErrorCategory> = {
  CUSTOM_KEY_FAILED: 'CUSTOM_KEY_FAILED',
  NOT_PERIAPICAL: 'NON_DENTAL',
};
const CUSTOM_KEY_MARKERS = ['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED', 'byokError'];
const QUOTA_MARKERS = ['429', 'RESOURCE_EXHAUSTED', 'quota', 'Hạn mức'];
const TIMEOUT_MARKERS = ['timeout', 'timed out', 'hết thời gian'];
const SERVER_MARKERS = ['Failed to fetch', 'NetworkError', 'ECONNREFUSED'];
const CUSTOM_REASON_MESSAGES: Record<CustomKeyReason, { en: string; vi: string }> = {
  invalid_key: { en: 'Your personal API key is invalid.', vi: 'Khóa API cá nhân không hợp lệ.' },
  quota_or_rate_limit: { en: 'Your personal API key has reached its quota or is currently rate-limited.', vi: 'Khóa API cá nhân hiện đã hết hạn mức hoặc đang bị giới hạn.' },
  provider_unavailable: { en: 'Your personal API key could not be used to complete the request at this time.', vi: 'Hiện không thể sử dụng khóa API cá nhân để hoàn tất yêu cầu.' },
  network_or_timeout: { en: 'Your personal API key could not be used to complete the request at this time.', vi: 'Hiện không thể sử dụng khóa API cá nhân để hoàn tất yêu cầu.' },
  unknown_custom_key_failure: { en: 'The request could not be completed using your current personal API key.', vi: 'Yêu cầu không thể hoàn tất bằng khóa API cá nhân hiện tại.' },
};

const includesAny = (value: string, markers: string[]) => markers.some((marker) => value.includes(marker));

/**
 * Normalizes any error object, string, or API response into a standard format.
 */
function extractErrorDetails(input: unknown): { message: string; stack?: string; name?: string } {
  if (!input) {
    return { message: 'Unknown error occurred' };
  }
  if (typeof input === 'string') {
    return { message: input };
  }
  if (input instanceof Error) {
    return {
      message: input.message || 'Error occurred',
      stack: input.stack,
      name: input.name,
    };
  }
  if (typeof input === 'object' && input !== null) {
    const obj = input as any;
    const msg = obj.userMessage || obj.errorNotice || obj.message || obj.error || JSON.stringify(input);
    return {
      message: typeof msg === 'string' ? msg : 'Error occurred',
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
      name: typeof obj.name === 'string' ? obj.name : undefined,
    };
  }
  return { message: String(input) };
}

/**
 * Core Classifier: Analyzes errors and maps technical failures to TECH_FAILURE_DICT
 * while categorizing API quota, authorization, network, or server failures.
 */
export function classifyAndFormatAIError(
  input: ErrorClassificationInput | unknown,
  fallbackLang: 'VI' | 'EN' = 'VI'
): StandardizedAIError {
  const options: ErrorClassificationInput =
    typeof input === 'object' && input !== null && ('error' in input || 'isCustomKeyFailed' in input || 'isQuotaExhausted' in input)
      ? (input as ErrorClassificationInput)
      : { error: input };

  const language = options.language || fallbackLang;
  const isEn = language === 'EN';
  const { message: rawMessage, stack, name } = extractErrorDetails(options.error);
  const context = options.context || {};
  const timestamp = new Date().toISOString();
  const statusCategory = typeof options.status === 'number' ? HTTP_ERROR_CATEGORIES[options.status] : undefined;
  const codeCategory = options.errorCode ? ERROR_CODE_CATEGORIES[options.errorCode] : undefined;
  const common = { rawMessage, stack, timestamp, context };

  if (options.isCustomKeyFailed || codeCategory === 'CUSTOM_KEY_FAILED' || includesAny(rawMessage, CUSTOM_KEY_MARKERS)) {
    const reasonCategory = (
      [
        [includesAny(rawMessage, ['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED']) || options.errorCode === 'INVALID_CUSTOM_KEY', 'invalid_key'],
        [options.isQuotaExhausted || statusCategory === 'QUOTA_EXHAUSTED' || includesAny(rawMessage, QUOTA_MARKERS), 'quota_or_rate_limit'],
        [name === 'AbortError' || includesAny(rawMessage, TIMEOUT_MARKERS), 'network_or_timeout'],
        [includesAny(rawMessage, ['503', 'UNAVAILABLE']), 'provider_unavailable'],
      ] as [boolean, CustomKeyReason][]
    ).find(([matched]) => matched)?.[1] || 'unknown_custom_key_failure';
    return {
      ...common,
      category: 'CUSTOM_KEY_FAILED',
      title: isEn ? 'Personal API key unavailable' : 'Không thể sử dụng khóa API cá nhân',
      message: options.userMessage || CUSTOM_REASON_MESSAGES[reasonCategory][isEn ? 'en' : 'vi'],
      details: isEn
        ? 'You can retry with your personal key or start a new analysis using the application\'s API credentials.'
        : 'Bạn có thể thử lại với khóa cá nhân hoặc chuyển sang khóa API của ứng dụng cho lần phân tích mới.',
      actionType: 'SHOW_BYOK_MODAL',
      reasonCategory,
    };
  }

  if (options.isAllExhausted || options.isQuotaExhausted || statusCategory === 'QUOTA_EXHAUSTED' || includesAny(rawMessage, QUOTA_MARKERS)) {
    const resetNotice = options.resetNotice || (isEn ? '1 minute' : '1 phút');
    return {
      ...common,
      category: 'QUOTA_EXHAUSTED',
      title: isEn ? 'AI System Quota Limit' : 'Hạn Mức AI Hệ Thống',
      message:
        options.userMessage ||
        (isEn
          ? `The system AI trial key limit is temporarily reached. Quota resets in approximately ${resetNotice}.`
          : `Hạn mức dùng thử của hệ thống hiện tại đã hết hoặc đang quá tải. Hạn mức sẽ tự động khôi phục sau khoảng ${resetNotice}.`),
      details: isEn
        ? 'You can wait for the cooldown or provide your own Gemini API Key (BYOK) for uninterrupted access.'
        : 'Bạn có thể chờ hệ thống làm mới hoặc sử dụng khóa API cá nhân (BYOK) để tiếp tục phân tích ngay.',
      actionType: options.isAllExhausted ? 'SHOW_SYSTEM_NOTICE' : 'SET_QUOTA_LOCKED',
      resetNotice,
    };
  }

  if (codeCategory === 'NON_DENTAL' || includesAny(rawMessage, ['not_periapical', 'non_dental', 'Không phải phim cận chóp', 'Not a periapical'])) {
    return {
      ...common,
      category: 'NON_DENTAL',
      title: isEn ? 'Invalid Radiograph' : 'Ảnh Không Hợp Lệ',
      message: isEn
        ? 'The uploaded image was not recognized as a periapical dental radiograph.'
        : 'Hình ảnh tải lên không được nhận diện là phim X-quang răng cận chóp (Periapical Radiograph).',
      details: isEn
        ? 'Please ensure you upload a clear dental periapical X-ray image (JPEG, PNG, WebP or DICOM).'
        : 'Vui lòng kiểm tra và tải lên đúng ảnh chụp X-quang răng cận chóp tiêu chuẩn (định dạng JPEG, PNG, WebP hoặc DICOM).',
      actionType: 'SHOW_ALERT',
      technicalKey: 'not_periapical',
    };
  }

  const matchedKey = options.errorCode || options.errorNotice || rawMessage;
  const normalizedKey = normalizeTechFailureKey(matchedKey);

  if (normalizedKey && TECH_FAILURE_DICT[normalizedKey]) {
    const label = getTechFailureLabel(normalizedKey, language);
    const description = getTechFailureDescription(normalizedKey, language);
    const remediation = getRemediationText(normalizedKey, language);

    return {
      ...common,
      category: 'TECHNICAL_FAILURE',
      title: label,
      message: description || label,
      technicalKey: normalizedKey,
      remediation: remediation || undefined,
      details: remediation ? (isEn ? `Remediation: ${remediation}` : `Khắc phục: ${remediation}`) : undefined,
      actionType: 'SHOW_ALERT',
    };
  }

  if (name === 'AbortError' || includesAny(rawMessage, TIMEOUT_MARKERS)) {
    return {
      ...common,
      category: 'TIMEOUT',
      title: isEn ? 'Request Timed Out' : 'Hết Thời Gian Chờ',
      message: isEn
        ? 'The AI diagnostic server took too long to respond. Please verify your connection and try again.'
        : 'Thời gian phản hồi từ máy chủ AI vượt quá giới hạn cho phép. Vui lòng kiểm tra đường truyền và thử lại.',
      actionType: 'SHOW_ALERT',
    };
  }

  if (statusCategory === 'SERVER_ERROR' || includesAny(rawMessage, SERVER_MARKERS)) {
    return {
      ...common,
      category: 'SERVER_ERROR',
      title: isEn ? 'Server Connection Error' : 'Lỗi Kết Nối Máy Chủ',
      message: isEn
        ? 'Unable to connect to the diagnostic AI service. Please check your internet connection or try again shortly.'
        : 'Không thể kết nối đến máy chủ xử lý hình ảnh. Vui lòng kiểm tra mạng Internet hoặc thử lại sau ít phút.',
      actionType: 'SHOW_ALERT',
    };
  }

  return {
    ...common,
    category: 'UNKNOWN',
    title: isEn ? 'Analysis Error' : 'Lỗi Phân Tích',
    message: options.userMessage || options.errorNotice || rawMessage || (isEn ? 'An unexpected error occurred during processing.' : 'Đã có lỗi không mong muốn xảy ra trong quá trình xử lý.'),
    actionType: 'SHOW_ALERT',
  };
}

/**
 * Standardized Logger: Logs full stack traces and contextual metadata internally for developers,
 * while automatically reporting system errors to telemetry.
 */
export function logDiagnosticError(
  error: unknown,
  context?: Record<string, any>,
  options?: { silentServer?: boolean; component?: string }
): StandardizedAIError {
  const stdError = classifyAndFormatAIError({ error, context });
  const componentTag = options?.component ? `[${options.component}]` : '[DiagnosticError]';

  console.groupCollapsed?.(`🔴 ${componentTag} ${stdError.category}: ${stdError.title}`);
  console.error('User Message:', stdError.message);
  if (stdError.technicalKey) console.info('Technical Key (TECH_FAILURE_DICT):', stdError.technicalKey);
  if (stdError.remediation) console.info('Remediation:', stdError.remediation);
  if (context && Object.keys(context).length > 0) console.info('Context Metadata:', context);
  if (stdError.stack) {
    console.error('Stack Trace:\n', stdError.stack);
  } else {
    console.error('Raw Error Details:', error);
  }
  console.groupEnd?.();

  // Automatically report severe unexpected server/pipeline errors to telemetry
  if (!options?.silentServer && (stdError.category === 'SERVER_ERROR' || stdError.category === 'UNKNOWN')) {
    reportAutoSystemError(
      `${componentTag} ${stdError.category}: ${stdError.rawMessage}`,
      {
        category: stdError.category,
        title: stdError.title,
        context,
        stack: stdError.stack,
        timestamp: stdError.timestamp,
      }
    );
  }

  return stdError;
}

/**
 * Centralized Error Dispatcher for AI Analysis Flows (Classic & Pathology):
 * Handles store updates, modal dispatches, and quota lockouts uniformly.
 */
export function handleAnalysisFlowError(
  input: ErrorClassificationInput | unknown,
  flowType: 'classic' | 'pathology' = 'classic',
  options?: { language?: 'VI' | 'EN'; context?: Record<string, any>; snapshot?: AnalysisWorkspaceSnapshot | null }
): StandardizedAIError {
  const lang = options?.language || useAppStore.getState().language || 'VI';
  const stdError = classifyAndFormatAIError(
    typeof input === 'object' && input !== null
      ? { ...(input as ErrorClassificationInput), language: lang, context: options?.context }
      : { error: input, language: lang, context: options?.context },
    lang
  );

  // Stale Request Protection: If this error belongs to a superseded or invalidated generation,
  // do NOT dispatch to store, do NOT show modals, and do NOT alter loading states.
  if (options?.snapshot && !useAppStore.getState().isAnalysisCurrent(options.snapshot)) {
    return stdError;
  }

  // Log full stack trace internally
  logDiagnosticError(input, options?.context, { component: `AnalysisFlow:${flowType}` });

  const store = useAppStore.getState();

  // Reset loading indicators uniformly
  useAppStore.setState({
    isAnalyzing: false,
    analyzingStatusMessage: null,
  });

  if (flowType === 'pathology') {
    store.setPathologyAnalysisStatus('error');
    store.setPathologyStatusMessage(stdError.message);
  }

  // Action Dispatching
  switch (stdError.actionType) {
    case 'SHOW_BYOK_MODAL':
      store.setCustomKeyErrorModal({
        isOpen: true,
        message: stdError.message,
        reasonCategory: stdError.reasonCategory,
        systemApiAvailable: typeof (input as any)?.systemApiAvailable === 'boolean'
          ? (input as any).systemApiAvailable
          : store.systemApiAvailable,
      });
      break;

    case 'SHOW_SYSTEM_NOTICE':
      store.setSystemNoticeModal({
        isOpen: true,
        title: stdError.title,
        message: stdError.message,
        type: 'warning',
      });
      break;

    case 'SET_QUOTA_LOCKED':
      store.setQuotaExhausted(true, stdError.resetNotice || (lang === 'EN' ? '1 minute' : '1 phút'));
      store.setGlobalError(stdError.message);
      break;

    case 'SHOW_ALERT':
    default:
      if (stdError.category === 'NON_DENTAL') {
        useAppStore.setState({
          imageDataUrl: null,
          lastAnalyzedRequestHash: null,
        });
      }
      store.setGlobalError(
        stdError.remediation
          ? `${stdError.message}\n\n💡 ${lang === 'EN' ? 'Clinical advice:' : 'Khắc phục:'} ${stdError.remediation}`
          : stdError.message
      );
      break;
  }

  return stdError;
}
