import React from 'react';
import { AlertTriangle, Key, RefreshCw, Edit3 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { useRadiographAnalysis } from '../hooks/useRadiographAnalysis';

export const CustomKeyErrorModal: React.FC = () => {
  const { t, i18n } = useTranslation('upload');
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const customKeyErrorModal = useAppStore(state => state.customKeyErrorModal);
  const setCustomKeyErrorModal = useAppStore(state => state.setCustomKeyErrorModal);
  const setApiKeyOption = useAppStore(state => state.setApiKeyOption);

  const { handleAnalyzeRadiograph } = useRadiographAnalysis();

  if (!customKeyErrorModal || !customKeyErrorModal.isOpen) return null;

  const handleSwitchToAppKey = () => {
    setApiKeyOption('system');
    setCustomKeyErrorModal(null);
    // Automatically re-trigger analysis with system key!
    setTimeout(() => {
      handleAnalyzeRadiograph();
    }, 100);
  };

  const handleReenterCustomKey = () => {
    setCustomKeyErrorModal(null);
    setTimeout(() => {
      const el = document.getElementById('byok-input-container');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = el.querySelector('input');
        if (input) input.focus();
      }
    }, 100);
  };

  return (
    <div 
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="byok-error-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start space-x-3.5 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div>
            <h3 id="byok-error-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t('byokErrorModalTitle')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {i18n.language === 'en' ? 'API Key limit or authorization error' : 'Lỗi hạn mức hoặc quyền truy cập API Key'}
            </p>
          </div>
        </div>

        {/* Notice Content */}
        <div className="bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-4 text-xs text-amber-950 dark:text-amber-200 leading-relaxed font-medium">
          {customKeyErrorModal.message || t('byokErrorModalMsg')}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleSwitchToAppKey}
            className={`flex-1 px-4 py-2.5 text-white font-bold text-xs rounded-xl transition-colors shadow-xs flex items-center justify-center space-x-2 cursor-pointer ${
              isPathology
                ? 'bg-teal-600 hover:bg-teal-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('byokSwitchToAppKeyBtn')}</span>
          </button>
          <button
            type="button"
            onClick={handleReenterCustomKey}
            className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Edit3 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            <span>{t('byokReenterCustomKeyBtn')}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
