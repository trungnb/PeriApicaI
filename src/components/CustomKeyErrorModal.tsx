import React from 'react';
import { AlertTriangle, RefreshCw, KeyRound, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { useRadiographAnalysis } from '../hooks/useRadiographAnalysis';

export const CustomKeyErrorModal: React.FC = () => {
  const { t } = useTranslation('upload');
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const customKeyErrorModal = useAppStore(state => state.customKeyErrorModal);
  const setCustomKeyErrorModal = useAppStore(state => state.setCustomKeyErrorModal);
  const systemApiAvailable = useAppStore(state => state.systemApiAvailable);
  const setIsAnalyzing = useAppStore(state => state.setIsAnalyzing);

  const { handleAnalyzeRadiograph, retryWithSystemKey } = useRadiographAnalysis();

  if (!customKeyErrorModal || !customKeyErrorModal.isOpen) return null;

  const isSystemAvailable = typeof customKeyErrorModal.systemApiAvailable === 'boolean'
    ? customKeyErrorModal.systemApiAvailable
    : systemApiAvailable;

  const handleSwitchToAppKey = () => {
    retryWithSystemKey();
  };

  const handleRetryPersonalKey = () => {
    setCustomKeyErrorModal(null);
    setTimeout(() => {
      handleAnalyzeRadiograph();
    }, 50);
  };

  const handleCancel = () => {
    setCustomKeyErrorModal(null);
    setIsAnalyzing(false);
  };

  return (
    <div 
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="byok-error-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full p-4 sm:p-6 space-y-3 sm:space-y-5 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200 my-auto max-h-[calc(100dvh-16px)] flex flex-col overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </div>
            <div>
              <h3 id="byok-error-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('byokErrorModalTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('byokErrorModalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
            aria-label={t('byokCancelBtn')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notice Content */}
        <div className="bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-4 text-xs text-amber-950 dark:text-amber-200 leading-relaxed font-medium space-y-2">
          <p className="font-semibold text-amber-900 dark:text-amber-300">
            {customKeyErrorModal.message}
          </p>
          <p className="text-amber-800 dark:text-amber-300/80">
            {t('byokErrorModalMsg')}
          </p>
        </div>

        {/* Actions: Three explicit choices */}
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={handleRetryPersonalKey}
              className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors shadow-xs flex items-center justify-center space-x-2 cursor-pointer border border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>{t('byokRetryCustomKeyBtn')}</span>
            </button>

            {isSystemAvailable && (
              <button
                type="button"
                onClick={handleSwitchToAppKey}
                className={`flex-1 px-4 py-2.5 text-white font-bold text-xs rounded-xl transition-colors shadow-xs flex items-center justify-center space-x-2 cursor-pointer ${
                  isPathology
                    ? 'bg-teal-600 hover:bg-teal-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <KeyRound className="w-4 h-4" />
                <span>{t('byokSwitchToAppKeyBtn')}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleCancel}
            className="w-full px-4 py-2 bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium text-xs rounded-xl transition-colors flex items-center justify-center cursor-pointer"
          >
            <span>{t('byokCancelBtn')}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
