import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { deleteAdminData } from '../../services/apiService';

export interface BatchDeleteSuccessInfo {
  deletedCount: number;
  deleteTypes: string[];
  timeConfig: { isAllTime: boolean; startDate?: string; endDate?: string };
}

interface DeleteDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (info?: BatchDeleteSuccessInfo) => void;
  getAuthHeader: () => Record<string, string>;
}

export const DeleteDataModal: React.FC<DeleteDataModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  getAuthHeader,
}) => {
  const { t, i18n } = useTranslation('admin');

  const [timeMode, setTimeMode] = useState<'date_range' | 'all_time' | null>(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  const [deleteTypes, setDeleteTypes] = useState<string[]>([]);
  const [password, setPassword] = useState<string>('');
  
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  // Validation logic for disabling checkboxes
  const isTimeValid = () => {
    if (timeMode === 'all_time') return true;
    if (timeMode === 'date_range' && startDate && endDate && new Date(startDate) <= new Date(endDate)) {
      return true;
    }
    return false;
  };

  const handleCheckboxChange = (type: string) => {
    if (type === 'all') {
      if (deleteTypes.includes('all')) {
        setDeleteTypes([]);
      } else {
        setDeleteTypes(['all', 'incomplete', 'errors', 'bugs', 'test']);
      }
    } else {
      let newTypes = [...deleteTypes];
      if (newTypes.includes(type)) {
        newTypes = newTypes.filter((t) => t !== type);
        newTypes = newTypes.filter((t) => t !== 'all'); // Uncheck 'all' if one is removed
      } else {
        newTypes.push(type);
        // Check 'all' if everything else is selected
        if (['incomplete', 'errors', 'bugs', 'test'].every(t => newTypes.includes(t))) {
          newTypes.push('all');
        }
      }
      setDeleteTypes(newTypes);
    }
  };

  const handleDelete = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isTimeValid()) {
      setErrorMessage(t('admin:timeRequired'));
      return;
    }

    if (deleteTypes.length === 0) {
      setErrorMessage(t('admin:typeRequired'));
      return;
    }

    setIsDeleting(true);

    try {
      const payload = {
        timeConfig: {
          isAllTime: timeMode === 'all_time',
          startDate: timeMode === 'date_range' ? startDate : undefined,
          endDate: timeMode === 'date_range' ? endDate : undefined,
        },
        deleteTypes,
        password
      };

      const res = await deleteAdminData(payload, getAuthHeader());

      if (res.success) {
        setSuccessMessage(res.message || t('admin:deletedSuccess', { count: res.deletedCount || 0 }));
        setTimeout(() => {
          onSuccess({
            deletedCount: res.deletedCount || 0,
            deleteTypes,
            timeConfig: payload.timeConfig,
          });
          onClose();
        }, 1200);
      } else {
        setErrorMessage(res.message || t('admin:deleteFailed'));
      }
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.error('Delete error:', err);
      setErrorMessage(err?.message || t('admin:networkError'));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  const timeValid = isTimeValid();
  const canSubmit = timeValid && deleteTypes.length > 0;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto flex flex-col max-h-[calc(100dvh-16px)] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-rose-950 dark:bg-rose-950 text-white p-3 sm:p-5 flex items-center justify-between border-b border-rose-900 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-600/30 rounded-xl border border-rose-500/40 text-rose-300">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                {t('admin:deleteModal_title')}
              </h3>
              <p className="text-xs text-rose-300">
                {t('admin:subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-rose-900/50 hover:bg-rose-800 rounded-xl text-rose-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-950">
          
          {/* Step 1: Time Selection */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-2">
              {t('admin:stepTime')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center space-x-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer transition-colors bg-white dark:bg-slate-900 hover:border-rose-400">
                <input
                  type="radio"
                  name="timeMode"
                  value="date_range"
                  checked={timeMode === 'date_range'}
                  onChange={() => setTimeMode('date_range')}
                  className="text-rose-600 focus:ring-rose-500 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('admin:dateRange')}</span>
              </label>
              
              <label className="flex items-center space-x-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer transition-colors bg-white dark:bg-slate-900 hover:border-rose-400">
                <input
                  type="radio"
                  name="timeMode"
                  value="all_time"
                  checked={timeMode === 'all_time'}
                  onChange={() => setTimeMode('all_time')}
                  className="text-rose-600 focus:ring-rose-500 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('admin:allTime')}</span>
              </label>
            </div>

            {timeMode === 'date_range' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {t('admin:fromDate')}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-sm font-medium focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    {t('admin:toDate')}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-sm font-medium focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                  />
                </div>
                {startDate && endDate && new Date(startDate) > new Date(endDate) && (
                  <div className="col-span-1 sm:col-span-2 text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {t('admin:invalidDateOrder')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Data Type Selection */}
          <div className={`space-y-4 transition-opacity duration-300 ${!timeValid ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-2 flex items-center justify-between">
              <span>{t('admin:stepDataType')}</span>
              {!timeValid && (
                <span className="text-xs font-normal text-rose-500 dark:text-rose-400">
                  {t('admin:timeFirstPrompt')}
                </span>
              )}
            </h4>
            
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('all')}
                  onChange={() => handleCheckboxChange('all')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-bold text-rose-900 dark:text-rose-300">{t('admin:allData')}</span>
              </label>

              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('incomplete')}
                  onChange={() => handleCheckboxChange('incomplete')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin:incomplete')}</span>
              </label>

              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('errors')}
                  onChange={() => handleCheckboxChange('errors')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin:errors')}</span>
              </label>

              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('seg_reports')}
                  onChange={() => handleCheckboxChange('seg_reports')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {i18n.language === 'en' ? 'Anomaly Segmentation Logs (Flow B - seg_reports)' : 'Nhật ký Phân đoạn Bất thường (Luồng B - seg_reports)'}
                </span>
              </label>

              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('bugs')}
                  onChange={() => handleCheckboxChange('bugs')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin:bugs')}</span>
              </label>

              <label className="flex items-center space-x-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={deleteTypes.includes('test')}
                  onChange={() => handleCheckboxChange('test')}
                  disabled={!timeValid}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 disabled:opacity-50 accent-rose-600"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('admin:test')}</span>
              </label>
            </div>
          </div>

          {/* Warning Message */}
          <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 rounded-xl flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-900 dark:text-rose-200 font-medium leading-relaxed">
              <strong className="font-bold block text-rose-950 dark:text-rose-100 text-sm mb-1">{t('admin:warningTitle')}</strong>
              {t('admin:warningDesc')}
            </div>
          </div>

          {/* Feedback messages */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 font-bold flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex-1 max-w-xs">
            <input
              type="password"
              placeholder={t('admin:deleteModal_passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 transition-colors"
            />
          </div>
          <div className="flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors disabled:opacity-50"
            >
              {t('admin:cancelBtn')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || !canSubmit || !password}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 transition-all cursor-pointer flex items-center space-x-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('admin:processing')}</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  <span>{t('admin:deleteModal_deleteBtn')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
