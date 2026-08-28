import { AssessmentLogPayload } from '../types/dental';

/**
 * Generic HTTP client with standard error normalization.
 */
export const apiRequest = async <T = any>(endpoint: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.userMessage || errorData.error) {
        errorMessage = errorData.userMessage || errorData.error;
      }
    } catch {
      // Ignore JSON parse errors for error responses
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
};

async function postJSON<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = `HTTP error! status: ${response.status}`;
    try {
      const data = await response.json();
      if (data.error || data.userMessage) errorMsg = data.error || data.userMessage;
    } catch {
      // ignore non-json errors
    }
    throw new Error(errorMsg);
  }

  return response.json() as Promise<T>;
}

export const reportAutoSystemError = async (description: string, errorDetails?: any) => {
  try {
    await fetch('/api/report-bug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `[Tự động Log - Client] ${description}`,
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        timestamp: new Date().toISOString(),
        source: 'SYSTEM_AUTO',
        severity: 'ERROR',
        errorDetails,
      }),
    });
  } catch {
    // Silently ignore reporting errors
  }
};

export const validateCustomApiKey = async (apiKey: string): Promise<{ valid: boolean; message: string }> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, 15000); // 15-second timeout safeguard

  try {
    const response = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
      signal: abortController.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (response.ok && data.valid) {
      return { valid: true, message: data.message || 'API Key hợp lệ.' };
    }
    return { valid: false, message: data.message || 'API Key không hợp lệ.' };
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    clearTimeout(timeoutId);
    const isTimeout = err?.name === 'AbortError' || abortController.signal.aborted;
    if (isTimeout) {
      return { valid: false, message: 'Yêu cầu kiểm tra Key quá hạn (15s). Vui lòng thử lại!' };
    }
    return { valid: false, message: err?.message || 'Không thể kết nối máy chủ để kiểm tra Key.' };
  }
};

const PENDING_LOGS_QUEUE_KEY = 'dental_pending_logs_queue';
const PENDING_PATHOLOGY_LOGS_QUEUE_KEY = 'dental_pending_pathology_logs_queue';

export const flushPendingLogs = async () => {
  try {
    const raw = localStorage.getItem(PENDING_LOGS_QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining: any[] = [];
    const results = await Promise.allSettled(
      queue.map(async (item) => {
        try {
          const response = await fetch('/api/log-assessment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!response.ok) {
            return { success: false, item };
          }
          return { success: true, item };
        } catch {
          return { success: false, item };
        }
      })
    );

    results.forEach((res) => {
      if (res.status === 'fulfilled' && !res.value.success) {
        remaining.push(res.value.item);
      }
    });

    if (remaining.length === 0) {
      localStorage.removeItem(PENDING_LOGS_QUEUE_KEY);
    } else {
      localStorage.setItem(PENDING_LOGS_QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch (err) {
    console.error('Error flushing pending logs:', err);
  }
};

export const flushPendingPathologyLogs = async () => {
  try {
    const raw = localStorage.getItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining: any[] = [];
    const results = await Promise.allSettled(
      queue.map(async (item) => {
        try {
          const response = await fetch('/api/save-pathology', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!response.ok) {
            return { success: false, item };
          }
          return { success: true, item };
        } catch {
          return { success: false, item };
        }
      })
    );

    results.forEach((res) => {
      if (res.status === 'fulfilled' && !res.value.success) {
        remaining.push(res.value.item);
      }
    });

    if (remaining.length === 0) {
      localStorage.removeItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY);
    } else {
      localStorage.setItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch (err) {
    console.error('Error flushing pending pathology logs:', err);
  }
};

export const saveAssessmentLog = async (payload: AssessmentLogPayload, imageDataUrl?: string) => {
  const dataToSave = { payload, imageDataUrl };
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await postJSON<any>('/api/log-assessment', dataToSave);
      flushPendingLogs().catch(() => {});
      return response;
    } catch {
      if (attempt === 3) {
        try {
          const existing = JSON.parse(localStorage.getItem(PENDING_LOGS_QUEUE_KEY) || '[]');
          existing.push({ ...dataToSave, queuedAt: new Date().toISOString() });
          localStorage.setItem(PENDING_LOGS_QUEUE_KEY, JSON.stringify(existing));
        } catch {
          // Ignore storage quota errors
        }
        return { success: true, id: `offline-${Date.now()}` };
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
};

export const savePathologyAssessmentLog = async (payload: any, imageDataUrl?: string) => {
  const dataToSave = { ...payload, imageDataUrl };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await postJSON<any>('/api/save-pathology', dataToSave);
      flushPendingPathologyLogs().catch(() => {});
      return response;
    } catch {
      if (attempt === 3) {
        try {
          const existing = JSON.parse(localStorage.getItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY) || '[]');
          existing.push({ ...dataToSave, queuedAt: new Date().toISOString() });
          localStorage.setItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY, JSON.stringify(existing));
        } catch {
          // Ignore storage quota errors
        }
        return { success: true, id: `offline-pathology-${Date.now()}` };
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
};

export const verifyAssessmentLog = async (payload: {
  assessmentId: string;
  verifiedErrors: string[];
  verifiedNotes?: string;
  accuracyScore?: string;
}, authHeaders: Record<string, string> = {}) => {
  const response = await fetch('/api/verify-assessment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

export const verifyPathologyAssessmentLog = async (payload: {
  assessmentId: string;
  verifiedPathologies: any[];
  verifiedNotes?: string;
}, authHeaders: Record<string, string> = {}) => {
  const response = await fetch('/api/verify-pathology', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

export const deleteSingleDocument = async (
  payload: {
    docId: string;
    collection: 'reports' | 'bugs' | 'seg_reports';
    password?: string;
  },
  authHeaders: Record<string, string> = {}
) => {
  const response = await fetch('/api/admin/delete-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi HTTP ${response.status}`);
  }
  return response.json() as Promise<{
    success: boolean;
    deletedDocId: string;
    collection: string;
    deletedCount: number;
    message: string;
  }>;
};

export const deleteAdminData = async (
  payload: {
    timeConfig: { isAllTime: boolean; startDate?: string; endDate?: string } | string;
    deleteTypes: string[];
    password?: string;
  },
  authHeaders: Record<string, string> = {}
) => {
  const response = await fetch('/api/admin/delete-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi HTTP ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean; deletedCount: number; message: string }>;
};

export const getReportById = async (assessmentId: string, authHeaders: Record<string, string> = {}) => {
  const response = await fetch(`/api/reports/${encodeURIComponent(assessmentId)}`, {
    headers: { ...authHeaders },
  });
  if (!response.ok) {
    throw new Error(`Lỗi HTTP ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean; log: AssessmentLogPayload }>;
};
