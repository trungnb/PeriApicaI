import { useTranslation } from 'react-i18next';
import React from 'react';
import { Users, X } from 'lucide-react';
import { Language } from '../../../types/dental';

export interface UniqueUserItem {
  userId: string;
  totalSessions: number;
  completedSessions: number;
  lastActive: string;
  lastTooth: string;
}

interface UserDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  uniqueUsersList: UniqueUserItem[];
}

export const UserDirectoryModal: React.FC<UserDirectoryModalProps> = ({
  isOpen,
  onClose,
  language,
  uniqueUsersList,
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
        className="bg-white dark:bg-slate-950 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-blue-900/60 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-500/20 text-blue-300 rounded-xl border border-blue-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {t('userDirectory')}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          <div className="text-xs text-slate-500 dark:text-blue-300/70 flex justify-between items-center pb-2 border-b border-slate-100 dark:border-blue-900/60">
            <span>
              {t('total')}
              <strong className="text-slate-900 dark:text-slate-100 font-bold">
                {uniqueUsersList.length} {language === 'EN' ? (uniqueUsersList.length > 1 ? 'users' : 'user') : 'người dùng'}
              </strong>
            </span>
            <span>{t('sortedByTotalAssessment')}</span>
          </div>

          {uniqueUsersList.length === 0 ? (
            <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-xs">
              {t('noUserSessionData')}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-blue-900/60 border border-slate-200 dark:border-blue-900/60 rounded-xl overflow-hidden">
              {uniqueUsersList.map((usr, idx) => (
                <div key={usr.userId} className="p-3.5 bg-white dark:bg-blue-950/40 hover:bg-slate-50/80 dark:hover:bg-blue-900/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="w-7 h-7 rounded-full bg-slate-100 dark:bg-blue-900/80 text-slate-700 dark:text-blue-200 font-bold flex items-center justify-center text-xs shrink-0 border border-slate-200 dark:border-blue-700">
                      #{idx + 1}
                    </span>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100 font-mono flex items-center gap-2 flex-wrap">
                        <span>{usr.userId}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-blue-300/70 mt-0.5">
                        {t('lastActive')}
                        <span className="font-medium text-slate-800 dark:text-slate-200">{usr.lastActive}</span> | {t('lastTooth')}
                        <span className="font-semibold text-blue-700 dark:text-blue-400">{usr.lastTooth}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 text-right shrink-0 self-end sm:self-center">
                    <div className="bg-slate-50 dark:bg-blue-900/60 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-blue-700/60">
                      <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {usr.totalSessions} <span className="text-[11px] font-normal text-slate-500 dark:text-blue-300/70">{t('sessions6')}</span>
                      </p>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        {usr.completedSessions} {t('completed2')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-blue-950 p-3.5 border-t border-slate-200 dark:border-blue-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};
