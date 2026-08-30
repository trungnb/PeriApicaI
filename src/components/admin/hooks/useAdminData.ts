import { useState, useCallback, useEffect } from 'react';
import { AssessmentLogPayload, BugReport, PathologyAssessmentLog } from '../../../types/dental';
import { getAdminToken } from '../../../utils/adminAuthUtils';
import { useTranslation } from 'react-i18next';
import { useMetadataStore } from '../../../store/useMetadataStore';
import {
  ADMIN_CACHE_KEYS,
  safeGetAdminSessionItem,
  safeSetAdminSessionItem,
} from '../../../utils/adminSessionCache';

export const useAdminData = (logout: () => void) => {
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
  const [resetInfoStr, setResetInfoStr] = useState<string>('');
  const [isFirebaseStorage, setIsFirebaseStorage] = useState<boolean>(true);

  const [dateRangeFilter, setDateRangeFilter] = useState<{
    preset: 'all' | 'today' | '7days' | '30days' | 'custom';
    startDate?: string;
    endDate?: string;
  }>({ preset: 'all' });

  const setSystemMetrics = useMetadataStore(state => state.setSystemMetrics);
  const fetchMetadata = useMetadataStore(state => state.fetchMetadata);
  const systemMetrics = useMetadataStore(state => state.systemMetrics);

  const getResetTimeInfo = useCallback(() => {
    const now = new Date();
    const resetDate = new Date();
    resetDate.setHours(14, 0, 0, 0); // 14:00 ICT (UTC+7)
    if (now >= resetDate) {
      resetDate.setDate(resetDate.getDate() + 1);
    }
    const diffMs = resetDate.getTime() - now.getTime();
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (i18n.language === 'en') {
      return `Reset in ${diffHrs}h ${diffMins}m (at 2 PM UTC+7)`;
    }
    return `Đặt lại sau ${diffHrs} giờ ${diffMins} phút (vào 14:00 giờ Việt Nam)`;
  }, [i18n.language]);

  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = getAdminToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(cooldownSeconds - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const fetchAdminData = useCallback(async (
    forceRefresh = false, 
    overrideFilter?: { preset: string; startDate?: string; endDate?: string },
    isManualClick = false,
    queryLimit?: number,
    queryOffset?: number,
    isBackgroundLoad = false
  ): Promise<boolean> => {
    const token = getAdminToken();
    if (!token) {
      return false;
    }

    if (queryLimit === undefined) queryLimit = 100;
    if (queryOffset === undefined) queryOffset = 0;

    setSyncErrorMessage(null);

    if (isManualClick) {
      if (cooldownSeconds > 0) {
        const errMsg = i18n.language === 'en'
          ? `You can only refresh once every 10 seconds. Please wait ${cooldownSeconds}s.`
          : `Bạn chỉ có thể làm mới tối đa 1 lần mỗi 10 giây để bảo vệ tài nguyên Database. Vui lòng đợi ${cooldownSeconds} giây.`;
        setSyncErrorMessage(errMsg);
        return false;
      }
      setCooldownSeconds(10);
    }

    setIsSyncing(true);
    try {
      const activeFilter = overrideFilter || dateRangeFilter;
      const params = new URLSearchParams();
      if (forceRefresh) params.append('force', 'true');
      if (activeFilter.preset) params.append('preset', activeFilter.preset);
      if (activeFilter.startDate) params.append('startDate', activeFilter.startDate);
      if (activeFilter.endDate) params.append('endDate', activeFilter.endDate);
      if (queryLimit !== undefined) params.append('limit', queryLimit.toString());
      if (queryOffset !== undefined) params.append('offset', queryOffset.toString());

      let url = `/api/firestore-data?${params.toString()}`;
      let res = await fetch(url, {
        headers: getAuthHeader(),
      });

      if (res.status === 401) {
        logout();
        return false;
      }

      if (res.status === 429 && !isManualClick) {
        const fallbackParams = new URLSearchParams();
        if (activeFilter.preset) fallbackParams.append('preset', activeFilter.preset);
        if (activeFilter.startDate) fallbackParams.append('startDate', activeFilter.startDate);
        if (activeFilter.endDate) fallbackParams.append('endDate', activeFilter.endDate);
        if (queryLimit !== undefined) fallbackParams.append('limit', queryLimit.toString());
        if (queryOffset !== undefined) fallbackParams.append('offset', queryOffset.toString());
        res = await fetch(`/api/firestore-data?${fallbackParams.toString()}`, {
          headers: getAuthHeader(),
        });
      }

      const data = await res.json();
      
      if (data.success) {
        const logs = data.logs || [];
        const bugs = data.bugs || [];
        const pathology = data.pathologyLogs || [];

        if (queryOffset && queryOffset > 0) {
          setBugsList(prev => {
            const merged = [...prev, ...bugs];
            return Array.from(new Map(merged.map(item => [item.bugId, item])).values());
          });
          setDisplayLogs(prev => {
            const merged = [...prev, ...logs];
            return Array.from(new Map(merged.map(item => [item.assessmentId, item])).values());
          });
          setPathologyLogs(prev => {
            const merged = [...prev, ...pathology];
            return Array.from(new Map(merged.map(item => [item.assessmentId, item])).values());
          });
        } else {
          setBugsList(bugs);
          setDisplayLogs(logs);
          setPathologyLogs(pathology);
          
          if (!isBackgroundLoad) {
            safeSetAdminSessionItem(ADMIN_CACHE_KEYS.BUGS, bugs);
            safeSetAdminSessionItem(ADMIN_CACHE_KEYS.LOGS, logs);
            safeSetAdminSessionItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS, pathology);
          }
        }
        
        if (data.systemMetrics) {
          setSystemMetrics(data.systemMetrics, getAuthHeader, activeFilter);
        }
        setIsFirebaseStorage(data.isFirebase !== false);
        setQuotaLocked(false);
        return true;
      } else {
        const errorMsg = (data.error || '').toLowerCase();
        if (data.quotaExhausted || errorMsg.includes('resource_exhausted') || errorMsg.includes('firestore_quota') || (errorMsg.includes('quota') && !errorMsg.includes('10 giây') && !errorMsg.includes('10 seconds'))) {
          setQuotaLocked(true);
          setResetInfoStr(getResetTimeInfo());
        }
        setSyncErrorMessage(data.error || (i18n.language === 'en' ? 'Data fetch failed.' : 'Lỗi tải dữ liệu.'));
        
        setDisplayLogs((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.LOGS)));
        setBugsList((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.BUGS)));
        setPathologyLogs((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS)));
        return false;
      }
    } catch (unknownError: unknown) {
      const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.warn('[AdminPortal] Error fetching server data:', err);
      const errStr = (err?.message || '').toLowerCase();
      if (errStr.includes('quota') || errStr.includes('resource_exhausted') || errStr.includes('429') || errStr.includes('limit')) {
        setQuotaLocked(true);
        setResetInfoStr(getResetTimeInfo());
      }
      setSyncErrorMessage(err?.message || (i18n.language === 'en' ? 'Data fetch failed.' : 'Lỗi tải dữ liệu.'));
      
      setDisplayLogs((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.LOGS)));
      setBugsList((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.BUGS)));
      setPathologyLogs((prev) => (prev.length > 0 ? prev : safeGetAdminSessionItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS)));
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [dateRangeFilter, getAuthHeader, i18n.language, logout, getResetTimeInfo, cooldownSeconds, setSystemMetrics]);

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
    fetchMetadata,
    getAuthHeader,
    quotaLocked,
    setQuotaLocked,
    resetInfoStr,
    isFirebaseStorage,
    cooldownSeconds,
    systemMetrics
  };
};
