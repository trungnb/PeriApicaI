import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import {
  Star,
  ShieldCheck,
  X,
  EyeOff,
  CheckCircle2,
  XCircle,
  Check,
  Save,
  Loader2,
  Trash2,
} from 'lucide-react';
import { AssessmentLogPayload, Language } from '../../../types/dental';
import { TAXONOMY_ERRORS, getTaxonomyLabel, getDomainMeta, getTechniqueDisplayName } from '../../../data/taxonomyData';
import { formatDisplayTimestamp } from '../../../utils/dateUtils';
import { isLogAdminVerified } from '../../../utils/reportUtils';
import { verifyAssessmentLog } from '../../../services/apiService';
import { imageBlobCache } from '../../../utils/imageBlobCache';
import { useMetadataStore } from '../../../store/useMetadataStore';

interface ReviewDetailModalProps {
  selectedLog: AssessmentLogPayload | null;
  onClose: () => void;
  language: Language;
  getAuthHeader: () => Record<string, string>;
  onLogVerified: (updatedLog: AssessmentLogPayload) => void;
  setToastMsg: (msg: string | null) => void;
  onRequestDelete?: (target: { docId: string; collection: 'reports'; title?: string; timestamp?: string; meta?: string }) => void;
}

export const ReviewDetailModal: React.FC<ReviewDetailModalProps> = ({
  selectedLog,
  onClose,
  language,
  getAuthHeader,
  onLogVerified,
  setToastMsg,
  onRequestDelete,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  const [modalLog, setModalLog] = useState<AssessmentLogPayload | null>(selectedLog);
  const [imageError, setImageError] = useState<boolean>(false);
  const [adminConcurred, setAdminConcurred] = useState<boolean | null>(null);
  const [selectedErrors, setSelectedErrors] = useState<string[]>([]);
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [isSavingVerification, setIsSavingVerification] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedLog) {
      setModalLog(null);
      return;
    }

    // Resolve image from cache if available in current session
    const cached = imageBlobCache.get(selectedLog.assessmentId);
    const resolvedImageUrl = selectedLog.imageUrl || cached?.dataUrl || cached?.blobUrl || (selectedLog as any).imageDataUrl;

    setModalLog({
      ...selectedLog,
      imageUrl: resolvedImageUrl,
    });
    setImageError(false);

    const isAdmin = isLogAdminVerified(selectedLog);
    setAdminConcurred(isAdmin ? selectedLog.userValidation?.concurred : null);
    const initialErrors = selectedLog.finalConfirmedErrors || [];
    setSelectedErrors([...initialErrors]);
    setAdminNotes(selectedLog.userValidation?.userNotes || '');
  }, [selectedLog]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!selectedLog || !modalLog) return null;

  const handleToggleErrorKey = (key: string) => {
    setAdminConcurred(false);
    setSelectedErrors((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSaveAdminVerification = async (overrideErrors?: string[], overrideNotes?: string) => {
    setIsSavingVerification(true);
    try {
      const finalErrors = overrideErrors !== undefined ? overrideErrors : selectedErrors;
      const rawNotes = overrideNotes !== undefined ? overrideNotes : adminNotes;
      const formattedNotes = rawNotes.includes('Admin') ? rawNotes : '[Admin chốt] ' + rawNotes;

      const res = await verifyAssessmentLog({
        assessmentId: modalLog.assessmentId,
        verifiedErrors: finalErrors,
        verifiedNotes: formattedNotes,
      }, getAuthHeader());

      if (res.success) {
        setToastMsg('Đã chốt & lưu lỗi đánh giá thành công! ⭐');
        setTimeout(() => setToastMsg(null), 3500);

        const updatedLog = res.log;

        onLogVerified(updatedLog);
        setModalLog(updatedLog);
        useMetadataStore.getState().refreshMetadata().catch(console.warn);
      }
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.error('Verify error:', err);
      setToastMsg('Lỗi khi lưu chốt lỗi: ' + (err?.message || 'Không thể kết nối server'));
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setIsSavingVerification(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-950 w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 dark:border-blue-900/60 overflow-hidden my-auto max-h-[calc(100dvh-16px)] sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-3 sm:p-5 border-b border-slate-200 dark:border-blue-900/60 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">
                  {t('caseDetailsAdmin')}
                </h3>
                {isLogAdminVerified(modalLog) && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/40">
                    <ShieldCheck className="w-3 h-3 text-blue-400" />
                    <span>{t('checked')}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono">
                {t('caseId9')} {modalLog.assessmentId} • {t('time')} {formatDisplayTimestamp(modalLog.timestamp, modalLog.updatedAt, modalLog.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {onRequestDelete && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestDelete({
                    docId: modalLog.assessmentId,
                    collection: 'reports',
                    title: `Báo cáo ca chụp #${modalLog.assessmentId.slice(0, 8)}`,
                    timestamp: formatDisplayTimestamp(modalLog.timestamp, modalLog.updatedAt, modalLog.createdAt),
                    meta: `Răng: ${modalLog.tooth?.fdiNumber || (modalLog as any).toothFdiNumber || 'N/A'} - Trạng thái: ${modalLog.sessionStatus || 'N/A'}`,
                  });
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                title={t('admin:deleteTitle', 'Xoá ca chụp')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('adminPortal_deleteBtn', 'Xoá')}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: 2 Columns */}
        <div className="p-3 sm:p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 bg-slate-50 dark:bg-blue-950/30">
          {/* Left Column: Image & Metadata (4/10 ratio) */}
          <div className="lg:col-span-5 space-y-3 sm:space-y-4 flex flex-col">
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-semibold border-b border-slate-800 pb-2">
                <span>{t('periapicalRadiograph')}</span>
                {modalLog.shareConsent === false ? (
                  <span className="text-amber-400 text-[10px] font-bold flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> {t('notStored')}
                  </span>
                ) : (
                  <span className="text-blue-400 text-[10px] font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> {t('stored')}
                  </span>
                )}
              </div>
              <div className="min-h-[160px] sm:min-h-[260px] max-h-[40vh] bg-slate-950 rounded-lg flex items-center justify-center p-2 relative overflow-hidden border border-slate-800/80">
                {modalLog.shareConsent === false ? (
                  <div className="text-center p-4 space-y-2 text-slate-400">
                    <EyeOff className="w-8 h-8 mx-auto text-amber-500/80" />
                    <p className="text-[11px] text-slate-400">
                      {t('imageNotStoredPer')}
                    </p>
                  </div>
                ) : (modalLog.imageUrl || modalLog.imageDataUrl) && !imageError ? (
                  <img
                    src={modalLog.imageUrl || modalLog.imageDataUrl}
                    alt="X-ray Preview"
                    referrerPolicy="no-referrer"
                    className="max-h-[35vh] sm:max-h-[40vh] w-auto object-contain rounded-md"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <div className="text-center p-4 space-y-2 text-slate-500">
                    <EyeOff className="w-8 h-8 mx-auto text-slate-600/50" />
                    <p className="text-xs">
                      {t('imageExpiredFromTemporary')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Notice regarding temp memory image view */}
            <div className="bg-amber-50/90 dark:bg-amber-950/40 border-l-4 border-amber-500 border-t border-r border-b border-amber-200 dark:border-amber-800/60 rounded-xl p-3.5 text-xs text-amber-950 dark:text-amber-200 leading-relaxed space-y-1 shadow-xs">
              <div className="flex items-center space-x-2 font-semibold text-amber-900 dark:text-amber-300">
                <span className="text-amber-600 dark:text-amber-400">ℹ️</span>
                <span>{t('noticeOnTemporaryStorage')}</span>
              </div>
              <p className="text-amber-900/90 dark:text-amber-300/90 pl-5 leading-relaxed">
                {t('theDisplayedImageIs')}
              </p>
            </div>

            {/* Info row */}
            <div className="bg-white dark:bg-blue-950/60 p-3 rounded-xl border border-slate-200 dark:border-blue-900/60 flex items-center justify-between text-xs space-x-2">
              <div className="flex flex-col">
                <span className="text-slate-500 dark:text-blue-300/70 text-[10px] uppercase">{t('tooth9')}</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{modalLog.tooth?.fdiNumber || 'N/A'}</span>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:border-blue-900/60"></div>
              <div className="flex flex-col">
                <span className="text-slate-500 dark:text-blue-300/70 text-[10px] uppercase">{t('technique5')}</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{getTechniqueDisplayName(modalLog.technique || '', language)}</span>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:border-blue-900/60"></div>
              <div className="flex flex-col text-right">
                <span className="text-slate-500 dark:text-blue-300/70 text-[10px] uppercase">{t('stage')}</span>
                <span className="font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{modalLog.stage || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Right Column: AI Errors & Ground Truth (6/10 ratio) */}
          <div className="lg:col-span-7 space-y-4 flex flex-col">
            <div className="bg-white dark:bg-blue-950/60 rounded-2xl border border-slate-200/80 dark:border-blue-900/60 shadow-xs flex-1 flex flex-col overflow-hidden">
              {/* Validation Header */}
              <div className="p-3 border-b border-slate-200 dark:border-blue-900/60 bg-slate-100 dark:bg-blue-900/40 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center space-x-2">
                  <Star className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>{t('errorAssessment')}</span>
                </h3>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-blue-300/80 hidden sm:inline-block mr-1">
                    {t('concur')}
                  </span>
                  <button
                    onClick={async () => {
                      setAdminConcurred(true);
                      const userConfirmedKeys = modalLog.finalConfirmedErrors || [];
                      await handleSaveAdminVerification(userConfirmedKeys, '');
                      onClose();
                    }}
                    className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                      adminConcurred === true
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white dark:bg-blue-900/60 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-blue-700/60 hover:bg-slate-50 dark:hover:bg-blue-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t('yes')}</span>
                  </button>
                  <button
                    onClick={() => {
                      setAdminConcurred(false);
                      if (adminConcurred !== false) {
                        setSelectedErrors(modalLog.finalConfirmedErrors || modalLog.verifiedErrors || []);
                      }
                    }}
                    className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                      adminConcurred === false
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'bg-white dark:bg-blue-900/60 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-blue-700/60 hover:bg-slate-50 dark:hover:bg-blue-800'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{t('no')}</span>
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col min-h-0">
                {adminConcurred !== false ? (
                  <div className="space-y-3 overflow-y-auto flex-1 pr-1 custom-scrollbar">
                    {(() => {
                      const confirmedKeys = modalLog.finalConfirmedErrors || [];
                      if (confirmedKeys.length === 0) {
                        return (
                          <div className="p-4 text-center text-emerald-600 dark:text-emerald-400 font-bold text-xs bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                            {t('standardRadiographNoErrors')}
                          </div>
                        );
                      }

                      const groupedErrors: Record<string, typeof TAXONOMY_ERRORS> = {};
                      confirmedKeys.forEach((key) => {
                        const errDef = TAXONOMY_ERRORS.find((e) => e.key === key);
                        if (errDef) {
                          if (!groupedErrors[errDef.domainId]) groupedErrors[errDef.domainId] = [];
                          groupedErrors[errDef.domainId].push(errDef);
                        }
                      });

                      return Object.keys(groupedErrors).map((domainId) => {
                        const domainMeta = getDomainMeta(domainId, language)?.name || domainId;
                        const errors = groupedErrors[domainId];
                        return (
                          <div key={domainId} className="bg-white dark:bg-blue-950/60 rounded-xl p-3 border shadow-sm transition-all border-amber-300 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/20">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-blue-900/60 pb-2 mb-2">
                              <h4 className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">{domainMeta}</h4>
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold border border-amber-200 dark:border-amber-800/60">
                                {errors.length} {language === 'EN' ? (errors.length > 1 ? 'Errors' : 'Error') : 'Lỗi'}
                              </span>
                            </div>
                            <ul className="space-y-1">
                              {errors.map((err, idx) => (
                                <li key={idx} className="text-[11px] text-slate-700 dark:text-slate-300 flex items-start space-x-1.5">
                                  <span className="text-amber-500 dark:text-amber-400 mt-0.5 shrink-0">•</span>
                                  <div className="flex flex-col">
                                    <span className="font-semibold">{getTaxonomyLabel(err.key, language)}</span>
                                    <span className="text-slate-500 dark:text-blue-300/70">{language === 'EN' && err.descriptionEn ? err.descriptionEn : err.description}</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      });
                    })()}
                    {adminConcurred === null && (
                      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 text-xs rounded-xl border border-blue-200 dark:border-blue-800/60 text-center">
                        {t('pleaseSelectYesOr')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 space-y-3">
                    <div className="flex items-center justify-between bg-rose-50 dark:bg-rose-950/50 px-3 py-2 rounded-lg border border-rose-100 dark:border-rose-900/60">
                      <h4 className="font-bold text-rose-900 dark:text-rose-200 text-xs">
                        {t('pleaseReselectTheCorrect')}
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-200">
                        {t('selected')} {selectedErrors.length} {t('errors')}
                      </span>
                    </div>
                    <div className="space-y-3 overflow-y-auto pr-1 flex-1 custom-scrollbar">
                      {['domain_1', 'domain_2', 'domain_3'].map((domainId) => {
                        const domainErrors = TAXONOMY_ERRORS.filter((e) => e.domainId === domainId);
                        const domainTitle = getDomainMeta(domainId, language)?.name || domainId;

                        return (
                          <div key={domainId} className="space-y-1.5">
                            <p className="font-bold text-[11px] text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-blue-900/40 px-2 py-1 rounded">
                              {domainTitle}
                            </p>
                            <div className="space-y-1.5">
                              {domainErrors.map((item) => {
                                const isSelected = selectedErrors.includes(item.key);
                                return (
                                  <div
                                    key={item.key}
                                    onClick={() => handleToggleErrorKey(item.key)}
                                    className={`flex items-start space-x-2 p-2 rounded-lg border transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-amber-50/50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                                        : 'bg-white dark:bg-blue-950/40 border-slate-200 dark:border-blue-900/60 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-slate-50 dark:hover:bg-blue-900/50'
                                    }`}
                                  >
                                    <div className="mt-0.5 shrink-0">
                                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                                        isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-blue-900/80 border-slate-300 dark:border-blue-700'
                                      }`}>
                                        {isSelected && <Check className="w-2.5 h-2.5" />}
                                      </div>
                                    </div>
                                    <div className="space-y-0.5">
                                      <p className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">{getTaxonomyLabel(item.key, language)}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Save Action Section */}
                {adminConcurred === false && (
                  <div className="pt-4 mt-4 border-t border-slate-200 dark:border-blue-900/60 shrink-0 space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-200">
                        {t('notesGuidelines')}
                      </label>
                      <textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder={t('enterClinicalNotesOr')}
                        rows={2}
                        className="w-full text-[11px] p-2 rounded-lg border border-slate-300 dark:border-blue-700/60 bg-white dark:bg-blue-950/60 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        await handleSaveAdminVerification();
                        onClose();
                      }}
                      disabled={isSavingVerification}
                      className="w-full flex justify-center items-center space-x-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                    >
                      {isSavingVerification ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{t('saving')}</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>{t('saveEvaluation')}</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
