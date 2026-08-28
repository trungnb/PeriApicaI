import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLogDateParts } from '../../../utils/dateUtils';
import { BatchDeleteSuccessInfo } from '../DeleteDataModal';
import { DeleteTargetItem } from '../modals/DeleteConfirmModal';
import { AssessmentLogPayload, BugReport, PathologyAssessmentLog } from '../../../types/dental';

interface UseAdminDeleteProps {
  setDisplayLogs: React.Dispatch<React.SetStateAction<AssessmentLogPayload[]>>;
  setBugsList: React.Dispatch<React.SetStateAction<BugReport[]>>;
  setPathologyLogs: React.Dispatch<React.SetStateAction<PathologyAssessmentLog[]>>;
  fetchMetadata: (getAuthHeader: () => Record<string, string>, filter?: any) => Promise<any>;
  getAuthHeader: () => Record<string, string>;
  dateRangeFilter: { preset: string; startDate?: string; endDate?: string };
  fetchAdminData: (forceRefresh?: boolean, overrideFilter?: any, isManualClick?: boolean, queryLimit?: number, queryOffset?: number, isBackgroundLoad?: boolean) => Promise<boolean>;
}

export const useAdminDelete = ({
  setDisplayLogs,
  setBugsList,
  setPathologyLogs,
  fetchMetadata,
  getAuthHeader,
  dateRangeFilter,
  fetchAdminData
}: UseAdminDeleteProps) => {
  const { i18n } = useTranslation('admin');
  const [deleteTargetItem, setDeleteTargetItem] = useState<DeleteTargetItem | null>(null);
  const [toastNotification, setToastNotification] = useState<{ message: string; type?: 'success' | 'info' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastNotification({ message, type });
    setTimeout(() => {
      setToastNotification(null);
    }, 4000);
  }, []);

  const fetchMetadataForDateRange = useCallback(async (filter: { preset: string; startDate?: string; endDate?: string }) => {
    try {
      await fetchMetadata(getAuthHeader, filter);
    } catch (e) {
      console.warn('[AdminPortal] Error fetching date range metadata:', e);
    }
  }, [getAuthHeader, fetchMetadata]);

  const handleDeleteDocumentSuccess = useCallback((docId: string, collection: 'reports' | 'bugs' | 'seg_reports') => {
    if (collection === 'reports') {
      setDisplayLogs((prev) => {
        const next = prev.filter((item) => item.assessmentId !== docId);
        try {
          sessionStorage.setItem('admin_cached_logs', JSON.stringify(next));
        } catch {}
        return next;
      });
      fetchMetadataForDateRange(dateRangeFilter);
      showToast(
        i18n.language === 'en'
          ? `Record #${docId.slice(0, 8)} deleted successfully.`
          : `Đã xoá ca chụp #${docId.slice(0, 8)} thành công.`
      );
    } else if (collection === 'bugs') {
      setBugsList((prev) => {
        const next = prev.filter((item) => item.bugId !== docId && item.timestamp !== docId && (item as any).id !== docId);
        try {
          sessionStorage.setItem('admin_cached_bugs', JSON.stringify(next));
        } catch {}
        return next;
      });
      fetchMetadataForDateRange(dateRangeFilter);
      showToast(
        i18n.language === 'en'
          ? `Bug report #${docId.slice(0, 8)} deleted successfully.`
          : `Đã xoá báo cáo sự cố #${docId.slice(0, 8)} thành công.`
      );
    } else if (collection === 'seg_reports') {
      setPathologyLogs((prev) => {
        const next = prev.filter((item) => item.assessmentId !== docId);
        try {
          sessionStorage.setItem('admin_cached_pathology_logs', JSON.stringify(next));
        } catch {}
        return next;
      });
      fetchMetadataForDateRange(dateRangeFilter);
      showToast(
        i18n.language === 'en'
          ? `Pathology log #${docId.slice(0, 8)} deleted successfully.`
          : `Đã xoá ca bệnh lý #${docId.slice(0, 8)} thành công.`
      );
    }
  }, [dateRangeFilter, fetchMetadataForDateRange, i18n.language, setBugsList, setDisplayLogs, setPathologyLogs, showToast]);

  const handleBatchDeleteSuccess = useCallback((info?: BatchDeleteSuccessInfo) => {
    if (!info) {
      fetchAdminData(true, undefined, false);
      return;
    }

    const { deletedCount, deleteTypes, timeConfig } = info;
    const isAllTime = timeConfig?.isAllTime;
    const startDate = timeConfig?.startDate ? new Date(timeConfig.startDate) : null;
    const endDate = timeConfig?.endDate ? new Date(timeConfig.endDate) : null;
    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const isDateMatch = (timestamp?: string, createdAt?: any) => {
      if (isAllTime) return true;
      const parsed = parseLogDateParts(timestamp, createdAt);
      if (!parsed) return true;
      const logDate = new Date(parsed.year, parsed.month - 1, parsed.day);
      if (startDate && logDate < startDate) return false;
      if (endDate && logDate > endDate) return false;
      return true;
    };

    // Filter displayLogs
    if (deleteTypes.includes('all') || deleteTypes.includes('incomplete') || deleteTypes.includes('errors') || deleteTypes.includes('test')) {
      setDisplayLogs((prev) => {
        const next = prev.filter((log) => {
          if (!isDateMatch(log.timestamp, (log as any).createdAt)) return true;
          const status = log.sessionStatus || 'COMPLETED';
          const isError = (log.finalConfirmedErrors || []).length > 0;
          const isTest = (log as any)?.metadata?.isTest === true || (log.stage || '').toLowerCase().includes('test');

          if (deleteTypes.includes('all')) return false;
          if (deleteTypes.includes('incomplete') && (status === 'INCOMPLETE' || status === 'FAILED_NON_DENTAL')) return false;
          if (deleteTypes.includes('errors') && isError) return false;
          if (deleteTypes.includes('test') && isTest) return false;
          return true;
        });
        try {
          sessionStorage.setItem('admin_cached_logs', JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    // Filter bugs
    if (deleteTypes.includes('all') || deleteTypes.includes('bugs')) {
      setBugsList((prev) => {
        const next = prev.filter((b) => {
          if (!isDateMatch(b.timestamp, (b as any).createdAt)) return true;
          return false;
        });
        try {
          sessionStorage.setItem('admin_cached_bugs', JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    // Filter pathology
    if (deleteTypes.includes('all')) {
      setPathologyLogs((prev) => {
        const next = prev.filter((p) => {
          if (!isDateMatch(p.timestamp, (p as any).createdAt)) return true;
          return false;
        });
        try {
          sessionStorage.setItem('admin_cached_pathology_logs', JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    fetchMetadataForDateRange(dateRangeFilter);

    showToast(
      i18n.language === 'en'
        ? `Cleaned up ${deletedCount} records without reloading.`
        : `Đã dọn dẹp ${deletedCount} bản ghi thành công mà không cần tải lại toàn bộ.`
    );
  }, [dateRangeFilter, fetchAdminData, fetchMetadataForDateRange, i18n.language, setBugsList, setDisplayLogs, setPathologyLogs, showToast]);

  return {
    deleteTargetItem,
    setDeleteTargetItem,
    toastNotification,
    setToastNotification,
    showToast,
    handleDeleteDocumentSuccess,
    handleBatchDeleteSuccess
  };
};
