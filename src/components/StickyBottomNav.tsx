import React from 'react';
import { ArrowLeft, ArrowRight, Loader2, Lock, Sparkles, Home } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface StickyBottomNavProps {
  onBack: () => void;
  backText: string;
  isBackDisabled?: boolean;
  isBackHidden?: boolean;
  
  onNext?: () => void;
  nextText?: string;
  isNextDisabled?: boolean;
  
  // Custom button styling/states
  nextIcon?: 'arrow-right' | 'sparkles' | 'home' | 'none';
  isAnalyzing?: boolean;
  isQuotaExhausted?: boolean;
  quotaResetNotice?: string;
  
  // Layout customization
  maxWidthClass?: string; // e.g. "max-w-5xl" or "max-w-7xl"
  customNextButton?: React.ReactNode;
}

export const StickyBottomNav: React.FC<StickyBottomNavProps> = React.memo(({
  onBack,
  backText,
  isBackDisabled = false,
  isBackHidden = false,
  onNext,
  nextText = '',
  isNextDisabled = false,
  nextIcon = 'arrow-right',
  isAnalyzing = false,
  isQuotaExhausted = false,
  quotaResetNotice,
  maxWidthClass = 'max-w-7xl',
  customNextButton,
}) => {
  const appEngineMode = useAppStore((state) => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 z-30 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      <div className={`${maxWidthClass} mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-3`}>
        {!isBackHidden ? (
          <button
            type="button"
            onClick={onBack}
            disabled={isBackDisabled || isAnalyzing}
            className={`inline-flex justify-center items-center space-x-2 px-4 sm:px-5 h-10 min-h-[40px] min-w-[100px] sm:min-w-[125px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-bold text-xs sm:text-xs transition-all shadow-xs ${
              (isBackDisabled || isAnalyzing) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'
            }`}
          >
            <ArrowLeft className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
            <span className="truncate">{backText}</span>
          </button>
        ) : (
          <div />
        )}

        {customNextButton ? (
          customNextButton
        ) : onNext ? (
          <button
            type="button"
            onClick={onNext}
            disabled={isNextDisabled || isAnalyzing || isQuotaExhausted}
            className={`inline-flex justify-center items-center space-x-2 px-5 sm:px-6 h-10 min-h-[40px] min-w-[120px] sm:min-w-[140px] rounded-xl font-bold text-xs sm:text-xs transition-all shadow-xs ${
              isNextDisabled || isAnalyzing || isQuotaExhausted
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                : isPathology
                ? 'bg-teal-600 hover:bg-teal-700 active:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white cursor-pointer active:scale-95 shadow-md shadow-teal-600/20'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white cursor-pointer active:scale-95 shadow-md shadow-blue-600/20'
            }`}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span className="truncate">{nextText}</span>
              </>
            ) : isQuotaExhausted ? (
              <>
                <Lock className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="truncate">{quotaResetNotice || 'Quota Locked'}</span>
              </>
            ) : (
              <>
                {nextIcon === 'home' && <Home className="w-4 h-4 shrink-0" />}
                <span className="truncate">{nextText}</span>
                {nextIcon === 'sparkles' && (
                  <Sparkles className={`w-4 h-4 shrink-0 ${isPathology ? 'text-teal-200' : 'text-sky-300'}`} />
                )}
                {nextIcon === 'arrow-right' && <ArrowRight className="w-4 h-4 shrink-0" />}
              </>
            )}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
});
