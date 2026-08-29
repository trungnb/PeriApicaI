import { useTranslation } from 'react-i18next';
import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { AlertTriangle, X } from 'lucide-react';

export const GlobalAlertModal: React.FC = () => {
  const { t } = useTranslation('common');
  const globalError = useAppStore(state => state.globalError);
  const setGlobalError = useAppStore(state => state.setGlobalError);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && globalError) {
        setGlobalError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [globalError, setGlobalError]);

  if (!globalError) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="global-alert-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-rose-200/80 dark:border-rose-900/60 animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-rose-50/80 dark:bg-rose-950/40 px-6 py-5 flex items-start gap-4 border-b border-rose-100 dark:border-rose-900/40">
          <div className="flex-shrink-0 bg-rose-100 dark:bg-rose-900/60 p-2.5 rounded-2xl mt-0.5 border border-rose-200 dark:border-rose-800/80">
            <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 id="global-alert-modal-title" className="font-extrabold text-rose-950 dark:text-rose-200 mb-1 text-base">
              {t('globalError_title')}
            </h3>
            <p className="text-rose-900 dark:text-rose-300 text-xs sm:text-sm leading-relaxed font-medium">{globalError}</p>
          </div>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900 px-6 py-3.5 flex justify-end border-t border-slate-100 dark:border-slate-800">
          <button 
            onClick={() => setGlobalError(null)}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl transition-all font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <X className="w-4 h-4 text-white" /> {t('globalError_close')}
          </button>
        </div>
      </div>
    </div>
  );
};
