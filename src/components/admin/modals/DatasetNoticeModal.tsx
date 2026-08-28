import { useTranslation } from 'react-i18next';
import React from 'react';
import { Code, Cloud, Sparkles, X } from 'lucide-react';
import { Language } from '../../../types/dental';

interface DatasetNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
}

export const DatasetNoticeModal: React.FC<DatasetNoticeModalProps> = ({
  isOpen,
  onClose,
  language,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-950 rounded-2xl max-w-md w-full border border-slate-200 dark:border-blue-900/60 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-400/30 text-indigo-300">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                {t('exportAiTrainingDataset9')}
              </h4>
              <p className="text-[11px] text-slate-400">
                {t('jsonFormatForAi')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-slate-700 dark:text-slate-200">
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-start space-x-3">
            <Cloud className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <strong className="block font-bold text-amber-950 dark:text-amber-100 mb-0.5">
                {t('cloudStorageRequired')}
              </strong>
              {t('theAiTrainingDataset')}
            </div>
          </div>

          <div className="text-xs text-slate-600 dark:text-blue-300/80 space-y-2 bg-slate-50 dark:bg-blue-900/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-blue-800/60">
            <div className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{t('targetOutputFormatSpecification')}</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-blue-300/70 leading-normal pl-5">
              {language === 'EN' ? (
                <>
                  • Direct URL links to cloud periapical X-ray image assets.<br />
                  • Error classifications (Bounding Boxes / Taxonomy IDs) and clinical expert annotations.
                </>
              ) : (
                <>
                  • Liên kết trực tiếp đường dẫn URL ảnh Cloud lưu trữ phim cận chóp.<br />
                  • Nhãn phân loại nhãn lỗi (Bounding Boxes / Taxonomy IDs) và ghi chú từ chuyên gia nha khoa.
                </>
              )}
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 dark:bg-blue-950 p-3.5 border-t border-slate-200 dark:border-blue-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
          >
            {t('understood')}
          </button>
        </div>
      </div>
    </div>
  );
};
