import { useState, useCallback, useEffect, useRef } from 'react';
import { AssessmentLogPayload, BugReport, PathologyAssessmentLog } from '../../../types/dental';
import { getAdminToken } from '../../../utils/adminAuthUtils';
import { useTranslation } from 'react-i18next';
import { useMetadataStore } from '../../../store/useMetadataStore';
import {
  ADMIN_CACHE_KEYS,
  safeGetAdminSessionItem,
  safeSetAdminSessionItem,
} from '../../../utils/adminSessionCache';

export const useAdminData = (logout: () => void, isAdminReadReady = false) => {
  type AdminCaseScope = 'reports' | 'pathology' | 'bugs';
  const { i18n } = useTranslation('admin');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [bugsList, setBugsList] = useState<BugReport[]>(() =>
    safeGetAdminSessionItem<BugReport>(ADMIN_CACHE_KEYS.BUGS)
  );
  const [displayLogs, setDisplayLogs] = useState<AssessmentLogPayload[]>(() =>
    safeGetAdminSessionItem<AssessmentLogPayload>(ADMIN_CACHE_KEYS.LOGS)
  );
  const [pathologyLogs, setPathologyLogs] = useState<PathologyAssessmentLog[]>(() =>
    safeGetAdminSessionItem<PathologyAssessmentLog>(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS)
  );
  
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [quotaLocked, setQuotaLocked] = useState<boolean>(false);
  const [resetInfoStr] = useState<string>('14:00');
  const [isFirebaseStorage] = useState<boolean>(true);
  const [hasMoreByScope, setHasMoreByScope] = useState<Record<AdminCaseScope, boolean>>({
    reports: false,
    pathology: false,
    bugs: false,
  });
  const nextCursorByScope = useRef<Partial<Record<AdminCaseScope, string | null>>>({});
  const inFlightCaseReads = useRef(new Map<string, Promise<boolean>>());
  const completedCaseReads = useRef(new Map<string, {
    records: any[];
    hasMore: boolean;
    nextCursor: string | null;
  }>());
  const caseReadSession = useRef<string | null>(null);

  const [dateRangeFilter, setDateRangeFilter] = useState<{
    preset: 'all' | 'today' | '7days' | '30days' | 'custom';
    startDate?: string;
    endDate?: string;
  }>({ preset: 'all' });

  const fetchMetadata = useMetadataStore(state => state.fetchMetadata);
  const systemMetrics = useMetadataStore(state => state.systemMetrics);

  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = getAdminToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, []);

  const fetchAdminCases = useCallback(async (
    scope: AdminCaseScope,
    overrideFilter?: { preset: string; startDate?: string; endDate?: string },
    append = false,
    isManualClick = false,
  ): Promise<boolean> => {
    if (!isAdminReadReady) return false;
    const token = getAdminToken();
    if (!token) return false;

    // A token change starts a new authenticated view. Never reuse records
    // fetched for a previous Admin session.
    if (caseReadSession.current !== token) {
      caseReadSession.current = token;
      inFlightCaseReads.current.clear();
      completedCaseReads.current.clear();
      nextCursorByScope.current = {};
    }

    const activeFilter = overrideFilter || dateRangeFilter;
    const cursor = append ? nextCursorByScope.current[scope] : undefined;
    if (append && !cursor) return false;

    // Use append/set rather than the record constructor. Some browser
    // implementations reject object-form URLSearchParams before fetch runs.
    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('preset', activeFilter.preset || 'all');
    if (activeFilter.startDate) params.append('startDate', activeFilter.startDate);
    if (activeFilter.endDate) params.append('endDate', activeFilter.endDate);
    if (cursor) params.append('cursor', cursor);
    const requestKey = `${scope}?${params.toString()}`;
    const pending = inFlightCaseReads.current.get(requestKey);
    if (pending) return pending;

    const applyResult = (data: { records: any[]; hasMore: boolean; nextCursor: string | null }) => {
      const records = data.records || [];
      const mergeBy = (items: any[], id: (item: any) => string) => Array.from(new Map(items.map(item => [id(item), item])).values());
      if (scope === 'reports') {
        setDisplayLogs(previous => append ? mergeBy([...previous, ...records], item => item.assessmentId) : records);
        if (!append) safeSetAdminSessionItem(ADMIN_CACHE_KEYS.LOGS, records);
      } else if (scope === 'pathology') {
        setPathologyLogs(previous => append ? mergeBy([...previous, ...records], item => item.assessmentId) : records);
        if (!append) safeSetAdminSessionItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS, records);
      } else {
        setBugsList(previous => append ? mergeBy([...previous, ...records], item => item.bugId) : records);
        if (!append) safeSetAdminSessionItem(ADMIN_CACHE_KEYS.BUGS, records);
      }
      nextCursorByScope.current[scope] = data.nextCursor || null;
      setHasMoreByScope(previous => ({ ...previous, [scope]: Boolean(data.hasMore) }));
    };

    // Effects can replay during development StrictMode or after a lazy tab
    // initializes. A completed equivalent read is a logical cache hit; apply
    // the same result without issuing a second network request. Manual refresh
    // deliberately bypasses this cache.
    const completed = !isManualClick ? completedCaseReads.current.get(requestKey) : undefined;
    if (completed) {
      applyResult(completed);
      return true;
    }

    const request = (async () => {
      setSyncErrorMessage(null);
      if (isManualClick) {
        if (cooldownSeconds > 0) {
          setSyncErrorMessage(i18n.language === 'en'
            ? `You can only refresh once every 10 seconds. Please wait ${cooldownSeconds}s.`
            : `Bạn chỉ có thể làm mới tối đa 1 lần mỗi 10 giây. Vui lòng đợi ${cooldownSeconds} giây.`);
          return false;
        }
        setCooldownSeconds(10);
      }

      setIsSyncing(true);
      try {
        const res = await fetch(`/api/admin/cases/${scope}?${params.toString()}`, { headers: getAuthHeader() });
        if (res.status === 401) {
          logout();
          return false;
        }
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          setSyncErrorMessage(i18n.language === 'en'
            ? `Request is rate-limited. Try again${retryAfter ? ` in ${retryAfter}s` : ' later'}.`
            : `Yêu cầu đang bị giới hạn. Vui lòng thử lại${retryAfter ? ` sau ${retryAfter} giây` : ' sau'}.`);
          return false;
        }

        const data = await res.json();
        if (!data.success) {
          setSyncErrorMessage(data.error || (i18n.language === 'en' ? 'Data fetch failed.' : 'Lỗi tải dữ liệu.'));
          return false;
        }

        const result = {
          records: data.records || [],
          hasMore: Boolean(data.hasMore),
          nextCursor: data.nextCursor || null,
        };
        completedCaseReads.current.set(requestKey, result);
        applyResult(result);
        setQuotaLocked(false);
        return true;
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        setSyncErrorMessage(err.message || (i18n.language === 'en' ? 'Data fetch failed.' : 'Lỗi tải dữ liệu.'));
        return false;
      } finally {
        setIsSyncing(false);
      }
    })();

    inFlightCaseReads.current.set(requestKey, request);
    try {
      return await request;
    } finally {
      inFlightCaseReads.current.delete(requestKey);
    }
  }, [cooldownSeconds, dateRangeFilter, getAuthHeader, i18n.language, isAdminReadReady, logout]);

  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(cooldownSeconds - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  // Compatibility shim for delete flows that previously refreshed every
  // collection. New Admin UI code always selects its scope explicitly.
  const fetchAdminData = useCallback((
    _forceRefresh = false,
    overrideFilter?: { preset: string; startDate?: string; endDate?: string },
    isManualClick = false,
    _queryLimit?: number,
    queryOffset?: number,
  ): Promise<boolean> => fetchAdminCases(
    'reports',
    overrideFilter,
    Boolean(queryOffset && queryOffset > 0),
    isManualClick,
  ), [fetchAdminCases]);

  return {
    isSyncing,
    setIsSyncing,
    bugsList,
    setBugsList,
    displayLogs,
    setDisplayLogs,
    pathologyLogs,
    setPathologyLogs,
    syncErrorMessage,
    setSyncErrorMessage,
    dateRangeFilter,
    setDateRangeFilter,
    fetchAdminData,
    fetchAdminCases,
    fetchMetadata,
    getAuthHeader,
    quotaLocked,
    setQuotaLocked,
    resetInfoStr,
    isFirebaseStorage,
    cooldownSeconds,
    hasMoreByScope,
    systemMetrics
  };
};
