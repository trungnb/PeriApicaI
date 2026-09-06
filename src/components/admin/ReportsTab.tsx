import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, FileCode, Lock, Image as ImageIcon, ShieldCheck, EyeOff, Star, Eye, Trash2 } from 'lucide-react';
import { AssessmentLogPayload, SystemMetrics } from '../../types/dental';
import { getTaxonomyLabel, getTechniqueDisplayName } from '../../data/taxonomyData';
import { parseTimestampToMs, formatDisplayTimestamp, parseLogDateParts } from '../../utils/dateUtils';
import { useAppStore } from '../../store/appStore';
import { useMetadataStore } from '../../store/useMetadataStore';
import { AccuracyCategory, getAccuracyCategory, ACCURACY_CATEGORY_CONFIG, isLogAdminVerified } from '../../utils/reportUtils';
import { ExportDropdown } from './ExportDropdown';
import { ReportsFiltersBar } from './ReportsFiltersBar';
import { ReportsStatsCards } from './ReportsStatsCards';
import { ReviewDetailModal } from './modals/ReviewDetailModal';
import { UserDirectoryModal, UniqueUserItem } from './modals/UserDirectoryModal';
import { usePagination } from '../../hooks/usePagination';
import { PaginationControls } from '../common/PaginationControls';
import { createEvaluationExportBundle } from '../../utils/evaluationExport';
import { isResearchImageStorageAvailable, getTrainingExportLockedMessage } from '../../utils/researchStorageCapability';

interface ReportsTabProps {
  displayLogs: AssessmentLogPayload[];
  systemMetrics?: SystemMetrics | null;
  getAuthHeader: () => Record<string, string>;
  totalLogsCount?: number;
  onRequestDelete?: (target: { docId: string; collection: 'reports'; title?: string; timestamp?: string; meta?: string }) => void;
  onDateRangeChange?: (filter: { preset: 'all' | 'today' | '7days' | '30days' | 'custom'; startDate?: string; endDate?: string }) => void;
  onLoadMore?: (collection: 'reports' | 'pathology' | 'bugs', currentLength: number) => void;
  hasMore?: boolean;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  displayLogs: initialDisplayLogs,
  systemMetrics: propSystemMetrics,
  getAuthHeader,
  totalLogsCount,
  onRequestDelete,
  onDateRangeChange,
  onLoadMore,
  hasMore = false,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const language = useAppStore((state) => state.language);
  const storeSystemMetrics = useMetadataStore((state) => state.systemMetrics);
  const systemMetrics = propSystemMetrics || storeSystemMetrics;
  const [logsList, setLogsList] = useState<AssessmentLogPayload[]>(initialDisplayLogs);
  const [isUserDirectoryOpen, setIsUserDirectoryOpen] = useState<boolean>(false);

  useEffect(() => {
    setLogsList(initialDisplayLogs);
  }, [initialDisplayLogs]);

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

  // Modal Review & Admin Edit State
  const [selectedLogForReview, setSelectedLogForReview] = useState<AssessmentLogPayload | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const parseLogDate = (log: AssessmentLogPayload) => {
    return parseLogDateParts(log.timestamp, (log as any).updatedAt, (log as any).createdAt);
  };

  const getAccuracyLabel = (category: AccuracyCategory): string => {
    switch (category) {
      case 'EXACT_MATCH':
        return t('exactMatch', { defaultValue: language === 'VI' ? 'Đồng thuận hoàn toàn' : 'Exact Match' });
      case 'MOSTLY_ACCURATE':
        return t('mostlyAccurate', { defaultValue: language === 'VI' ? 'Đồng thuận phần lớn' : 'Mostly Accurate' });
      case 'PARTIALLY_ACCURATE':
        return t('partiallyAccurate', { defaultValue: language === 'VI' ? 'Đồng thuận một phần' : 'Partially Accurate' });
      case 'INACCURATE':
        return t('inaccurate', { defaultValue: language === 'VI' ? 'Không đồng thuận' : 'Inaccurate' });
      default:
        return category;
    }
  };

  const getLogStatus = (l: AssessmentLogPayload) => {
    if (l.sessionStatus) return l.sessionStatus;
    const errors = l.finalConfirmedErrors || [];
    const notesStr = (l.userValidation?.userNotes || l.userNotes || '').toLowerCase();
    if (errors.includes('not_periapical') || notesStr.includes('không phải là phim x-quang cận chóp')) {
      return 'FAILED_NON_DENTAL';
    }
    if (l.stepStatus?.step5 || (l.stage || '').includes('Bước 5') || notesStr.includes('hoàn tất')) {
      return 'COMPLETED';
    }
    return 'INCOMPLETE';
  };

