import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, Sparkles, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  onClose?: () => void;
}

export const DisclaimerModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation('welcome');

  const handleConfirm = () => {
    try {
      localStorage.setItem('periapic_disclaimer_seen', 'true');
    } catch {
      // Ignore storage errors
    }
    if (onClose) onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleConfirm}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-modal-title"
          className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-10 my-auto"
        >
          {/* Top Decorative Header Accent */}
          <div className="h-2 bg-gradient-to-r from-amber-500 via-sky-500 to-teal-400" />

          {/* Close Button (X) */}
          <button
            onClick={handleConfirm}
            className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={t('disclaimerConfirm') || 'Close'}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="p-6 sm:p-7">
            {/* Badge & Icon Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/20 dark:border-amber-400/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800/80">
                  <Sparkles className="w-3 h-3 text-amber-500" aria-hidden="true" />
                  {t('disclaimerBadge')}
                </span>
                <h3 id="disclaimer-modal-title" className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mt-1">
                  {t('disclaimerTitle')}
                </h3>
              </div>
            </div>

            {/* Description Body */}
            <div className="space-y-3.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {t('disclaimerDesc')}
              </p>
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>{t('disclaimerAdvice')}</span>
              </div>
            </div>

            {/* Footer Action Button */}
            <div className="mt-6 pt-2 flex justify-end">
              <button
                onClick={handleConfirm}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 font-extrabold text-sm shadow-md transition-all active:scale-95 cursor-pointer border border-slate-950 dark:border-white"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
                <span>{t('disclaimerConfirm')}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
