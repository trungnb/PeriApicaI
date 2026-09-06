import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import {
  Trash2,
  AlertTriangle,
  X,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  CheckCircle,
  FileText,
  Bug,
  Activity,
} from 'lucide-react';
import { deleteSingleDocument } from '../../../services/apiService';

export interface DeleteTargetItem {
  docId: string;
  collection: 'reports' | 'bugs' | 'seg_reports';
  title?: string;
  timestamp?: string;
  meta?: string;
}

interface DeleteConfirmModalProps {
  target: DeleteTargetItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (docId: string, collection: 'reports' | 'bugs' | 'seg_reports') => void;
  getAuthHeader: () => Record<string, string>;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  target,
  isOpen,
  onClose,
  onSuccess,
  getAuthHeader,
}) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setErrorMessage(null);
      setSuccessMessage(null);
      setShowPassword(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, target]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen || !target) return null;

  const getCollectionLabel = (col: string) => {
    if (col === 'reports') {
      return {
        name: i18n.language === 'en' ? 'Clinical Assessment Report' : 'Báo cáo Ca Chụp Kỹ Thuật',
        icon: <FileText className="w-4 h-4 text-blue-500" />,
        badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800/60',
      };
    }
    if (col === 'bugs') {
      return {
        name: i18n.language === 'en' ? 'Bug Report Record' : 'Báo cáo Lỗi Hệ Thống (Bug)',
        icon: <Bug className="w-4 h-4 text-amber-500" />,
        badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
      };
    }
    return {
      name: i18n.language === 'en' ? 'Pathology Activity Record' : 'Nhật Ký Phân Tích Bất Thường',
      icon: <Activity className="w-4 h-4 text-purple-500" />,
      badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
    };
  };

  const colInfo = getCollectionLabel(target.collection);

  const handleDelete = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password.trim()) {
      setErrorMessage(
        i18n.language === 'en'
          ? 'Please enter the deletion password (DEL_PASSWORD).'
          : 'Vui lòng nhập mật khẩu xoá dữ liệu (DEL_PASSWORD).'
      );
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await deleteSingleDocument(
        {
          docId: target.docId,
          collection: target.collection,
          password: password.trim(),
        },
        getAuthHeader()
      );

      if (result.success) {
        setSuccessMessage(
          result.message ||
            (i18n.language === 'en'
              ? 'Document deleted successfully from Firestore.'
              : 'Đã xóa bản ghi thành công khỏi cơ sở dữ liệu.')
        );
        setTimeout(() => {
          onSuccess(target.docId, target.collection);
          onClose();
        }, 500);
      } else {
        setErrorMessage(
          result.message ||
            (i18n.language === 'en' ? 'Deletion failed.' : 'Lỗi khi xoá dữ liệu.')
        );
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          (i18n.language === 'en'
            ? 'Failed to connect to server or incorrect password.'
            : 'Không thể kết nối đến máy chủ hoặc mật khẩu không chính xác.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="delete-confirm-modal-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 overflow-y-auto bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
    >
      <div
        id="delete-confirm-modal-container"
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden transform transition-all my-auto max-h-[calc(100dvh-16px)] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800/80 bg-rose-50/50 dark:bg-rose-950/20 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-inner">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {i18n.language === 'en' ? 'Confirm Deletion' : 'Xác Nhận Xoá Dữ Liệu'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {i18n.language === 'en' ? 'Safe Firestore removal' : 'Xoá an toàn khỏi Firestore'}
              </p>
            </div>
          </div>
          <button
            id="btn-close-delete-confirm-modal"
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleDelete} className="p-4 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {/* Target Document Card */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                {i18n.language === 'en' ? 'Data Type:' : 'Phân loại:'}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border font-medium ${colInfo.badgeClass}`}>
                {colInfo.icon}
                {colInfo.name}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                {i18n.language === 'en' ? 'Document ID:' : 'Mã bản ghi (ID):'}
              </span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 max-w-[200px] truncate" title={target.docId}>
                {target.docId}
              </span>
            </div>

            {target.timestamp && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {i18n.language === 'en' ? 'Recorded At:' : 'Thời gian ghi:'}
                </span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">
                  {target.timestamp}
                </span>
              </div>
            )}

            {target.meta && (
              <div className="pt-1 text-slate-600 dark:text-slate-300 border-t border-slate-200/50 dark:border-slate-700/50 truncate">
                {target.meta}
              </div>
            )}
          </div>

          {/* Warning Message */}
          <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-amber-900 dark:text-amber-200 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {i18n.language === 'en'
                ? 'This action is irreversible. The record will be permanently deleted from Cloud Firestore and system storage, and aggregate statistics will decrement automatically.'
                : 'Thao tác này không thể hoàn tác. Bản ghi sẽ bị xoá vĩnh viễn khỏi Cloud Firestore và máy chủ, số liệu thống kê sẽ được tự động cập nhật ngay.'}
            </p>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="del-password-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                {i18n.language === 'en' ? 'Deletion Password (DEL_PASSWORD):' : 'Mật khẩu xoá dữ liệu (DEL_PASSWORD):'}
              </span>
              <span className="text-[11px] font-normal text-rose-500">* Bắt buộc</span>
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="del-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={isLoading}
                placeholder={
                  i18n.language === 'en'
                    ? 'Enter deletion password...'
                    : 'Nhập mật khẩu xoá dữ liệu...'
                }
                className="w-full px-3.5 py-2.5 pr-10 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 transition-all"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center space-x-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center space-x-2 animate-in fade-in">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
            >
              {t('admin:cancelBtn', 'Hủy bỏ')}
            </button>
            <button
              id="btn-confirm-delete-document"
              type="submit"
              disabled={isLoading || !password.trim()}
              className="inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700 rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('admin:processing', 'Đang xử lý...')}</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{i18n.language === 'en' ? 'Delete Permanently' : 'Xoá vĩnh viễn'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
