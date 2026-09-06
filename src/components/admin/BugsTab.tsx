import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportDropdown } from './ExportDropdown';
import { Calendar, User, Bot, AlertTriangle, AlertOctagon, Info, ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react';
import { BugReport, SystemMetrics } from '../../types/dental';
import { parseTimestampToMs, formatDisplayTimestamp, parseLogDateParts } from '../../utils/dateUtils';
import { useAppStore } from '../../store/appStore';
import { useMetadataStore } from '../../store/useMetadataStore';
import { usePagination } from '../../hooks/usePagination';
import { PaginationControls } from '../common/PaginationControls';
import { getAdminToken } from '../../utils/adminAuthUtils';

interface BugsTabProps {
  bugsList: BugReport[];
  systemMetrics?: SystemMetrics | null;
  totalBugsCount?: number;
  onRequestDelete?: (target: { docId: string; collection: 'bugs'; title?: string; timestamp?: string; meta?: string }) => void;
  onDateRangeChange?: (filter: { preset: 'all' | 'today' | '7days' | '30days' | 'custom'; startDate?: string; endDate?: string }) => void;
  onLoadMore?: (collection: 'reports' | 'pathology' | 'bugs', currentLength: number) => void;
  hasMore?: boolean;
}

export const BugsTab: React.FC<BugsTabProps> = ({ bugsList, systemMetrics: propSystemMetrics, totalBugsCount, onRequestDelete, onDateRangeChange, onLoadMore, hasMore = false }) => {
  const { t } = useTranslation(['admin', 'common']);
  const language = useAppStore(state => state.language);
  const storeSystemMetrics = useMetadataStore((state) => state.systemMetrics);
  const systemMetrics = propSystemMetrics || storeSystemMetrics;
  const [filterType, setFilterType] = useState<'all' | 'day'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'USER_SUBMITTED' | 'SYSTEM_AUTO'>('all');
  const [expandedBugId, setExpandedBugId] = useState<string | null>(null);

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
    const preset = filterType === 'all' ? 'all' : 'custom';
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

  const parseLogDate = (bug: BugReport) => {
    return parseLogDateParts(bug.timestamp, (bug as any).createdAt);
  };

  const filteredBugs = useMemo(() => {
    return bugsList
      .filter((bug) => {
        // Source filter
        const bugSource = bug.source || 'USER_SUBMITTED';
        if (sourceFilter !== 'all' && bugSource !== sourceFilter) {
          return false;
        }

        // Time filter
        if (filterType === 'all') return true;
        const parsed = parseLogDate(bug);
        if (!parsed) return true;
        if (filterType === 'day') {
          const logDate = new Date(parsed.year, parsed.month - 1, parsed.day);
          const start = new Date(startDate);
          const end = new Date(endDate);
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
          return logDate >= start && logDate <= end;
        }
        return true;
      })
      .sort((a, b) => {
        const msA = parseTimestampToMs(a.timestamp, (a as any).createdAt);
        const msB = parseTimestampToMs(b.timestamp, (b as any).createdAt);
        return msB - msA;
      });
  }, [bugsList, filterType, sourceFilter, startDate, endDate]);

  const { currentPage, setCurrentPage, totalPages } = usePagination(filteredBugs, PAGE_SIZE, totalBugsCount);

  useEffect(() => {
    if (currentPage > 1 && bugsList.length > 0 && currentPage * PAGE_SIZE >= bugsList.length && hasMore) {
      if (onLoadMore) {
        onLoadMore('bugs', bugsList.length);
      }
    }
  }, [currentPage, bugsList.length, hasMore, onLoadMore]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, sourceFilter, startDate, endDate, setCurrentPage]);

  const paginatedBugs = useMemo(() => {
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    return filteredBugs.slice(startIdx, startIdx + PAGE_SIZE);
  }, [filteredBugs, currentPage, PAGE_SIZE]);

  const toggleExpand = (id: string) => {
    setExpandedBugId(expandedBugId === id ? null : id);
  };

  const handleExportCsv = () => {
    if (filteredBugs.length === 0) return;
    const headers = ['Timestamp', 'Source', 'Severity', 'Path', 'Description'];
    const escapeCsvCell = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredBugs.map((b) => [
      b.timestamp || (b as any).createdAt || '',
      b.source || '',
      b.severity || '',
      b.path || '',
      b.description || '',
    ].map(escapeCsvCell));

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map((e) => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `system_bug_reports_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const getBugsDataForGoogleSheets = () => {
    const headers = ['Thời Gian (Timestamp)', 'Nguồn Bug (Source)', 'Mức Độ (Severity)', 'Đường Dẫn (Path)', 'Mô Tả Lỗi (Description)'];
    const rows = filteredBugs.map((b) => [
      b.timestamp || (b as any).createdAt || '',
      b.source === 'SYSTEM_AUTO' ? 'Hệ thống tự ghi' : 'Người dùng báo lỗi',
      b.severity || 'INFO',
      b.path || '',
      b.description || '',
    ]);

    const formattedDate = new Date().toISOString().slice(0, 10);
    return {
      title: `PeriApical_AI_Bug_Reports_${formattedDate}`,
      headers,
      rows,
    };
  };

  const fetchExportData = useCallback(async () => {
    const preset = filterType === 'all' ? 'all' : 'custom';
    const sDate = filterType === 'day' ? startDate : undefined;
    const eDate = filterType === 'day' ? endDate : undefined;

    const token = getAdminToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/admin/export', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'bugs',
        preset,
        startDate: sDate,
        endDate: eDate,
        source: sourceFilter,
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
  }, [filterType, startDate, endDate, sourceFilter, language]);

  const renderSourceBadge = (source?: string) => {
    if (source === 'SYSTEM_AUTO') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
          <Bot className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          <span>{t('autologged')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
        <User className="w-3 h-3 text-blue-600 dark:text-blue-400" />
        <span>{t('userSubmitted')}</span>
      </span>
    );
  };

  const renderSeverityBadge = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-600 text-white">
            <AlertOctagon className="w-3 h-3" />
            <span>{t('critical')}</span>
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-white">
            <AlertTriangle className="w-3 h-3" />
            <span>{t('warning')}</span>
          </span>
        );
      case 'INFO':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Info className="w-3 h-3" />
            <span>{t('info')}</span>
          </span>
        );
      case 'ERROR':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
            <AlertOctagon className="w-3 h-3" />
            <span>{t('systemError')}</span>
          </span>
        );
    }
  };

  return (
    <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 flex flex-col min-h-0 text-slate-800 dark:text-slate-200 text-xs bg-slate-50 dark:bg-blue-950/40">
      
      {/* Filters Card */}
      <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Source Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-xs text-slate-800 dark:text-slate-200 shrink-0">
              {t('reportSource')}
            </span>
            <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-blue-900/50 p-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-blue-800/50">
              <button
                onClick={() => setSourceFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  sourceFilter === 'all'
                    ? 'bg-white dark:bg-blue-800 text-slate-900 dark:text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('all')} ({systemMetrics?.bugs ? systemMetrics.bugs.totalBugs : (totalBugsCount || bugsList.length)})
              </button>
              <button
                onClick={() => setSourceFilter('USER_SUBMITTED')}
                className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                  sourceFilter === 'USER_SUBMITTED'
                    ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-200 shadow-xs font-bold'
                    : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <User className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>
                  {t('user')} ({systemMetrics?.bugs ? (systemMetrics.bugs.sourceDistribution?.USER_SUBMITTED ?? 0) : bugsList.filter(b => (b.source || 'USER_SUBMITTED') === 'USER_SUBMITTED').length})
                </span>
              </button>
              <button
                onClick={() => setSourceFilter('SYSTEM_AUTO')}
                className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                  sourceFilter === 'SYSTEM_AUTO'
                    ? 'bg-white dark:bg-blue-800 text-amber-700 dark:text-amber-200 shadow-xs font-bold'
                    : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Bot className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span>
                  {t('autologged')} ({systemMetrics?.bugs ? (systemMetrics.bugs.sourceDistribution?.SYSTEM_AUTO ?? 0) : bugsList.filter(b => b.source === 'SYSTEM_AUTO').length})
                </span>
              </button>
            </div>
          </div>

          {/* Time Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-1 shrink-0">
              <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                {t('timeRange')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-blue-900/50 p-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-blue-800/50">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  filterType === 'all'
                    ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-100 shadow-xs font-bold'
                    : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('allTime')}
              </button>
              <button
                onClick={() => setFilterType('day')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  filterType === 'day'
                    ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-100 shadow-xs font-bold'
                    : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('dateRange')}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-blue-900/60">
          {filterType === 'day' ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-blue-300/80">{t('from')}</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-xs p-1.5 border border-slate-300 dark:border-blue-700 bg-white dark:bg-blue-950 text-slate-900 dark:text-slate-100 rounded-md"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-blue-300/80">{t('to')}</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="text-xs p-1.5 border border-slate-300 dark:border-blue-700 bg-white dark:bg-blue-950 text-slate-900 dark:text-slate-100 rounded-md"
                />
              </div>
            </div>
          ) : <div />}
          <ExportDropdown
            disabled={filteredBugs.length === 0}
            language={language}
            onExportCsv={handleExportCsv}
            getDataForGoogleSheets={getBugsDataForGoogleSheets}
            fetchExportData={fetchExportData}
            headerColor={{ red: 0.88, green: 0.11, blue: 0.28 }}
          />
        </div>
      </div>

      {/* Table / List */}
      <div className="bg-white dark:bg-blue-950/80 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs overflow-hidden flex flex-col flex-1 min-h-[400px]">
        <div className="p-3 border-b border-slate-200 dark:border-blue-800/70 bg-slate-100 dark:bg-blue-900/60 text-slate-500 dark:text-blue-200/80 font-bold uppercase tracking-wider text-[10px] grid grid-cols-12 gap-4">
          <div className="col-span-3 sm:col-span-2">{t('timestamp')}</div>
          <div className="col-span-3 sm:col-span-3">{t('sourceSeverity')}</div>
          <div className="col-span-6 sm:col-span-7">{t('descriptionDetails')}</div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-blue-900/50 overflow-y-auto flex-1">
          {paginatedBugs.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-blue-300/60">
              {t('noBugReportsMatch')}
            </div>
          ) : (
            paginatedBugs.map((bug, idx) => {
              const bugKey = bug.bugId || `bug-${idx}`;
              const isExpanded = expandedBugId === bugKey;
              const hasDetails = Boolean(bug.errorDetails || bug.path);

              return (
                <div
                  key={bugKey}
                  className="p-3 transition-colors hover:bg-slate-50 dark:hover:bg-blue-900/40 flex flex-col gap-2"
                >
                  <div className="grid grid-cols-12 gap-4 items-start">
                    {/* Timestamp */}
                    <div className="col-span-3 sm:col-span-2 text-slate-600 dark:text-blue-300/80 font-mono text-[11px] pt-1 whitespace-nowrap">
                      {formatDisplayTimestamp(bug.timestamp, (bug as any).createdAt)}
                    </div>

                    {/* Source & Severity Badges */}
                    <div className="col-span-3 sm:col-span-3 flex flex-wrap gap-1.5 items-center">
                      {renderSourceBadge(bug.source)}
                      {renderSeverityBadge(bug.severity)}
                    </div>

                    {/* Description & Action */}
                    <div className="col-span-6 sm:col-span-7 flex items-start justify-between gap-2">
                      <div className="text-slate-800 dark:text-slate-200 font-medium whitespace-pre-wrap flex-1 text-xs">
                        {bug.description}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasDetails && (
                          <button
                            onClick={() => toggleExpand(bugKey)}
                            className="px-2 py-1 bg-slate-100 dark:bg-blue-900/60 hover:bg-slate-200 dark:hover:bg-blue-800 text-slate-700 dark:text-blue-200 rounded-md text-[11px] font-semibold flex items-center space-x-1 shrink-0 transition-colors cursor-pointer border border-slate-200 dark:border-blue-700/60"
                          >
                            <Terminal className="w-3 h-3 text-slate-500 dark:text-blue-400" />
                            <span>
                              {language === 'EN'
                                ? isExpanded ? 'Hide Tech Log' : 'View Tech Log'
                                : isExpanded ? 'Ẩn Log' : 'Xem Log Kỹ thuật'}
                            </span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        {onRequestDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              const targetId = bug.bugId || (bug as any).id || bugKey;
                              onRequestDelete({
                                docId: targetId,
                                collection: 'bugs',
                                title: `Báo cáo sự cố #${targetId.slice(0, 8)}`,
                                timestamp: formatDisplayTimestamp(bug.timestamp, (bug as any).createdAt),
                                meta: `Mức độ: ${bug.severity || 'N/A'} - Nguồn: ${bug.source || 'USER_SUBMITTED'}`,
                              });
                            }}
                            className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer shadow-2xs"
                            title={language === 'EN' ? 'Delete this bug report' : 'Xoá báo cáo sự cố này'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Technical Details Panel */}
                  {isExpanded && (
                    <div className="mt-2 p-3 bg-slate-950 text-slate-100 rounded-lg text-xs font-mono space-y-2 border border-blue-900 shadow-inner animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-blue-900/80 pb-1.5">
                        <span className="flex items-center gap-1 font-bold text-amber-400">
                          <Terminal className="w-3.5 h-3.5" />
                          {t('technicalSystemLogDetails')}
                        </span>
                        <span>Path: {bug.path || '/'}</span>
                      </div>

                      {bug.errorDetails ? (
                        <div className="space-y-1.5 pt-1">
                          {bug.errorDetails.endpoint && (
                            <div>
                              <span className="text-slate-400">API Endpoint:</span>{' '}
                              <span className="text-emerald-400 font-bold">{bug.errorDetails.endpoint}</span>
                              {bug.errorDetails.statusCode && (
                                <span className="ml-2 text-rose-400 font-bold">
                                  [HTTP {bug.errorDetails.statusCode}]
                                </span>
                              )}
                            </div>
                          )}

                          {bug.errorDetails.errorMessage && (
                            <div>
                              <span className="text-slate-400">Error Message:</span>{' '}
                              <span className="text-rose-300">{bug.errorDetails.errorMessage}</span>
                            </div>
                          )}

                          {bug.errorDetails.stackTrace && (
                            <div className="mt-2">
                              <span className="text-slate-400 block mb-1">Stack Trace:</span>
                              <pre className="p-2 bg-slate-950 text-rose-300/90 rounded border border-blue-900/60 overflow-x-auto text-[10px] leading-relaxed max-h-40">
                                {bug.errorDetails.stackTrace}
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-slate-400 italic">
                          {t('noAdditionalStackTrace')} {bug.path ? `(${bug.path})` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Pagination Controls */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredBugs.length}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};