  const exportEvaluationJson = () => {
    if (!isResearchImageStorageAvailable()) {
      setToastMsg(getTrainingExportLockedMessage(language));
      return;
    }
    const isPartial = filterType !== 'all' || statusFilter !== 'ALL' || (totalLogsCount !== undefined && filteredLogs.length !== totalLogsCount);
    const bundle = createEvaluationExportBundle({
      technical: filteredLogs,
      scope: {
        modality: 'technical',
        filters: { timeFilter: filterType, statusFilter, startDate: filterType === 'day' ? startDate : undefined, endDate: filterType === 'day' ? endDate : undefined },
        isPartial,
      },
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `periapical_technical_evaluation_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const {
    timeFilteredLogs,
    totalUploadsCount,
    completedAnalysesCount,
    incompleteAnalysesCount,
    invalidImageUploadsCount,
    completionRate,
    exactMatchRate,
    accuracyScoreCounts,
    sortedErrorCounts,
    totalConfirmedErrorsCount,
    uniqueUsersList,
    uniqueUsersCount,
    todayUsersCount,
  } = useMemo(() => {
    const timeFilteredLogs = logsList
      .filter((log) => {
        if (filterType === 'day') {
          const parsed = parseLogDate(log);
          if (parsed) {
            const logDate = new Date(parsed.year, parsed.month - 1, parsed.day);
            const start = new Date(startDate);
            const end = new Date(endDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            if (logDate < start || logDate > end) return false;
          }
        } else if (filterType === 'today') {
          const parsed = parseLogDate(log);
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

    // Always use the persisted systemMetrics (which is already date-filtered) for the aggregate summary
    if (systemMetrics?.reports) {
      const rep = systemMetrics.reports;
      const totalUploadsCount = rep.totalSessions;
      const completedAnalysesCount = rep.completedCount;
      const incompleteAnalysesCount = rep.incompleteCount;
      const invalidImageUploadsCount = rep.invalidImageCount;
      const completionRate = totalUploadsCount > 0 ? Math.round((completedAnalysesCount / totalUploadsCount) * 100) : 0;
      
      const accuracyScoreCounts = rep.accuracyCounts || {
        EXACT_MATCH: 0,
        MOSTLY_ACCURATE: 0,
        PARTIALLY_ACCURATE: 0,
        INACCURATE: 0,
      };
      const exactMatchCount = accuracyScoreCounts.EXACT_MATCH || 0;
      const exactMatchRate = completedAnalysesCount > 0 ? Math.round((exactMatchCount / completedAnalysesCount) * 100) : 0;
      const sortedErrorCounts = Object.entries(rep.errorDistribution || {}).sort((a, b) => (b[1] as number) - (a[1] as number));
      const totalConfirmedErrorsCount = Object.values(rep.errorDistribution || {}).reduce((a, b) => (a as number) + (b as number), 0) as number;
      const uniqueUsersCount = systemMetrics?.users?.uniqueUsersCount ?? rep.uniqueUsersCount;
      const todayUsersCount = systemMetrics?.users?.activeUsersCount ?? rep.todayUsersCount;
      const uniqueUsersList: UniqueUserItem[] = (rep.userList || []).map(u => ({
        userId: u.userId,
        totalSessions: u.totalSessions,
        completedSessions: u.completedSessions,
        lastActive: u.lastActive,
        lastTooth: u.lastTooth,
      }));

      return {
        timeFilteredLogs,
        totalUploadsCount,
        completedAnalysesCount,
        incompleteAnalysesCount,
        invalidImageUploadsCount,
        completionRate,
        exactMatchCount,
        exactMatchRate,
        accuracyScoreCounts,
        sortedErrorCounts,
        totalConfirmedErrorsCount,
        uniqueUsersList,
        uniqueUsersCount,
        todayUsersCount,
      };
    }

    // Dynamic calculation for filtered logs or fallback
    const totalUploadsCount = totalLogsCount ? totalLogsCount : logsList.length;

    const completedLogs = timeFilteredLogs.filter((l) => getLogStatus(l) === 'COMPLETED');
    const incompleteLogs = timeFilteredLogs.filter((l) => getLogStatus(l) === 'INCOMPLETE');
    const invalidImageUploadsCount = timeFilteredLogs.filter((l) => getLogStatus(l) === 'FAILED_NON_DENTAL').length;

    const completedAnalysesCount = completedLogs.length;
    const incompleteAnalysesCount = incompleteLogs.length;
    const completionRate = totalUploadsCount > 0 ? Math.round((completedAnalysesCount / totalUploadsCount) * 100) : 0;
    const errorCounts: Record<string, number> = {};

    const accuracyScoreCounts: Record<AccuracyCategory, number> = {
      EXACT_MATCH: 0,
      MOSTLY_ACCURATE: 0,
      PARTIALLY_ACCURATE: 0,
      INACCURATE: 0,
    };

    completedLogs.forEach((log) => {
      const category = getAccuracyCategory(log);
      accuracyScoreCounts[category] = (accuracyScoreCounts[category] || 0) + 1;

      (log.finalConfirmedErrors || []).forEach((key) => {
        if (key !== 'not_periapical') {
          errorCounts[key] = (errorCounts[key] || 0) + 1;
        }
      });
    });

    const exactMatchCount = accuracyScoreCounts.EXACT_MATCH;
    const exactMatchRate = completedAnalysesCount > 0 ? Math.round((exactMatchCount / completedAnalysesCount) * 100) : 0;

    const sortedErrorCounts = Object.entries(errorCounts).sort((a, b) => (b[1] as number) - (a[1] as number));
    const totalConfirmedErrorsCount = Object.values(errorCounts).reduce((a, b) => (a as number) + (b as number), 0) as number;

    const userMap: Record<string, { totalSessions: number; completedSessions: number; lastActive: string; lastTooth: string; rawMs: number }> = {};
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    let todayUsersCount = 0;
    const seenTodayUsers = new Set<string>();

    logsList.forEach((log) => {
      const uid = log.userId || (t('anonymousUser'));
      const toothDisplay = log.tooth?.fdiNumber ? `${t('tooth')}${log.tooth.fdiNumber}` : 'N/A';
      const logMs = parseTimestampToMs(log.timestamp, (log as any).updatedAt, (log as any).createdAt);
      const isCompleted = getLogStatus(log) === 'COMPLETED';

      if (!userMap[uid]) {
        userMap[uid] = {
          totalSessions: 0,
          completedSessions: 0,
          lastActive: formatDisplayTimestamp(log.timestamp, (log as any).updatedAt, (log as any).createdAt),
          lastTooth: toothDisplay,
          rawMs: logMs,
        };
      }

      userMap[uid].totalSessions += 1;
      if (isCompleted) {
        userMap[uid].completedSessions += 1;
      }

      if (logMs > userMap[uid].rawMs) {
        userMap[uid].rawMs = logMs;
        userMap[uid].lastActive = formatDisplayTimestamp(log.timestamp, (log as any).updatedAt, (log as any).createdAt);
        userMap[uid].lastTooth = toothDisplay;
      }

      if (logMs >= todayStart && !seenTodayUsers.has(uid)) {
        seenTodayUsers.add(uid);
        todayUsersCount += 1;
      }
    });

    const uniqueUsersList: UniqueUserItem[] = Object.entries(userMap)
      .map(([userId, data]) => ({
        userId,
        totalSessions: data.totalSessions,
        completedSessions: data.completedSessions,
        lastActive: data.lastActive,
        lastTooth: data.lastTooth,
      }))
      .sort((a, b) => b.totalSessions - a.totalSessions);

    const uniqueUsersCount = Object.keys(userMap).length;

    return {
      timeFilteredLogs,
      totalUploadsCount,
      completedAnalysesCount,
      incompleteAnalysesCount,
      invalidImageUploadsCount,
      completionRate,
      exactMatchCount,
      exactMatchRate,
      accuracyScoreCounts,
      sortedErrorCounts,
      totalConfirmedErrorsCount,
      uniqueUsersList,
      uniqueUsersCount,
      todayUsersCount,
    };
  }, [logsList, filterType, statusFilter, startDate, endDate, language, systemMetrics, totalLogsCount]);

  const filteredLogs = timeFilteredLogs;
  const { currentPage, setCurrentPage, totalPages } = usePagination(filteredLogs, PAGE_SIZE, totalLogsCount);

  useEffect(() => {
    if (currentPage > 1 && logsList.length > 0 && currentPage * PAGE_SIZE >= logsList.length && hasMore) {
      if (onLoadMore) {
        onLoadMore('reports', logsList.length);
      }
    }
  }, [currentPage, logsList.length, hasMore, onLoadMore]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, statusFilter, startDate, endDate, setCurrentPage]);

  const paginatedLogs = useMemo(() => {
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(startIdx, startIdx + PAGE_SIZE);
  }, [filteredLogs, currentPage, PAGE_SIZE]);

  const handleLogVerified = (updatedLog: AssessmentLogPayload) => {
    setLogsList((prevLogs) =>
      prevLogs.map((l) => (l.assessmentId === updatedLog.assessmentId ? updatedLog : l))
    );
  };

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = [
      'Assessment ID',
      'Timestamp',
      'Tooth FDI',
      'Tooth Name',
      'Technique',
      'Status',
      'Stage',
      'AI Overall Quality',
      'AI Errors Detected',
      'User Concurred',
      'Final Confirmed Errors',
      'Accuracy Score',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes',
    ];

    const escapeCsvCell = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredLogs.map((l) => {
      const status = getLogStatus(l);
      const isCompleted = status === 'COMPLETED';
      const isInvalid = status === 'FAILED_NON_DENTAL';
      const accuracyCategory = (!isCompleted || isInvalid) ? 'N/A' : getAccuracyCategory(l);

      const aiErrors: string[] = [];
      l.aiAnalysis?.findings?.forEach((f) => {
        f.detectedErrors?.forEach((e) => {
          if (e.errorKey) aiErrors.push(getTaxonomyLabel(e.errorKey, language));
        });
      });

      const finalErrors = (l.finalConfirmedErrors || []).map((e) => getTaxonomyLabel(e, language));
      const isAdmin = isLogAdminVerified(l);

      return [
        l.assessmentId || '',
        l.timestamp || '',
        l.tooth?.fdiNumber || '',
        l.tooth?.name || '',
        getTechniqueDisplayName(l.technique || '', language),
        status,
        l.stage || '',
        l.aiAnalysis?.overallQuality || '',
        aiErrors.join('; '),
        l.userValidation?.concurred !== undefined ? (l.userValidation.concurred ? 'YES' : 'NO') : '',
        finalErrors.join('; '),
        accuracyCategory,
        l.userValidation?.userNotes || l.userNotes || '',
        l.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        l.verifiedNotes || '',
      ].map(escapeCsvCell);
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map((e) => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `periapical_reports_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const getReportsDataForGoogleSheets = () => {
    const headers = [
      'Assessment ID',
      'Timestamp',
      'Tooth FDI',
      'Tooth Name',
      'Technique',
      'Status',
      'Stage',
      'AI Overall Quality',
      'AI Errors Detected',
      'User Concurred',
      'Final Confirmed Errors',
      'Accuracy Score',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes',
    ];

    const rows = filteredLogs.map((l) => {
      const status = getLogStatus(l);
      const isCompleted = status === 'COMPLETED';
      const isInvalid = status === 'FAILED_NON_DENTAL';
      const accuracyCategory = (!isCompleted || isInvalid) ? 'N/A' : getAccuracyCategory(l);

      const aiErrors: string[] = [];
      l.aiAnalysis?.findings?.forEach((f) => {
        f.detectedErrors?.forEach((e) => {
          if (e.errorKey) aiErrors.push(getTaxonomyLabel(e.errorKey, language));
        });
      });

      const finalErrors = (l.finalConfirmedErrors || []).map((e) => getTaxonomyLabel(e, language));
      const isAdmin = isLogAdminVerified(l);

      return [
        l.assessmentId || '',
        l.timestamp || '',
        l.tooth?.fdiNumber || '',
        l.tooth?.name || '',
        getTechniqueDisplayName(l.technique || '', language),
        status,
        l.stage || '',
        l.aiAnalysis?.overallQuality || '',
        aiErrors.join('; '),
        l.userValidation?.concurred !== undefined ? (l.userValidation.concurred ? 'YES' : 'NO') : '',
        finalErrors.join('; '),
        accuracyCategory,
        l.userValidation?.userNotes || l.userNotes || '',
        l.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        l.verifiedNotes || '',
      ];
    });

    const now = new Date();
    const formattedDate = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;

    return {
      title: `PeriApical_AI_Assessment_Logs_${formattedDate}`,
      headers,
      rows,
    };
  };

  const fetchExportData = useCallback(async () => {
    const preset = filterType === 'all' ? 'all' : filterType === 'today' ? 'today' : 'custom';
    const sDate = filterType === 'day' ? startDate : undefined;
    const eDate = filterType === 'day' ? endDate : undefined;

    const authHeaders = getAuthHeader ? getAuthHeader() : {};
    const response = await fetch('/api/admin/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        scope: 'reports',
        preset,
        startDate: sDate,
        endDate: eDate,
        status: statusFilter,
        language: language.toUpperCase(),
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Lỗi khi lấy dữ liệu xuất');
    }

    return {
      title: data.title,
      headers: data.headers,
      rows: data.rows,
      totalCount: data.totalCount,
    };
  }, [filterType, startDate, endDate, statusFilter, language, getAuthHeader]);

  return (
    <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 flex flex-col min-h-0 text-slate-800 dark:text-slate-100">
      {/* Top Filter Controls */}
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

      {/* KPI Stats & Metric Cards */}
      <ReportsStatsCards
        language={language}
        uniqueUsersCount={uniqueUsersCount}
        todayUsersCount={todayUsersCount}
        totalUploadsCount={totalUploadsCount}
        completionRate={completionRate}
        completedAnalysesCount={completedAnalysesCount}
        incompleteAnalysesCount={incompleteAnalysesCount}
        invalidImageUploadsCount={invalidImageUploadsCount}
        exactMatchRate={exactMatchRate}
        sortedErrorCounts={sortedErrorCounts}
        totalConfirmedErrorsCount={totalConfirmedErrorsCount}
        accuracyScoreCounts={accuracyScoreCounts}
        onOpenUserDirectory={() => setIsUserDirectoryOpen(true)}
      />

      {/* Assessment Record Table */}
      <div className="bg-white dark:bg-blue-950/80 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs overflow-hidden flex flex-col flex-1 min-h-[400px]">
        <div className="p-3 border-b border-slate-200 dark:border-blue-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 dark:bg-blue-900/40 shrink-0">
          <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-200 text-xs font-bold">
            <Filter className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            <span>
              {t('recordList')} ({filteredLogs.length} {t('results')})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="relative inline-flex group cursor-not-allowed"
              title={!isResearchImageStorageAvailable() ? getTrainingExportLockedMessage(language) : undefined}
            >
              <button
                type="button"
                disabled={!isResearchImageStorageAvailable()}
                onClick={exportEvaluationJson}
                className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all shadow-xs border ${
                  isResearchImageStorageAvailable()
                    ? 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer border-amber-400/30'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-75'
                }`}
                title={!isResearchImageStorageAvailable() ? getTrainingExportLockedMessage(language) : t('exportClinicalLabelledJson')}
              >
                {!isResearchImageStorageAvailable() ? <Lock className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
                <span>{t('exportAiTrainingDataset')}</span>
              </button>
              {!isResearchImageStorageAvailable() && (
                <div
                  role="tooltip"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-50 pointer-events-none"
                >
                  <div className="bg-slate-900 text-white text-[11px] font-normal px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap border border-slate-700 max-w-xs text-center">
                    {getTrainingExportLockedMessage(language)}
                  </div>
                  <div className="w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700" />
                </div>
              )}
            </div>

            <ExportDropdown
              disabled={filteredLogs.length === 0}
              language={language}
              onExportCsv={handleExportCsv}
              getDataForGoogleSheets={getReportsDataForGoogleSheets}
              fetchExportData={fetchExportData}
              headerColor={{ red: 0.15, green: 0.39, blue: 0.92 }}
            />
          </div>
        </div>
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap">
            <thead className="bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-blue-200/80 sticky top-0 z-10 shadow-xs font-semibold uppercase text-[10px] border-b border-slate-200 dark:border-blue-800/60">
              <tr>
                <th className="px-4 py-3">{t('caseId')}</th>
                <th className="px-4 py-3">{t('timestamp')}</th>
                <th className="px-4 py-3">{t('toothArea')}</th>
                <th className="px-4 py-3">{t('image')}</th>
                <th className="px-4 py-3">{t('status')}</th>
                <th className="px-4 py-3">{t('detectedErrors')}</th>
                <th className="px-4 py-3">{t('aiAccuracy')}</th>
                <th className="px-4 py-3">{t('actionsAdminGround')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-blue-900/50">
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 dark:text-blue-300/60">
                    {t('noMatchingRecordsFound')}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log, idx) => {
                  const status = getLogStatus(log);
                  let statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-blue-900/60 text-slate-700 dark:text-blue-200 border border-slate-200 dark:border-blue-700/60">
                      {t('processing8')}
                    </span>
                  );

                  if (status === 'COMPLETED') {
                    statusBadge = (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                        {t('Completed')}
                      </span>
                    );
                  } else if (status === 'INCOMPLETE') {
                    const stepNum = log.lastCompletedStep || (log.stepStatus?.step4 ? 4 : 3);
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

                  return (
                    <tr
                      key={log.assessmentId || idx}
                      className="hover:bg-blue-50/50 dark:hover:bg-blue-900/40 transition-colors group"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300" title={log.assessmentId}>
                        <span className="font-semibold">{log.assessmentId?.substring(0, 14)}...</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-blue-300/80 font-mono whitespace-nowrap">
                        {formatDisplayTimestamp(log.timestamp, (log as any).updatedAt, (log as any).createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium">
                        {log.tooth?.fdiNumber ? `${t('tooth')} ${log.tooth.fdiNumber}` : t('unselected')} <br />
                        <span className="text-[10px] text-slate-500 dark:text-blue-300/60 font-normal">({getTechniqueDisplayName(log.technique || '', language)})</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="relative inline-flex items-center space-x-1.5">
                          {log.shareConsent === false ? (
                            <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-slate-400 inline-flex items-center space-x-1 border border-slate-200 dark:border-blue-800">
                              <EyeOff className="w-3 h-3" />
                              <span>{t('notStored')}</span>
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 inline-flex items-center space-x-1 border border-emerald-200 dark:border-emerald-700/80 shadow-2xs">
                              <ImageIcon className="w-3 h-3" />
                              <span>{t('stored')}</span>
                            </span>
                          )}
                          {isLogAdminVerified(log) && (
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
                          {log.stage && (
                            <span className="text-[10px] text-slate-400 dark:text-blue-300/60">
                              {log.stage}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-[200px] truncate" title={(log.finalConfirmedErrors || []).map((e) => getTaxonomyLabel(e, language)).join(', ')}>
                        {status === 'FAILED_NON_DENTAL' || log.finalConfirmedErrors?.includes('not_periapical') ? (
                          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800/60 inline-block shadow-2xs">
                            {t('invalidImageNotA')}
                          </span>
                        ) : (log.finalConfirmedErrors || []).length > 0 ? (
                          <span className="text-rose-600 dark:text-rose-400 font-medium">
                            {(log.finalConfirmedErrors || []).map((e) => getTaxonomyLabel(e, language)).join(', ')}
                          </span>
                        ) : status === 'COMPLETED' ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {t('noErrors')}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">
                            {t('unverified')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {(() => {
                          if (status === 'FAILED_NON_DENTAL' || status === 'INCOMPLETE') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold inline-block bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-blue-300/70 border border-slate-200 dark:border-blue-800">
                                N/A
                              </span>
                            );
                          }
                          const category = getAccuracyCategory(log);
                          const config = ACCURACY_CATEGORY_CONFIG[category];
                          const label = getAccuracyLabel(category);
                          return (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold inline-block ${config.badgeClass}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedLogForReview(log)}
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
                                  collection: 'reports',
                                  title: `Báo cáo ca chụp #${log.assessmentId.slice(0, 8)}`,
                                  timestamp: formatDisplayTimestamp(log.timestamp),
                                  meta: `Răng: ${log.tooth?.fdiNumber || (log as any).toothFdiNumber || 'N/A'} - Trạng thái: ${log.sessionStatus || 'N/A'}`,
                                });
                              }}
                              className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer shadow-2xs"
                              title={language === 'EN' ? 'Delete this assessment record' : 'Xoá ca chụp này'}
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

      {/* Toast notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[110] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs font-bold flex items-center space-x-2 animate-bounce">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Modals */}
      <ReviewDetailModal
        selectedLog={selectedLogForReview}
        onClose={() => setSelectedLogForReview(null)}
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
        totalUsersCount={uniqueUsersCount}
        getAuthHeader={getAuthHeader}
      />
    </div>
  );
};
