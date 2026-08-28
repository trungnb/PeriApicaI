import { useTranslation } from 'react-i18next';
import React from 'react';
import { Calendar } from 'lucide-react';
import { Language } from '../../types/dental';

interface ReportsFiltersBarProps {
  language: Language;
  filterType: 'all' | 'today' | 'day';
  setFilterType: (val: 'all' | 'today' | 'day') => void;
  statusFilter: 'ALL' | 'COMPLETED' | 'INCOMPLETE' | 'FAILED_NON_DENTAL';
  setStatusFilter: (val: 'ALL' | 'COMPLETED' | 'INCOMPLETE' | 'FAILED_NON_DENTAL') => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
}

export const ReportsFiltersBar: React.FC<ReportsFiltersBarProps> = ({
  language,
  filterType,
  setFilterType,
  statusFilter,
  setStatusFilter,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
            {t('filterReportsProgress')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-blue-900/50 p-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-blue-800/50">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                filterType === 'all'
                  ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('allTime')}
            </button>
            <button
              onClick={() => setFilterType('today')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                filterType === 'today'
                  ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('today')}
            </button>
            <button
              onClick={() => setFilterType('day')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                filterType === 'day'
                  ? 'bg-white dark:bg-blue-800 text-blue-700 dark:text-blue-100 shadow-xs font-bold'
                  : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('dateRange')}
            </button>
          </div>

          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-blue-900/50 p-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-blue-800/50">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-white dark:bg-blue-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-blue-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('allStatus')}
            </button>
            <button
              onClick={() => setStatusFilter('COMPLETED')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'COMPLETED'
                  ? 'bg-emerald-600 text-white shadow-xs font-bold'
                  : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50'
              }`}
            >
              {t('completed')}
            </button>
            <button
              onClick={() => setStatusFilter('INCOMPLETE')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'INCOMPLETE'
                  ? 'bg-amber-500 text-white shadow-xs font-bold'
                  : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50'
              }`}
            >
              {t('incomplete6')}
            </button>
            <button
              onClick={() => setStatusFilter('FAILED_NON_DENTAL')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                statusFilter === 'FAILED_NON_DENTAL'
                  ? 'bg-rose-600 text-white shadow-xs font-bold'
                  : 'text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50'
              }`}
            >
              {t('invalidImage')}
            </button>
          </div>
        </div>
      </div>

      {filterType === 'day' && (
        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-blue-900/60">
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
      )}
    </div>
  );
};
