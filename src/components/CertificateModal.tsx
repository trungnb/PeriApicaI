import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export const CertificateModal: React.FC = () => {
  const isOpen = useAppStore(state => state.isCertModalOpen);
  const setIsOpen = useAppStore(state => state.setIsCertModalOpen);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  const close = () => setIsOpen(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cert-modal-title"
    >
      <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="h-1.5 shrink-0 bg-gradient-to-r from-blue-600 via-sky-400 to-indigo-500" />
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 id="cert-modal-title" className="text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base">
            Chứng nhận Top 500 AI Riser
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-2 dark:bg-slate-950 sm:p-4">
          {imageError ? (
            <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
              Không thể tải ảnh chứng nhận.
            </p>
          ) : (
            <img
              src="/certificate.png"
              alt="Chứng nhận AI Riser Vietnam 2026"
              onError={() => setImageError(true)}
              className="h-auto max-h-[80vh] max-w-full rounded-lg object-contain shadow-md"
            />
          )}
        </div>
      </div>
    </div>
  );
};
