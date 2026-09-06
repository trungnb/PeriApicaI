import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  UserCheck,
  Activity,
  FileCode,
  GraduationCap,
  Microscope,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { Language } from '../../types/dental';
import { getPathologyLabel } from '../../data/pathologyTaxonomyData';

interface PathologyStatsCardsProps {
  language: Language;
  uniqueUsersCount: number;
  todayUsersCount: number;
  totalSessions: number;
  completionRate: number;
  completedCount: number;
  incompleteCount: number;
  invalidImageCount: number;
  adminVerifiedCount: number;
  sortedPathologyCounts: [string, number][];
  totalPathologyOccurrences: number;
  onOpenUserDirectory: () => void;
}

export const PathologyStatsCards: React.FC<PathologyStatsCardsProps> = ({
  language,
  uniqueUsersCount,
  todayUsersCount,
  totalSessions,
  completionRate,
  completedCount,
  incompleteCount,
  invalidImageCount,
  adminVerifiedCount,
  sortedPathologyCounts,
  totalPathologyOccurrences,
  onOpenUserDirectory,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <>
      {/* User Statistics Banner (Identical styling to Luồng A) */}
      <div className="bg-gradient-to-r from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-blue-950 dark:via-slate-950 dark:to-indigo-950 text-slate-800 dark:text-white p-5 rounded-2xl border border-slate-200 dark:border-blue-800/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-blue-800/60 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 rounded-xl border border-blue-200 dark:border-blue-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <span>{t('userPathologyStatistics')}</span>
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
              <span>{t('totalPathologySessions')}</span>
              <FileCode className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-300 font-mono">{totalSessions}</p>
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

      {/* KPI Stat Cards (5 Column Grid matching Luồng A) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4 items-stretch">
        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('totalUploads')}
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-auto">{totalSessions}</p>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('completedEvaluations')}
          </p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-auto">{completedCount}</p>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('incompleteSessions')}
          </p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-auto">{incompleteCount}</p>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('invalidImageUploads')}
          </p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-auto">{invalidImageCount}</p>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs flex flex-col items-center justify-between text-center">
          <p className="text-slate-500 dark:text-blue-300/80 text-[10px] xl:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap mb-2 flex items-center justify-center w-full">
            {t('adminVerified')}
          </p>
          <p className="text-2xl font-bold text-amber-500 dark:text-amber-400 mt-auto flex items-center gap-1 justify-center">
            <Star className="w-5 h-5 fill-amber-500 inline" />
            <span>{adminVerifiedCount}</span>
          </p>
        </div>
      </div>

      {/* Distribution Charts & Metrics Breakdown (Identical layout to Luồng A) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-4">
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Microscope className="w-4 h-4 text-teal-500" />
            <span>{t('commonPathologyDistributionTop')}</span>
          </h4>
          <div className="space-y-3">
            {sortedPathologyCounts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-blue-300/60 text-center py-4">
                {t('noPathologyDataAvailable')}
              </p>
            ) : (
              sortedPathologyCounts.slice(0, 10).map(([key, count]) => {
                const label = getPathologyLabel(key, language);
                const pct = totalPathologyOccurrences > 0 ? Math.round((count / totalPathologyOccurrences) * 100) : 0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate pr-2" title={label}>{label}</span>
                      <span className="text-slate-500 dark:text-blue-300/80 font-semibold">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                      <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-xs space-y-4">
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>{t('evaluationGroundTruth')}</span>
          </h4>
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t('completedAssessmentsStep5')}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{completedCount} ({completionRate}%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${completionRate}%` }}></div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t('incompleteAssessments')}
                </span>
                <span className="text-amber-600 dark:text-amber-400 font-bold">
                  {incompleteCount} ({totalSessions > 0 ? Math.round((incompleteCount / totalSessions) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${totalSessions > 0 ? Math.round((incompleteCount / totalSessions) * 100) : 0}%` }}></div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t('adminVerifiedDataset')}
                </span>
                <span className="text-blue-600 dark:text-blue-400 font-bold">
                  {adminVerifiedCount} ({totalSessions > 0 ? Math.round((adminVerifiedCount / totalSessions) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${totalSessions > 0 ? Math.round((adminVerifiedCount / totalSessions) * 100) : 0}%` }}></div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {t('invalidNondentalUploads')}
                </span>
                <span className="text-rose-600 dark:text-rose-400 font-bold">
                  {invalidImageCount} ({totalSessions > 0 ? Math.round((invalidImageCount / totalSessions) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-blue-900/60 rounded-full h-2">
                <div className="bg-rose-500 h-2 rounded-full" style={{ width: `${totalSessions > 0 ? Math.round((invalidImageCount / totalSessions) * 100) : 0}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
