import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  FileCode,
  ShieldCheck,
  Star,
  Eye,
  Filter,
  Image as ImageIcon,
  EyeOff,
  Trash2,
  Loader2,
} from 'lucide-react';
import { PathologyAssessmentLog, SystemMetrics } from '../../types/dental';
import {
  getPathologyLabel,
  getTreatmentText,
} from '../../data/pathologyTaxonomyData';
import { getToothDisplayName } from '../../data/taxonomyData';
import { useAppStore } from '../../store/appStore';
import { useMetadataStore } from '../../store/useMetadataStore';
import { parseTimestampToMs, parseLogDateParts, formatDisplayTimestamp } from '../../utils/dateUtils';
import { ReportsFiltersBar } from './ReportsFiltersBar';
import { usePagination } from '../../hooks/usePagination';
import { PaginationControls } from '../common/PaginationControls';
import { ExportDropdown } from './ExportDropdown';
import { DatasetNoticeModal } from './modals/DatasetNoticeModal';
import { PathologyReviewModal } from './modals/PathologyReviewModal';
import { PathologyStatsCards } from './PathologyStatsCards';
import { UserDirectoryModal, UniqueUserItem } from './modals/UserDirectoryModal';
import {
  ADMIN_CACHE_KEYS,
  safeGetAdminSessionItem,
  safeSetAdminSessionItem,
} from '../../utils/adminSessionCache';

interface PathologyLogsPanelProps {
  pathologyLogs?: PathologyAssessmentLog[];
  systemMetrics?: SystemMetrics | null;
  onUnauthorized?: () => void;
  getAuthHeader?: () => Record<string, string>;
  totalPathologyCount?: number;
  onRequestDelete?: (target: { docId: string; collection: 'seg_reports'; title?: string; timestamp?: string; meta?: string }) => void;
  onDateRangeChange?: (filter: { preset: 'all' | 'today' | '7days' | '30days' | 'custom'; startDate?: string; endDate?: string }) => void;
  onLoadMore?: (collection: 'reports' | 'pathology' | 'bugs', currentLength: number) => void;
}

