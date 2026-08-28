import { useTranslation } from 'react-i18next';
import React from 'react';
import {
  Users,
  UserCheck,
  Activity,
  FileCode,
  GraduationCap,
} from 'lucide-react';
import { Language } from '../../types/dental';
import { getTaxonomyLabel } from '../../data/taxonomyData';
import { AccuracyCategory, ACCURACY_CATEGORY_CONFIG } from '../../utils/reportUtils';

interface ReportsStatsCardsProps {
  language: Language;
  uniqueUsersCount: number;
  todayUsersCount: number;
  totalUploadsCount: number;
  completionRate: number;
  completedAnalysesCount: number;
  incompleteAnalysesCount: number;
  invalidImageUploadsCount: number;
  exactMatchRate: number;
  sortedErrorCounts: [string, number][];
  totalConfirmedErrorsCount: number;
  accuracyScoreCounts: Record<AccuracyCategory, number>;
  onOpenUserDirectory: () => void;
}

export const ReportsStatsCards: React.FC<ReportsStatsCardsProps> = ({
  language,
  uniqueUsersCount,
  todayUsersCount,
  totalUploadsCount,
  completionRate,
  completedAnalysesCount,
  incompleteAnalysesCount,
  invalidImageUploadsCount,
  exactMatchRate,
  sortedErrorCounts,
  totalConfirmedErrorsCount,
  accuracyScoreCounts,
  onOpenUserDirectory,
}) => {
  const { t } = useTranslation(['admin', 'common']);

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

  return (
    <>
      {/* User Statistics Banner */}
      <div className="bg-gradient-to-r from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-blue-950 dark:via-slate-950 dark:to-indigo-950 text-slate-800 dark:text-white p-5 rounded-2xl border border-slate-200 dark:border-blue-800/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-blue-800/60 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 rounded-xl border border-blue-200 dark:border-blue-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <span>{t('userStatistics')}</span>
              </h3>
            </div>
          </div>

          <button
            onClick={onOpenUserDirectory}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs transition-all cursor-pointer shrink-0 shadow-xs border border-blue-400/30"
          >
            <UserCheck className="w-4 h-4" />
            <span>{t('viewUsersDirectory')} ({uniqueUsersCount})</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-blue-50/50 dark:bg-blue-900/40 p-3.5 rounded-xl border border-blue-100 dark:border-blue-800/60 space-y-1">
            <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-300/80 font-medium">
              <span>{t('totalUsers')}</span>
              <Users className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{uniqueUsersCount}</p>
            <p className="text-[11px] text-blue-500/85 dark:text-blue-200/70 font-medium">{t('devices')}</p>
          </div>

          <div className="bg-blue-50/50 dark:bg-blue-900/40 p-3.5 rounded-xl border border-blue-100 dark:border-blue-800/60 space-y-1">
            <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-300/80 font-medium">
              <span>{t('activeToday')}</span>
              <Activity className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{todayUsersCount}</p>
            <p className="text-[11px] text-blue-500/85 dark:text-blue-200/70 font-medium">{t('devices')}</p>
          </div>

          <div className="bg-blue-50/50 dark:bg-blue-900/40 p-3.5 rounded-xl border border-blue-100 dark:border-blue-800/60 space-y-1">
            <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-300/80 font-medium">
              <span>{t('totalAnalyses')}</span>
              <FileCode className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-300 font-mono">{totalUploadsCount}</p>
            <p className="text-[11px] text-blue-500/85 dark:text-blue-200/70 font-medium">{t('sessions')}</p>
          </div>

          <div className="bg-blue-50/50 dark:bg-blue-900/40 p-3.5 rounded-xl border border-blue-100 dark:border-blue-800/60 space-y-1">
            <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-300/80 font-medium">
              <span>{t('completionRate')}</span>
              <GraduationCap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-300 font-mono">{completionRate}%</p>
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-stretch">
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('totalUploads')}
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-auto">{totalUploadsCount}</p>
        </div>
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('completedEvaluations')}
          </p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-auto">{completedAnalysesCount}</p>
        </div>
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('incompleteSessions')}
          </p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-auto">{incompleteAnalysesCount}</p>
        </div>
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('invalidImageUploads')}
          </p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-auto">{invalidImageUploadsCount}</p>
        </div>
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('consensusRate')}
          </p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-auto">
            {exactMatchRate}%
          </p>
        </div>
      </div>

      {/* Distribution Charts & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-4">
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            {t('commonErrorDistributionTop')}
          </h4>
          <div className="space-y-3">
            {sortedErrorCounts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-blue-300/60 text-center py-4">
                {t('noErrorDataAvailable')}
              </p>
            ) : (
              sortedErrorCounts.slice(0, 10).map(([errKey, count]) => {
                const label = getTaxonomyLabel(errKey, language);
                const pct = totalConfirmedErrorsCount > 0 ? Math.round(((count as number) / totalConfirmedErrorsCount) * 100) : 0;
                return (
                  <div key={errKey} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate pr-2" title={label}>{label}</span>
                      <span className="text-slate-500 dark:text-blue-300/80 font-semibold">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                      <div className="bg-rose-500 h-2 rounded-full" style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-4">
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            {t('aiAnalysisAccuracy')}
          </h4>
          <div className="space-y-3">
            {completedAnalysesCount === 0 ? (
              <p className="text-xs text-slate-500 dark:text-blue-300/60 text-center py-4">
                {t('noCompletedAssessmentData')}
              </p>
            ) : (
              (Object.keys(accuracyScoreCounts) as AccuracyCategory[]).map((category) => {
                const count = accuracyScoreCounts[category];
                const pct = completedAnalysesCount > 0 ? Math.round((count / completedAnalysesCount) * 100) : 0;
                const config = ACCURACY_CATEGORY_CONFIG[category];
                const label = getAccuracyLabel(category);

                return (
                  <div key={category} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate pr-2">{label}</span>
                      <span className="text-slate-500 dark:text-blue-300/80 font-semibold">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                      <div className={`${config.colorClass} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
};
