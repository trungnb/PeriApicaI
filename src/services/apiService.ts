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

// Queue Limits
const MAX_QUEUE_ITEMS = 25;
const MAX_QUEUE_TOTAL_BYTES = 500 * 1024; // 500KB cap
const MAX_OFFLINE_IMAGE_BYTES = 80 * 1024; // 80KB cap for image in offline queue

function estimateStringBytes(str: string): number {
  return str ? str.length * 2 : 0;
}

function estimateQueueBytes(queue: any[]): number {
  try {
    return estimateStringBytes(JSON.stringify(queue));
  } catch {
    return 0;
  }
}

const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours expiry for offline queue items

/**
 * Prunes offline queue by dropping expired entries, stripping medical images, and capping size.
 */
function pruneOfflineQueue(queue: any[]): any[] {
  if (!Array.isArray(queue)) return [];

  const now = Date.now();
  // 1. Drop expired items older than 24 hours
  let active = queue.filter((item) => {
    const queuedAt = item.queuedAt ? Date.parse(item.queuedAt) : 0;
    return !queuedAt || (now - queuedAt < MAX_QUEUE_AGE_MS);
  });

  // 2. Strip medical images unconditionally from offline persistence to prevent sensitive image retention in localStorage
  let pruned = active.map((item) => {
    const { imageDataUrl: _dataUrl, imageUrl: _url, ...rest } = item;
    return rest;
  });

  // 3. Cap item count (keep newest items)
  if (pruned.length > MAX_QUEUE_ITEMS) {
    pruned = pruned.slice(pruned.length - MAX_QUEUE_ITEMS);
  }

  // 4. If still over byte limit, drop oldest items
  while (pruned.length > 1 && estimateQueueBytes(pruned) > MAX_QUEUE_TOTAL_BYTES) {
    pruned.shift();
  }

  return pruned;
}

function safelySaveQueue(key: string, queue: any[]): void {
  try {
    const safeQueue = pruneOfflineQueue(queue);
    localStorage.setItem(key, JSON.stringify(safeQueue));
  } catch (err) {
    console.debug(`[apiService] Failed to save offline queue for ${key}:`, err);
  }
}

// Re-read after network awaits; acknowledge only unchanged successful snapshot entries.
function acknowledgeQueuedEntries(key: string, sent: Set<string>): void {
  if (!sent.size) return;
  const current = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(current)) return;
  const remaining = current.filter((item) => !sent.has(JSON.stringify(item)));
  if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
  else localStorage.removeItem(key);
}

let isFlushingClassic = false;
let isFlushingPathology = false;

export const flushPendingLogs = async () => {
  if (isFlushingClassic) return;
  isFlushingClassic = true;
  try {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_LOGS_QUEUE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let queue: any[] = [];
    try {
      queue = JSON.parse(raw);
    } catch {
      localStorage.removeItem(PENDING_LOGS_QUEUE_KEY);
      return;
    }
    if (!Array.isArray(queue) || queue.length === 0) return;

    const sent = new Set<string>();
    // Process sequentially or concurrency = 2 to avoid hammering server
    for (let i = 0; i < queue.length; i += 2) {
      const batch = queue.slice(i, i + 2);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetch('/api/log-assessment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (response.status === 429) {
              // Rate limited: stop flushing and keep remaining
              return { success: false, item, shouldStop: true };
            }
            return { success: response.ok, item };
          } catch {
            clearTimeout(timer);
            return { success: false, item };
          }
        })
      );

      let shouldStopFlushing = false;
      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value.success) {
            sent.add(JSON.stringify(res.value.item));
          }
          if ((res.value as any).shouldStop) {
            shouldStopFlushing = true;
          }
        }
      }

      if (shouldStopFlushing) {
        break;
      }
    }

    acknowledgeQueuedEntries(PENDING_LOGS_QUEUE_KEY, sent);
  } catch (err) {
    console.debug('[apiService] Error flushing pending logs:', err);
  } finally {
    isFlushingClassic = false;
  }
};

export const flushPendingPathologyLogs = async () => {
  if (isFlushingPathology) return;
  isFlushingPathology = true;
  try {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let queue: any[] = [];
    try {
      queue = JSON.parse(raw);
    } catch {
      localStorage.removeItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY);
      return;
    }
    if (!Array.isArray(queue) || queue.length === 0) return;

    const sent = new Set<string>();
    // Process max 2 at a time
    for (let i = 0; i < queue.length; i += 2) {
      const batch = queue.slice(i, i + 2);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetch('/api/save-pathology', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (response.status === 429) {
              return { success: false, item, shouldStop: true };
            }
            return { success: response.ok, item };
          } catch {
            clearTimeout(timer);
            return { success: false, item };
          }
        })
      );

      let shouldStopFlushing = false;
      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value.success) {
            sent.add(JSON.stringify(res.value.item));
          }
          if ((res.value as any).shouldStop) {
            shouldStopFlushing = true;
          }
        }
      }

      if (shouldStopFlushing) {
        break;
      }
    }

    acknowledgeQueuedEntries(PENDING_PATHOLOGY_LOGS_QUEUE_KEY, sent);
  } catch (err) {
    console.debug('[apiService] Error flushing pending pathology logs:', err);
  } finally {
    isFlushingPathology = false;
  }
};

