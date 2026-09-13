import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ChevronDown, FileSpreadsheet, FileText, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { exportDataToGoogleSheets } from '../../services/googleSheetsService';

interface ExportDropdownProps {
  disabled?: boolean;
  language: 'VI' | 'EN';
  onExportCsv?: () => void;
  getDataForGoogleSheets?: () => {
    title: string;
    headers: string[];
    rows: (string | number)[][];
  };
  fetchExportData?: () => Promise<{
    title: string;
    headers: string[];
    rows: (string | number)[][];
    totalCount: number;
  }>;
  headerColor?: { red: number; green: number; blue: number };
}

export const ExportDropdown: React.FC<ExportDropdownProps> = ({
  disabled = false,
  language,
  onExportCsv,
  getDataForGoogleSheets,
  fetchExportData,
  headerColor,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<'sheets' | 'csv' | null>(null);
  const [successSheetUrl, setSuccessSheetUrl] = useState<string | null>(null);
  const [exportedCount, setExportedCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getExportData = async () => {
    if (fetchExportData) {
      return await fetchExportData();
    }
    if (getDataForGoogleSheets) {
      const res = getDataForGoogleSheets();
      return { ...res, totalCount: res.rows?.length || 0 };
    }
    throw new Error('No export data source available');
  };

  const handleExportGoogleSheets = async () => {
    setIsOpen(false);
    setErrorMessage(null);
    setSuccessSheetUrl(null);
    setExportedCount(null);
    setIsExporting(true);
    setExportType('sheets');

    try {
      const { title, headers, rows, totalCount } = await getExportData();
      if (!rows || rows.length === 0) {
        throw new Error(t('noDataAvailableTo', 'Không có dữ liệu phù hợp để xuất.'));
      }

      const { spreadsheetUrl } = await exportDataToGoogleSheets(title, headers, rows, headerColor);
      setSuccessSheetUrl(spreadsheetUrl);
      setExportedCount(totalCount);

      // Safely attempt to open spreadsheet in a new tab
      try {
        const win = window.open(spreadsheetUrl, '_blank');
        if (win) win.focus();
      } catch (winErr) {
        console.warn('[ExportDropdown] window.open caught:', winErr);
      }
    } catch (unknownError: unknown) {
      const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.warn('[ExportDropdown] Google Sheets Export Handled:', err?.message || err);
      const rawMsg = err?.message || '';
      if (rawMsg.includes('popup_closed') || rawMsg.includes('Popup window closed') || rawMsg.includes('đóng')) {
        setErrorMessage(t('googleLoginWindowWas'));
      } else {
        setErrorMessage(rawMsg || (t('exportToGoogleSheets')));
      }
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  const handleExportCsv = async () => {
    setIsOpen(false);
    setErrorMessage(null);
    setSuccessSheetUrl(null);
    setExportedCount(null);
    setIsExporting(true);
    setExportType('csv');

    try {
      if (!fetchExportData && onExportCsv) {
        onExportCsv();
        return;
      }

      const { title, headers, rows, totalCount } = await getExportData();
      if (!rows || rows.length === 0) {
        throw new Error(t('noDataAvailableTo', 'Không có dữ liệu phù hợp để xuất.'));
      }

      // Convert to CSV with UTF-8 BOM and formula injection protection
      const sanitizeCsvCell = (cell: unknown): string => {
        if (cell === null || cell === undefined) return '""';
        if (typeof cell === 'number') return `"${cell}"`;
        const str = String(cell);
        const trimmed = str.trimStart();
        const safe = /^[=+@\-\t\r]/.test(trimmed) ? `'${str}` : str;
        return `"${safe.replace(/"/g, '""')}"`;
      };

      const csvContent = '\uFEFF' + [
        headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','),
        ...rows.map(row => row.map(sanitizeCsvCell).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${title}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportedCount(totalCount);
    } catch (unknownError: unknown) {
      const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      setErrorMessage(err.message || 'Lỗi khi xuất CSV');
    } finally {
      setIsExporting(false);
      setExportType(null);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Action button */}
      <button
        type="button"
        disabled={disabled || isExporting}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-300 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed"
      >
        {isExporting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        <span>
          {isExporting
            ? (exportType === 'sheets' ? t('creatingSheet') : 'Đang xuất CSV...')
            : t('exportData')}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="p-1.5 space-y-1">
            {/* Google Sheets Option */}
            <button
              type="button"
              onClick={handleExportGoogleSheets}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors flex items-start space-x-2.5 group cursor-pointer"
            >
              <div className="p-1.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 rounded-md shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-emerald-900 dark:group-hover:text-emerald-300">
                    {t('googleSheetsDrive')}
                  </span>
                  <span className="text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.2 rounded-md border border-emerald-200 dark:border-emerald-800/60">
                    {t('cloud')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                  {t('createsAFormattedSheet')}
                </p>
              </div>
            </button>

            <div className="border-t border-slate-100 dark:border-slate-700 my-1" />

            {/* Offline CSV Option */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors flex items-start space-x-2.5 group cursor-pointer"
            >
              <div className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md shrink-0 group-hover:bg-slate-700 group-hover:text-white transition-colors">
                <FileText className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-slate-950 dark:group-hover:text-white block">
                  {t('downloadCsvOffline')}
                </span>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                  {t('instantFileDownloadDirectly')}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Floating Success Toast when Sheet or CSV is generated */}
      {(successSheetUrl || exportedCount !== null) && (
        <div className="fixed bottom-6 right-6 z-[110] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-emerald-500/50 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="text-xs">
            <p className="font-bold text-white">
              {exportedCount !== null
                ? (language === 'VI' ? `Đã xuất thành công ${exportedCount} bản ghi` : `Successfully exported ${exportedCount} records`)
                : t('googleSheetCreatedSuccessfully')}
            </p>
            {successSheetUrl && (
              <a
                href={successSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-300 hover:text-emerald-200 underline font-semibold flex items-center gap-1 mt-0.5"
              >
                <span>{t('openInGoogleDrive')}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Floating Error Toast */}
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-[110] bg-rose-950 text-rose-100 px-4 py-3 rounded-xl shadow-2xl border border-rose-700/60 flex items-center space-x-3 text-xs font-semibold animate-in fade-in slide-in-from-bottom-4 duration-200">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-rose-300 hover:text-white font-bold ml-2 underline"
          >
            {t('dismiss')}
          </button>
        </div>
      )}
    </div>
  );
};
