import { useTranslation } from 'react-i18next';
import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { AlertTriangle } from 'lucide-react';

export const SystemNoticeModal: React.FC = () => {
  const language = useAppStore((state) => state.language);
  const { t, i18n } = useTranslation('common');
  const systemNoticeModal = useAppStore((state) => state.systemNoticeModal);
  const setSystemNoticeModal = useAppStore((state) => state.setSystemNoticeModal);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && systemNoticeModal?.isOpen) {
        setSystemNoticeModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [systemNoticeModal, setSystemNoticeModal]);

  if (!systemNoticeModal || !systemNoticeModal.isOpen) return null;

  const defaultTitle = t('defaultTitle');
  const title = systemNoticeModal.title || defaultTitle;
  const message = systemNoticeModal.message;

  return (
    <div
      id="system-notice-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-notice-modal-title"
    >
      <div
        id="system-notice-modal-card"
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-amber-200 dark:border-amber-900/60 animate-in zoom-in-95 duration-200"
      >
        <div className="bg-amber-50/90 dark:bg-amber-950/40 px-6 py-5 flex items-start gap-4 border-b border-amber-100 dark:border-amber-900/40">
          <div className="shrink-0 bg-amber-100/90 dark:bg-amber-900/60 p-2.5 rounded-2xl mt-0.5 border border-amber-200 dark:border-amber-800/80 shadow-2xs">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 space-y-1.5">
            <h3 id="system-notice-modal-title" className="font-bold text-amber-950 dark:text-amber-200 text-base tracking-tight">
              {title}
            </h3>
            <p id="system-notice-modal-message" className="text-amber-900/90 dark:text-amber-300/90 text-xs sm:text-sm leading-relaxed font-medium whitespace-pre-line">
              {message}
            </p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 px-6 py-3.5 flex justify-end border-t border-slate-100 dark:border-slate-800">
          <button
            id="system-notice-modal-close-btn"
            onClick={() => setSystemNoticeModal(null)}
            className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl transition-all font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer min-h-[40px]"
          >
            <span>{t('systemNotice_close')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
