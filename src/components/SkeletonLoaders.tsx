import React from 'react';

/**
 * Main Screen Skeleton Loader
 * Replaces generic spinners during route/step lazy loading with layout-matching UI primitives.
 */
export const MainScreenSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col justify-center">
        <div className="w-full max-w-5xl xl:max-w-6xl mx-auto my-auto space-y-4 sm:space-y-6">
          
          {/* Hero / Main Card Skeleton */}
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            {/* Title Badge & Line */}
            <div className="space-y-3">
              <div className="h-7 sm:h-9 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-xl w-3/4 max-w-md" />
              <div className="space-y-2">
                <div className="h-4 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-full" />
                <div className="h-4 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-11/12" />
                <div className="h-4 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-4/5" />
              </div>
            </div>

            {/* Grid / Options Skeleton */}
            <div className="pt-2 space-y-3">
              <div className="h-3.5 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md w-32" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="h-24 sm:h-28 bg-slate-100 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 animate-pulse rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse shrink-0" />
                    <div className="h-5 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-md w-28" />
                  </div>
                  <div className="h-3 bg-slate-200/70 dark:bg-slate-700/60 animate-pulse rounded-md w-3/4" />
                </div>
                <div className="h-24 sm:h-28 bg-slate-100 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 animate-pulse rounded-xl p-4 flex flex-col justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse shrink-0" />
                    <div className="h-5 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-md w-28" />
                  </div>
                  <div className="h-3 bg-slate-200/70 dark:bg-slate-700/60 animate-pulse rounded-md w-3/4" />
                </div>
              </div>
            </div>
          </div>

          {/* Feature Grid / Cards Skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="bg-white dark:bg-slate-900/90 rounded-xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-3"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-4 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md w-2/3" />
                <div className="h-3 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-full" />
                <div className="h-3 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-4/5" />
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};

/**
 * Admin Portal Modal Skeleton Loader
 */
export const AdminModalSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900 animate-fadeIn">
      {/* Tab Navigation Line */}
      <div className="px-5 py-2.5 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-blue-900/80 flex items-center space-x-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 w-28 bg-slate-200/80 dark:bg-slate-800/70 animate-pulse rounded-t-xl" />
        ))}
      </div>

      {/* Content Body */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              <div className="h-7 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-md" />
            </div>
          ))}
        </div>

        {/* Log Table Placeholder */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden space-y-2 p-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg w-full mb-3" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/40 animate-pulse rounded-lg w-full flex items-center justify-between px-4">
              <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Compact Modal Skeleton
 */
export const ModalSkeleton: React.FC = () => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-5 w-2/3 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md" />
            <div className="h-3 w-1/2 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md" />
          </div>
        </div>
        <div className="space-y-2 py-2">
          <div className="h-4 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-full" />
          <div className="h-4 bg-slate-200/70 dark:bg-slate-800/60 animate-pulse rounded-md w-5/6" />
        </div>
        <div className="flex justify-end space-x-2 pt-2">
          <div className="h-9 w-20 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg" />
          <div className="h-9 w-24 bg-slate-300 dark:bg-slate-700 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
};
