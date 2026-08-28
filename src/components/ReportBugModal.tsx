import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { Bug, X, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export const ReportBugModal: React.FC = () => {
  const { t } = useTranslation('common');

  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const isOpen = useAppStore((state) => state.isBugModalOpen);
  const setIsOpen = useAppStore((state) => state.setIsBugModalOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, setIsOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const res = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          path: window.location.pathname,
          timestamp: new Date().toISOString(),
          source: 'USER_SUBMITTED',
          severity: 'INFO',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSubmitStatus('success');
        setTimeout(() => {
          setIsOpen(false);
          setDescription('');
          setSubmitStatus('idle');
        }, 1000);
      } else {
        setSubmitStatus('error');
      }
    } catch (err) {
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bug-modal-title"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200/90 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
                <Bug className="w-5 h-5" aria-hidden="true" />
                <h3 id="bug-modal-title" className="font-bold text-slate-900 dark:text-slate-100">{t('bugModal_title')}</h3>
              </div>
              <button
                type="button"
                onClick={() => !isSubmitting && setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                disabled={isSubmitting}
                aria-label={t('cancel') || 'Close'}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="space-y-2">
                <label htmlFor="bug-description-input" className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {t('label')}
                </label>
                <textarea
                  id="bug-description-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('placeholder')}
                  className="w-full min-h-[120px] p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 outline-none transition-all resize-none text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  disabled={isSubmitting || submitStatus === 'success'}
                  autoFocus
                />
              </div>

              {submitStatus === 'error' && (
                <div role="alert" className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
                  {t('error')}
                </div>
              )}

              {submitStatus === 'success' && (
                <div role="status" aria-live="polite" className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-center space-x-2">
                  <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                  <span>{t('success')}</span>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors mr-2 cursor-pointer"
                  disabled={isSubmitting}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!description.trim() || isSubmitting || submitStatus === 'success'}
                  className="flex items-center space-x-2 px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-600 text-white text-sm font-medium rounded-lg shadow-sm transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('sending')}</span>
                    </>
                  ) : submitStatus === 'success' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('sent')}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>{t('submit')}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