export const saveAssessmentLog = async (payload: AssessmentLogPayload, imageDataUrl?: string) => {
  const isConsent = payload.shareConsent === true;
  const safeImageDataUrl = isConsent ? imageDataUrl : undefined;
  const dataToSave = {
    payload: {
      ...payload,
      imageUrl: isConsent ? payload.imageUrl : undefined,
    },
    imageDataUrl: safeImageDataUrl,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('/api/log-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSave),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const resJson = await response.json().catch(() => ({ success: true }));
      flushPendingLogs().catch(() => {});
      return resJson;
    }
    throw new Error(`Server returned ${response.status}`);
  } catch (err) {
    clearTimeout(timeoutId);
    console.debug('[apiService] Background log failed, queueing offline:', err);
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(PENDING_LOGS_QUEUE_KEY) || '[]');
      const assessmentId = payload.assessmentId || `offline-${Date.now()}`;
      // Deduplicate by assessmentId + lastCompletedStep
      const deduped = existing.filter(
        (e) => !(e.payload?.assessmentId === assessmentId && e.payload?.lastCompletedStep === payload.lastCompletedStep)
      );
      const { imageDataUrl: _img, ...offlinePayload } = dataToSave;
      deduped.push({ ...offlinePayload, queuedAt: new Date().toISOString() });
      safelySaveQueue(PENDING_LOGS_QUEUE_KEY, deduped);
    } catch {
      // Ignore storage errors
    }
    return { success: true, id: `offline-${Date.now()}`, isQueued: true };
  }
};

export const savePathologyAssessmentLog = async (payload: any, imageDataUrl?: string) => {
  const isConsent = payload.shareConsent === true;
  const safeImageDataUrl = isConsent ? imageDataUrl : undefined;
  const dataToSave = {
    ...payload,
    imageUrl: isConsent ? payload.imageUrl : undefined,
    imageDataUrl: safeImageDataUrl,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('/api/save-pathology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSave),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const resJson = await response.json().catch(() => ({ success: true }));
      flushPendingPathologyLogs().catch(() => {});
      return resJson;
    }
    throw new Error(`Server returned ${response.status}`);
  } catch (err) {
    clearTimeout(timeoutId);
    console.debug('[apiService] Background pathology log failed, queueing offline:', err);
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY) || '[]');
      const assessmentId = payload.assessmentId || `offline-pathology-${Date.now()}`;
      const deduped = existing.filter(
        (e) => !(e.assessmentId === assessmentId && e.lastCompletedStep === payload.lastCompletedStep)
      );
      const { imageDataUrl: _img, imageUrl: _imgUrl, ...offlinePayload } = dataToSave;
      deduped.push({ ...offlinePayload, queuedAt: new Date().toISOString() });
      safelySaveQueue(PENDING_PATHOLOGY_LOGS_QUEUE_KEY, deduped);
    } catch {
      // Ignore storage errors
    }
    return { success: true, id: `offline-pathology-${Date.now()}`, isQueued: true };
  }
};

export const verifyAssessmentLog = async (payload: {
  assessmentId: string;
  verifiedErrors: string[];
  verifiedNotes?: string;
  accuracyScore?: string;
}, authHeaders: Record<string, string> = {}): Promise<{ success: boolean; log: AssessmentLogPayload }> => {
  const response = await fetch('/api/verify-assessment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean; log: AssessmentLogPayload }>;
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

export const getOfflineQueueDiagnostics = () => {
  try {
    const rawClassic = localStorage.getItem(PENDING_LOGS_QUEUE_KEY) || '[]';
    const rawPathology = localStorage.getItem(PENDING_PATHOLOGY_LOGS_QUEUE_KEY) || '[]';
    const queueClassic = JSON.parse(rawClassic);
    const queuePathology = JSON.parse(rawPathology);
    return {
      classicQueueCount: Array.isArray(queueClassic) ? queueClassic.length : 0,
      classicQueueBytes: estimateStringBytes(rawClassic),
      pathologyQueueCount: Array.isArray(queuePathology) ? queuePathology.length : 0,
      pathologyQueueBytes: estimateStringBytes(rawPathology),
    };
  } catch {
    return {
      classicQueueCount: 0,
      classicQueueBytes: 0,
      pathologyQueueCount: 0,
      pathologyQueueBytes: 0,
    };
  }
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