export const PathologyLogsPanel: React.FC<PathologyLogsPanelProps> = ({
  pathologyLogs,
  systemMetrics: propSystemMetrics,
  onUnauthorized,
  getAuthHeader: parentGetAuthHeader,
  totalPathologyCount,
  onRequestDelete,
  onDateRangeChange,
  onLoadMore,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const storeSystemMetrics = useMetadataStore((state) => state.systemMetrics);
  const systemMetrics = propSystemMetrics || storeSystemMetrics;

  const language = useAppStore((state) => state.language);
  const [logs, setLogs] = useState<PathologyAssessmentLog[]>(() => {
    if (pathologyLogs && pathologyLogs.length > 0) return pathologyLogs;
    return safeGetAdminSessionItem<PathologyAssessmentLog>(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDatasetNoticeOpen, setIsDatasetNoticeOpen] = useState(false);
  const [reviewModalLog, setReviewModalLog] = useState<PathologyAssessmentLog | null>(null);
  const [isUserDirectoryOpen, setIsUserDirectoryOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const getAuthHeader = (): Record<string, string> => {
    if (parentGetAuthHeader) {
      return parentGetAuthHeader();
    }
    const token = localStorage.getItem('admin_persistent_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const handleLogVerified = (updatedLog: PathologyAssessmentLog) => {
    setLogs((prevLogs) => {
      const newLogs = prevLogs.map((l) =>
        l.assessmentId === updatedLog.assessmentId ? { ...l, ...updatedLog } : l
      );
      safeSetAdminSessionItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS, newLogs);
      return newLogs;
    });
  };

  // Sync logs when parent passes updated pathologyLogs
  useEffect(() => {
    if (pathologyLogs && pathologyLogs.length > 0) {
      setLogs(pathologyLogs);
    }
  }, [pathologyLogs]);

  // Filters matching Luồng A (ReportsFiltersBar) exactly
  const [filterType, setFilterType] = useState<'all' | 'today' | 'day'>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'INCOMPLETE' | 'FAILED_NON_DENTAL'>('ALL');
  const PAGE_SIZE = 10;

  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    now.setDate(now.getDate() - 7);
    return now.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  const onDateRangeChangeRef = useRef(onDateRangeChange);
  useEffect(() => {
    onDateRangeChangeRef.current = onDateRangeChange;
  }, [onDateRangeChange]);

  const lastSentRangeRef = useRef<string>('');

  useEffect(() => {
    const preset = filterType === 'all' ? 'all' : filterType === 'today' ? 'today' : 'custom';
    const sDate = filterType === 'day' ? startDate : undefined;
    const eDate = filterType === 'day' ? endDate : undefined;
    const key = `${preset}:${sDate}:${eDate}`;

    if (lastSentRangeRef.current !== key) {
      lastSentRangeRef.current = key;
      if (onDateRangeChangeRef.current) {
        onDateRangeChangeRef.current({
          preset,
          startDate: sDate,
          endDate: eDate,
        });
      }
    }
  }, [filterType, startDate, endDate]);

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const authHeaders = getAuthHeader();
      const res = await fetch('/api/pathology-logs?limit=500', { headers: authHeaders });

      if (res.status === 401) {
        if (onUnauthorized) {
          onUnauthorized();
        } else {
          setError(t('sessionExpiredPleaseLog'));
        }
        return;
      }

      const data = await res.json();
      if (data && data.logs) {
        setLogs(data.logs || []);
        try {
          sessionStorage.setItem('admin_cached_pathology_logs', JSON.stringify(data.logs || []));
        } catch {}
      } else {
        setError(data?.error || (t('failedToLoadPathology')));
      }
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      setError(err?.message || (t('networkConnectionError')));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!pathologyLogs || pathologyLogs.length === 0) {
      fetchLogs();
    }
  }, []);

  const getLogStatus = (l: PathologyAssessmentLog) => {
    if (l.sessionStatus) return l.sessionStatus;
    if (l.stepStatus?.step5 || (l.stage || '').includes('Bước 5') || l.lastCompletedStep === 5) {
      return 'COMPLETED';
    }
    if (l.sessionStatus === 'FAILED_NON_DENTAL') {
      return 'FAILED_NON_DENTAL';
    }
    return 'INCOMPLETE';
  };

  // Filtered logs matching Luồng A date & status logic
  const filteredLogs = useMemo(() => {
    return logs
      .filter((log) => {
        // 1. Time Filter
        if (filterType === 'day') {
          const parsed = parseLogDateParts(log.timestamp, (log as any).updatedAt, (log as any).createdAt);
          if (parsed) {
            const logDate = new Date(parsed.year, parsed.month - 1, parsed.day);
            const start = new Date(startDate);
            const end = new Date(endDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            if (logDate < start || logDate > end) return false;
          }
        } else if (filterType === 'today') {
          const parsed = parseLogDateParts(log.timestamp, (log as any).updatedAt, (log as any).createdAt);
          if (parsed) {
            const logDate = new Date(parsed.year, parsed.month - 1, parsed.day);
            const today = new Date();
            const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
            if (logDate < start || logDate > end) return false;
          } else {
            return false;
          }
        }

        // 2. Status Filter
        if (statusFilter !== 'ALL') {
          const status = getLogStatus(log);
          if (status !== statusFilter) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const msA = parseTimestampToMs(a.timestamp, (a as any).updatedAt, (a as any).createdAt);
        const msB = parseTimestampToMs(b.timestamp, (b as any).updatedAt, (b as any).createdAt);
        return msB - msA;
      });
  }, [logs, filterType, startDate, endDate, statusFilter]);

  // Reset pagination on filter change
  const { currentPage, setCurrentPage, totalPages } = usePagination(filteredLogs, PAGE_SIZE, totalPathologyCount);

  useEffect(() => {
    if (currentPage * PAGE_SIZE >= logs.length && logs.length < (totalPathologyCount || 0)) {
      if (onLoadMore) {
        onLoadMore('pathology', logs.length);
      }
    }
  }, [currentPage, logs.length, totalPathologyCount, onLoadMore]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, statusFilter, startDate, endDate, setCurrentPage]);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage, PAGE_SIZE]);

  // Summary statistics & User directory statistics
  const hasStatusFilter = statusFilter !== 'ALL';
  const {
    stats,
    uniqueUsersCount,
    todayUsersCount,
    uniqueUsersList,
    sortedPathologyCounts,
    totalPathologyOccurrences,
    invalidImageCount,
  } = useMemo(() => {
    if (!hasStatusFilter && systemMetrics?.pathology) {
      const p = systemMetrics.pathology;
      const totalSessions = p.totalPathologyLogs;
      const completedCount = p.completedCount;
      const incompleteCount = p.incompleteCount;
      const invalidImageCount = p.invalidImageCount;
      const adminVerifiedCount = p.verifiedCount;
      const completionRate = totalSessions > 0 ? Math.round((completedCount / totalSessions) * 100) : 0;
      const totalPathologyOccurrences = Object.values(p.pathologyDistribution || {}).reduce((a, b) => a + b, 0);
      const sortedPathologyCounts = Object.entries(p.pathologyDistribution || {}).sort((a, b) => b[1] - a[1]);
      const uniqueUsersList: UniqueUserItem[] = (p.userList || []).map(u => ({
        userId: u.deviceId,
        totalSessions: u.totalUploads,
        completedSessions: u.totalUploads,
        lastActive: formatDisplayTimestamp(u.lastActive),
        lastTooth: 'N/A',
      }));

      return {
        stats: {
          totalSessions,
          completedCount,
          incompleteCount,
          adminVerifiedCount,
          completionRate,
        },
        uniqueUsersCount: p.uniqueUsersCount,
        todayUsersCount: p.todayUsersCount,
        uniqueUsersList,
        sortedPathologyCounts,
        totalPathologyOccurrences,
        invalidImageCount,
      };
    }

    const totalSessions = (!hasStatusFilter && totalPathologyCount) ? totalPathologyCount : logs.length;
    const completedCount = logs.filter((l) => getLogStatus(l) === 'COMPLETED').length;
    const incompleteCount = logs.filter((l) => getLogStatus(l) === 'INCOMPLETE').length;
    const invalidImageCount = logs.filter((l) => getLogStatus(l) === 'FAILED_NON_DENTAL').length;
    const adminVerifiedCount = logs.filter((l) => Boolean(l.isReviewedByAdmin || l.verifiedBy)).length;
    let totalPathologyOccurrences = 0;
    const countByKey: Record<string, number> = {};

    const userMap = new Map<string, { deviceId: string; totalUploads: number; lastActive: string; firstActive: string }>();

    logs.forEach((l) => {
      const devId = (l as any).deviceId || (l as any).userId || l.assessmentId.substring(0, 8);
      const existing = userMap.get(devId);
      if (existing) {
        existing.totalUploads += 1;
        if (l.timestamp > existing.lastActive) existing.lastActive = l.timestamp;
        if (l.timestamp < existing.firstActive) existing.firstActive = l.timestamp;
      } else {
        userMap.set(devId, {
          deviceId: devId,
          totalUploads: 1,
          lastActive: l.timestamp,
          firstActive: l.timestamp,
        });
      }

      const activePaths = l.finalConfirmedPathologies || l.confirmedPathologies || l.detectedPathologies || [];
      activePaths.forEach((p) => {
        totalPathologyOccurrences++;
        const key = p.pathologyKey || (p as any).key;
        if (key) {
          countByKey[key] = (countByKey[key] || 0) + 1;
        }
      });
    });

    const uniqueUsersList: UniqueUserItem[] = Array.from(userMap.values()).map(u => ({
      userId: u.deviceId,
      totalSessions: u.totalUploads,
      completedSessions: u.totalUploads,
      lastActive: formatDisplayTimestamp(u.lastActive),
      lastTooth: 'N/A'
    }));
    const uniqueUsersCount = uniqueUsersList.length;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayUsersCount = uniqueUsersList.filter((u) => u.lastActive.startsWith(todayStr)).length;

    const sortedPathologyCounts = Object.entries(countByKey).sort((a, b) => b[1] - a[1]);
    const completionRate = totalSessions > 0 ? Math.round((completedCount / totalSessions) * 100) : 0;

    return {
      stats: {
        totalSessions,
        completedCount,
        incompleteCount,
        adminVerifiedCount,
        completionRate,
      },
      uniqueUsersCount,
      todayUsersCount,
      uniqueUsersList,
      sortedPathologyCounts,
      totalPathologyOccurrences,
      invalidImageCount,
    };
  }, [logs, hasStatusFilter, systemMetrics]);

  // Export CSV (Excel compatible with UTF-8 BOM)
  const exportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = [
      'Assessment ID',
      'Timestamp',
      'Status',
      'Tooth FDI',
      'Tooth Area',
      'Technique',
      'Receptor',
      'Anomalies Count',
      'Detected Anomalies',
      'Treatment Guidance',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes'
    ];

    const escapeCsvCell = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredLogs.map((log) => {
      const toothFdi = log.tooth?.fdiNumber || '';
      const arch = log.tooth?.arch === 'Maxilla' ? 'Maxilla' : (log.tooth?.arch === 'Mandible' ? 'Mandible' : '');
      const statusStr = getLogStatus(log) === 'COMPLETED' ? 'COMPLETED' : (getLogStatus(log) === 'FAILED_NON_DENTAL' ? 'FAILED_NON_DENTAL' : 'INCOMPLETE');
      
      const pathList = (log.confirmedPathologies || [])
        .map((p) => `${getPathologyLabel(p.pathologyKey, language)} (${p.confidence}%)`)
        .join('; ');
      const treatList = (log.confirmedPathologies || [])
        .map((p) => `${getPathologyLabel(p.pathologyKey, language)}: ${getTreatmentText(p.pathologyKey, language)}`)
        .join(' | ');

      const isAdmin = Boolean(log.isReviewedByAdmin || log.verifiedBy === 'Admin' || log.verifiedNotes?.includes('Admin'));

      return [
        log.assessmentId || '',
        log.timestamp || '',
        statusStr,
        toothFdi,
        arch,
        log.technique || '',
        log.receptorType || '',
        (log.confirmedPathologies?.length || 0).toString(),
        pathList,
        treatList,
        log.userNotes || '',
        log.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        log.verifiedNotes || '',
      ].map(escapeCsvCell);
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `PeriApical_Pathology_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const getReportsDataForGoogleSheets = () => {
    const headers = [
      'Assessment ID',
      'Timestamp',
      'Status',
      'Tooth FDI',
      'Tooth Area',
      'Technique',
      'Receptor',
      'Anomalies Count',
      'Detected Anomalies',
      'Treatment Guidance',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes'
    ];

    const rows = filteredLogs.map((log) => {
      const toothFdi = log.tooth?.fdiNumber || '';
      const arch = log.tooth?.arch === 'Maxilla' ? 'Maxilla' : (log.tooth?.arch === 'Mandible' ? 'Mandible' : '');
      const statusStr = getLogStatus(log) === 'COMPLETED' ? 'COMPLETED' : (getLogStatus(log) === 'FAILED_NON_DENTAL' ? 'FAILED_NON_DENTAL' : 'INCOMPLETE');
      
      const pathList = (log.confirmedPathologies || [])
        .map((p) => `${getPathologyLabel(p.pathologyKey, language)} (${p.confidence}%)`)
        .join('; ');
      const treatList = (log.confirmedPathologies || [])
        .map((p) => `${getPathologyLabel(p.pathologyKey, language)}: ${getTreatmentText(p.pathologyKey, language)}`)
        .join(' | ');

      const isAdmin = Boolean(log.isReviewedByAdmin || log.verifiedBy === 'Admin' || log.verifiedNotes?.includes('Admin'));

      return [
        log.assessmentId || '',
        log.timestamp || '',
        statusStr,
        toothFdi,
        arch,
        log.technique || '',
        log.receptorType || '',
        (log.confirmedPathologies?.length || 0).toString(),
        pathList,
        treatList,
        log.userNotes || '',
        log.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        log.verifiedNotes || '',
      ];
    });

    const now = new Date();
    const formattedDate = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;

    return {
      title: `PeriApical_Pathology_Logs_${formattedDate}`,
      headers,
      rows,
    };
  };

  return (
    <div className="space-y-4 text-xs text-slate-800 dark:text-slate-200">
      {/* ── Filters Bar (Identical to Luồng A) ── */}
      <ReportsFiltersBar
        language={language}
        filterType={filterType}
        setFilterType={setFilterType}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
      />

      {/* ── Top Pathology & User Stats Cards (Identical layout to Luồng A) ── */}
      <PathologyStatsCards
        language={language}
        uniqueUsersCount={uniqueUsersCount}
        todayUsersCount={todayUsersCount}
        totalSessions={stats.totalSessions}
        completionRate={stats.completionRate}
        completedCount={stats.completedCount}
        incompleteCount={stats.incompleteCount}
        invalidImageCount={invalidImageCount}
        adminVerifiedCount={stats.adminVerifiedCount}
        sortedPathologyCounts={sortedPathologyCounts}
        totalPathologyOccurrences={totalPathologyOccurrences}
        onOpenUserDirectory={() => setIsUserDirectoryOpen(true)}
      />

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Assessment Record Table (Identical Layout & Buttons to Luồng A) ── */}
      <div className="bg-white dark:bg-blue-950/80 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs overflow-hidden flex flex-col flex-1 min-h-[400px]">
        {/* Header Bar */}
        <div className="p-3 border-b border-slate-200 dark:border-blue-800/70 flex items-center justify-between bg-slate-50 dark:bg-blue-900/40 shrink-0">
          <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-200 text-xs font-bold">
            <Filter className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            <span>
              {t('recordList')} ({filteredLogs.length} {t('results')})
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsDatasetNoticeOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shadow-xs border border-amber-400/30"
              title={t('exportAnomaliesLabelledJson')}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{t('exportAiTrainingDataset')}</span>
            </button>

            <ExportDropdown
              disabled={filteredLogs.length === 0}
              language={language}
              onExportCsv={exportCsv}
              getDataForGoogleSheets={getReportsDataForGoogleSheets}
              headerColor={{ red: 0.08, green: 0.45, blue: 0.45 }}
            />
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap">
            <thead className="bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-blue-200/80 sticky top-0 z-10 shadow-xs font-semibold uppercase text-[10px] border-b border-slate-200 dark:border-blue-800/60">
              <tr>
                <th className="px-4 py-3">{t('caseId')}</th>
                <th className="px-4 py-3">{t('timestamp')}</th>
                <th className="px-4 py-3">{t('toothArea')}</th>
                <th className="px-4 py-3">{t('image')}</th>
                <th className="px-4 py-3">{t('status')}</th>
                <th className="px-4 py-3">{t('anomaliesDetected')}</th>
                <th className="px-4 py-3">{t('actionsAdminGround')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-blue-900/50">
              {isLoading && paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400 dark:text-blue-300/60">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500 mx-auto mb-2" />
                    <span>{t('loading', 'Đang tải dữ liệu...')}</span>
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 dark:text-blue-300/60">
                    {t('noMatchingRecordsFound')}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log, idx) => {
                  const status = getLogStatus(log);
                  let statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-blue-900/60 text-slate-700 dark:text-blue-200 border border-slate-200 dark:border-slate-700/60">
                      {t('processing5')}
                    </span>
                  );

                  if (status === 'COMPLETED') {
                    statusBadge = (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                        {t('Completed')}
                      </span>
                    );
                  } else if (status === 'INCOMPLETE') {
                    const stepNum = log.lastCompletedStep || 4;
                    statusBadge = (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                        ⏱ {t('incomplete')} ({t('step')} {stepNum})
                      </span>
                    );
                  } else if (status === 'FAILED_NON_DENTAL') {
                    statusBadge = (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                        {t('InvalidImage')}
                      </span>
                    );
                  }

                  const activePathologies = log.finalConfirmedPathologies || log.confirmedPathologies || log.detectedPathologies || [];
                  const isVerified = Boolean(
                    log.isReviewedByAdmin ||
                    log.verifiedBy === 'Admin' ||
                    log.verifiedNotes?.includes('Admin')
                  );

                  return (
                    <tr
                      key={log.assessmentId || idx}
                      className="hover:bg-blue-50/50 dark:hover:bg-blue-900/40 transition-colors group"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300" title={log.assessmentId}>
                        <span className="font-semibold">{log.assessmentId?.substring(0, 14)}...</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-blue-300/80 font-mono whitespace-nowrap">
                        {formatDisplayTimestamp(log.timestamp)}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium">
                        {log.tooth?.fdiNumber ? `${t('tooth')} ${log.tooth.fdiNumber}` : t('unselected')} <br />
                        <span className="text-[10px] text-slate-500 dark:text-blue-300/60 font-normal">
                          ({log.tooth ? getToothDisplayName(log.tooth, language) : log.technique || 'Paralleling'})
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="relative inline-flex items-center space-x-1.5">
                          {log.imageUrl ? (
                            <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 inline-flex items-center space-x-1 border border-emerald-200 dark:border-emerald-700/80 shadow-2xs">
                              <ImageIcon className="w-3 h-3" />
                              <span>{t('stored')}</span>
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-slate-400 inline-flex items-center space-x-1 border border-slate-200 dark:border-blue-800">
                              <EyeOff className="w-3 h-3" />
                              <span>{t('noImage')}</span>
                            </span>
                          )}
                          {isVerified && (
                            <span
                              title={t('checkedByAdmin')}
                              className="p-1 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 inline-flex items-center justify-center cursor-help"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          {statusBadge}
                          {log.sessionStatus && (
                            <span className="text-[10px] font-mono text-slate-400 dark:text-blue-300/60">
                              {log.sessionStatus}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-[220px] truncate">
                        {activePathologies.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {activePathologies.map((p, pIdx) => {
                              const label = getPathologyLabel(p.pathologyKey || (p as any).key, language);
                              return (
                                <span
                                  key={pIdx}
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800/80"
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">
                            {t('noPathologies')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setReviewModalLog(log)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{t('reviewConfirm')}</span>
                          </button>
                          {onRequestDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                onRequestDelete({
                                  docId: log.assessmentId,
                                  collection: 'seg_reports',
                                  title: `Báo cáo bất thường #${log.assessmentId.slice(0, 8)}`,
                                  timestamp: formatDisplayTimestamp(log.timestamp),
                                  meta: `Răng: ${log.tooth?.fdiNumber || 'N/A'} - Bất thường: ${activePathologies.length}`,
                                });
                              }}
                              className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer shadow-2xs"
                              title={language === 'EN' ? 'Delete this pathology record' : 'Xoá ca chụp bất thường này'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination Controls */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLogs.length}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </div>

      <DatasetNoticeModal
        isOpen={isDatasetNoticeOpen}
        onClose={() => setIsDatasetNoticeOpen(false)}
        language={language}
      />

      <PathologyReviewModal
        selectedLog={reviewModalLog}
        onClose={() => setReviewModalLog(null)}
        language={language}
        getAuthHeader={getAuthHeader}
        onLogVerified={handleLogVerified}
        setToastMsg={setToastMsg}
        onRequestDelete={onRequestDelete}
      />

      <UserDirectoryModal
        isOpen={isUserDirectoryOpen}
        onClose={() => setIsUserDirectoryOpen(false)}
        language={language}
        uniqueUsersList={uniqueUsersList}
      />

      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[110] p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-amber-500/40 flex items-center space-x-3 text-xs font-semibold animate-in fade-in slide-in-from-bottom-5">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
