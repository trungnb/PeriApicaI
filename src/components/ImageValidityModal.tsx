import React from 'react';
import { useAppStore } from '../store/appStore';
import {
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  ArrowRight,
  X,
  Camera,
} from 'lucide-react';
import { ALL_TEETH } from '../data/taxonomyData';

export const ImageValidityModal: React.FC = () => {
  const {
    validityModal,
    setValidityModal,
    language,
    setSelectedTooth,
    setImageDataUrl,
  } = useAppStore();

  if (!validityModal || !validityModal.isOpen) return null;

  const isEn = language === 'EN';
  const { type, issue, result, message, onConfirm, onRetry, onCancel } = validityModal;

  const handleClose = () => {
    onCancel?.();
    setValidityModal(null);
  };

  const handleConfirm = () => {
    onConfirm?.();
    setValidityModal(null);
  };

  const handleRetry = () => {
    onRetry?.();
    setValidityModal(null);
  };

  const handleSelectToothCandidate = (fdi: number) => {
    const found = ALL_TEETH.find((t) => t.fdiNumber === String(fdi));
    if (found) {
      setSelectedTooth(found);
    }
    setValidityModal(null);
  };

  const handleTriggerReplaceImage = () => {
    setValidityModal(null);
    setImageDataUrl(null);
  };

  // Header styling & icon depending on state
  let modalTitle = '';
  let badgeColor = '';
  let IconComponent = AlertCircle;

  if (type === 'unavailable') {
    IconComponent = HelpCircle;
    badgeColor = 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    modalTitle = isEn
      ? 'Validity Pre-Flight Unavailable'
      : 'Không thể kiểm tra tính hợp lệ lúc này';
  } else if (type === 'warning') {
    IconComponent = AlertTriangle;
    badgeColor = 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800';
    modalTitle = isEn
      ? 'Tooth Alignment Uncertain'
      : 'Cần xác nhận: Vị trí răng chưa chắc chắn';
  } else {
    IconComponent = AlertCircle;
    badgeColor = 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800';
    modalTitle = isEn
      ? 'Image Not Suitable for Analysis'
      : 'Ảnh chưa phù hợp để phân tích';
  }

  return (
    <div
      id="image-validity-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="validity-modal-title"
    >
      <div
        id="image-validity-modal-container"
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[calc(100dvh-16px)] sm:max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${badgeColor}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="validity-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {modalTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEn ? 'Pre-Analysis Quality & Tooth Alignment Gate' : 'Cổng kiểm tra tiền phân tích hình ảnh'}
              </p>
            </div>
          </div>
          <button
            id="validity-modal-close-btn"
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label={isEn ? 'Close' : 'Đóng'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto flex-1">
          {/* Main message */}
          {message && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-sm text-slate-700 dark:text-slate-300 leading-relaxed border border-slate-200 dark:border-slate-700">
              {message}
            </div>
          )}

          {/* Orientation note (supporting role) */}
          {result && (result.orientation === 'possibly_incorrect' || result.orientation === 'uncertain') && (
            <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <Camera className="w-4 h-4 text-slate-500" />
              <span>
                {isEn
                  ? `Orientation note: Radiograph orientation appears ${result.orientation.replace('_', ' ')}.`
                  : `Lưu ý chiều phim: Chiều phim có thể chưa chuẩn hoặc chưa xác định rõ.`}
              </span>
            </div>
          )}

          {/* AI Detected tooth candidates when mismatched */}
          {issue === 'mismatch' && result?.detectedToothCandidates && result.detectedToothCandidates.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-2">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                {isEn
                  ? 'AI-estimated candidate teeth observed (reference only):'
                  : 'AI ước tính các răng có thể xuất hiện trong ảnh (tham khảo):'}
              </p>
              <div className="flex flex-wrap gap-2">
                {result.detectedToothCandidates.map((fdi) => (
                  <button
                    key={fdi}
                    type="button"
                    onClick={() => handleSelectToothCandidate(fdi)}
                    className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900 transition flex items-center gap-1"
                  >
                    <span>{isEn ? `Tooth ${fdi}` : `Răng ${fdi}`}</span>
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                      ({isEn ? 'Switch' : 'Chọn nhanh'})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 px-4 sm:px-6 py-2.5 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          {/* Mode: Unavailable -> Retry, Continue Anyway, Cancel */}
          {type === 'unavailable' && (
            <>
              <button
                id="validity-unavailable-cancel-btn"
                type="button"
                onClick={handleClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
              >
                {isEn ? 'Cancel' : 'Hủy bỏ'}
              </button>
              {onRetry && (
                <button
                  id="validity-unavailable-retry-btn"
                  type="button"
                  onClick={handleRetry}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isEn ? 'Retry Validation' : 'Thử lại'}
                </button>
              )}
              {onConfirm && (
                <button
                  id="validity-unavailable-continue-btn"
                  type="button"
                  onClick={handleConfirm}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-sm flex items-center gap-1.5"
                >
                  <span>{isEn ? 'Continue Analysis Anyway' : 'Bỏ qua & Tiếp tục phân tích'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {/* Mode: Warning (Uncertain) -> Cancel/Change, Continue Anyway */}
          {type === 'warning' && (
            <>
              <button
                id="validity-warning-cancel-btn"
                type="button"
                onClick={handleClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
              >
                {isEn ? 'Check Tooth Selection' : 'Kiểm tra lại răng đã chọn'}
              </button>
              {onConfirm && (
                <button
                  id="validity-warning-continue-btn"
                  type="button"
                  onClick={handleConfirm}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition shadow-sm flex items-center gap-1.5"
                >
                  <span>{isEn ? 'I Confirm — Continue Analysis' : 'Xác nhận & Tiếp tục phân tích'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {/* Mode: Invalid -> Replace Image, Change Tooth */}
          {type === 'invalid' && (
            <>
              <button
                id="validity-invalid-close-btn"
                type="button"
                onClick={handleClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
              >
                {isEn ? 'Close & Choose Another Tooth' : 'Đóng & Chọn lại răng'}
              </button>
              <button
                id="validity-invalid-replace-img-btn"
                type="button"
                onClick={handleTriggerReplaceImage}
                className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition shadow-sm flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5" />
                {isEn ? 'Replace Image' : 'Chọn ảnh khác'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
