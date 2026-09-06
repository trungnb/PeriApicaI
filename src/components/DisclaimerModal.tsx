import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, Sparkles, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  onClose?: () => void;
}

export const DisclaimerModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation('welcome');
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Focus the primary acknowledgement button for immediate keyboard accessibility
    confirmButtonRef.current?.focus();

    // Prevent Escape key from dismissing the mandatory disclaimer
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const handleConfirm = () => {
    if (onClose) onClose();
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-modal-title"
      >
        {/* Backdrop - Explicitly non-dismissible by backdrop click */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-md select-none pointer-events-auto"
          aria-hidden="true"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-10 my-auto max-h-[calc(100dvh-16px)] flex flex-col"
        >
          {/* Top Decorative Header Accent */}
          <div className="h-2 bg-gradient-to-r from-amber-500 via-sky-500 to-teal-400 shrink-0" />

          <div className="p-4 sm:p-7 overflow-y-auto flex-1 flex flex-col justify-between">
            <div>
              {/* Badge & Icon Header */}
              <div className="flex items-center gap-3 mb-3 sm:mb-4">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/20 dark:border-amber-400/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </div>
                <div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold tracking-wide uppercase bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800/80">
                    <Sparkles className="w-3 h-3 text-amber-500" aria-hidden="true" />
                    {t('disclaimerBadge')}
                  </span>
                  <h3 id="disclaimer-modal-title" className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mt-0.5 sm:mt-1">
                    {t('disclaimerTitle')}
                  </h3>
                </div>
              </div>

              {/* Description Body */}
              <div className="space-y-2 sm:space-y-3.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3 sm:p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {t('disclaimerDesc')}
                </p>
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>{t('disclaimerAdvice')}</span>
                </div>
              </div>
            </div>

            {/* Footer Action Button - Sole Acknowledgement Path */}
            <div className="mt-4 sm:mt-6 pt-2 flex justify-end shrink-0">
              <button
                ref={confirmButtonRef}
                type="button"
                id="disclaimer-acknowledge-button"
                onClick={handleConfirm}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 font-extrabold text-sm shadow-md transition-all active:scale-95 cursor-pointer border border-slate-950 dark:border-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
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
