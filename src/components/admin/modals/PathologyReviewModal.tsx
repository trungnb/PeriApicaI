import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import {
  Star,
  ShieldCheck,
  X,
  Save,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
} from 'lucide-react';
import { PathologyAssessmentLog, Language, ConfirmedPathology } from '../../../types/dental';
import { PATHOLOGY_TAXONOMY } from '../../../data/pathologyTaxonomyData';
import { formatDisplayTimestamp } from '../../../utils/dateUtils';
import { verifyPathologyAssessmentLog } from '../../../services/apiService';
import { imageBlobCache } from '../../../utils/imageBlobCache';
import { useMetadataStore } from '../../../store/useMetadataStore';

interface PathologyReviewModalProps {
  selectedLog: PathologyAssessmentLog | null;
  onClose: () => void;
  language: Language;
  getAuthHeader: () => Record<string, string>;
  onLogVerified: (updatedLog: PathologyAssessmentLog) => void;
  setToastMsg: (msg: string | null) => void;
  onRequestDelete?: (target: { docId: string; collection: 'seg_reports'; title?: string; timestamp?: string; meta?: string }) => void;
}

export const PathologyReviewModal: React.FC<PathologyReviewModalProps> = ({
  selectedLog,
  onClose,
  language,
  getAuthHeader,
  onLogVerified,
  setToastMsg,
  onRequestDelete,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  const [modalLog, setModalLog] = useState<PathologyAssessmentLog | null>(selectedLog);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [isSavingVerification, setIsSavingVerification] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);
  const [adminConcurred, setAdminConcurred] = useState<boolean | null>(null);

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

    // Initial selected keys: if finalConfirmedPathologies exist, use those; else if confirmedPathologies exist, use those; else detected
    let initialList: string[] = [];
    if (selectedLog.finalConfirmedPathologies && selectedLog.finalConfirmedPathologies.length > 0) {
      initialList = selectedLog.finalConfirmedPathologies.map(p => p.pathologyKey || (p as any).key);
    } else if (selectedLog.confirmedPathologies && selectedLog.confirmedPathologies.length > 0) {
      initialList = selectedLog.confirmedPathologies.map(p => p.pathologyKey || (p as any).key);
    } else if (selectedLog.detectedPathologies && selectedLog.detectedPathologies.length > 0) {
      initialList = selectedLog.detectedPathologies.map(p => p.pathologyKey || (p as any).key);
    }
    setSelectedKeys([...new Set(initialList.filter(Boolean))]);
    setAdminNotes(selectedLog.verifiedNotes || selectedLog.userNotes || '');
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

  const isVerified = Boolean(
    modalLog.isReviewedByAdmin ||
    modalLog.verifiedBy === 'Admin' ||
    modalLog.verifiedNotes?.includes('Admin')
  );

  const handleToggleKey = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSaveAdminVerification = async (keysToSave?: string[], customNotes?: string) => {
    setIsSavingVerification(true);
    try {
      const keys = keysToSave || selectedKeys;
      // Build final confirmed pathologies objects from selected keys
      const finalPathologies: ConfirmedPathology[] = keys.map((key, idx) => {
        const itemInfo = PATHOLOGY_TAXONOMY.find(t => t.key === key);
        const existing = (modalLog.confirmedPathologies || modalLog.detectedPathologies || []).find(
          p => p.pathologyKey === key || (p as any).key === key
        );
        return {
          id: existing?.id || `admin-pathology-${key}-${idx}`,
          pathologyKey: key as any,
          domainId: existing?.domainId || 'domain_p1',
          confidence: existing?.confidence || 100,
          bbox: existing?.bbox || [0, 0, 100, 100],
          polygonPoints: existing?.polygonPoints || [],
          color: itemInfo?.color || '#3b82f6',
          fillColor: `${itemInfo?.color || '#3b82f6'}33`,
          label: itemInfo?.label || key,
          labelEn: itemInfo?.labelEn || key,
          description: '',
          descriptionEn: '',
          geminiVerified: true,
          isUserEdited: true,
        };
      });

      const rawNotes = customNotes !== undefined ? customNotes : adminNotes;
      const formattedNotes = rawNotes.includes('Admin')
        ? rawNotes
        : '[Admin chốt] ' + (rawNotes.trim() || 'Đã xác minh bất thường Y tế');

      const res = await verifyPathologyAssessmentLog({
        assessmentId: modalLog.assessmentId,
        verifiedPathologies: finalPathologies,
        verifiedNotes: formattedNotes,
      }, getAuthHeader());

      if (res.success) {
        setToastMsg(t('adminPathologyGroundTruth'));
        setTimeout(() => setToastMsg(null), 3500);

        const updatedLog: PathologyAssessmentLog = {
          ...modalLog,
          finalConfirmedPathologies: finalPathologies,
          verifiedNotes: formattedNotes,
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'Admin',
          isReviewedByAdmin: true,
        };

        onLogVerified(updatedLog);
        setModalLog(updatedLog);
        useMetadataStore.getState().refreshMetadata().catch(console.warn);
      }
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.error('Verify pathology error:', err);
      setToastMsg((t('errorSavingVerification')) + (err?.message || 'Lỗi kết nối'));
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setIsSavingVerification(false);
    }
  };

  const detectedKeys = (modalLog.detectedPathologies || []).map(p => p.pathologyKey || (p as any).key);
  const doctorConfirmedKeys = (modalLog.confirmedPathologies || []).map(p => p.pathologyKey || (p as any).key);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-950 w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 dark:border-blue-900/60 overflow-hidden my-auto max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-blue-900/60 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">
                  {t('pathologyReviewAdmin')}
                </h3>
                {isVerified && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/40">
                    <ShieldCheck className="w-3 h-3 text-blue-400" />
                    <span>{t('checked')}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono">
                {t('caseId0')} {modalLog.assessmentId} • {t('time')} {formatDisplayTimestamp(modalLog.timestamp, modalLog.updatedAt, modalLog.createdAt)}
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
                    collection: 'seg_reports',
                    title: `Báo cáo bất thường #${modalLog.assessmentId.slice(0, 8)}`,
                    timestamp: formatDisplayTimestamp(modalLog.timestamp, modalLog.updatedAt, modalLog.createdAt),
                    meta: `Răng: ${modalLog.tooth?.fdiNumber || 'N/A'} - Bất thường: ${(modalLog.finalConfirmedPathologies || modalLog.confirmedPathologies || modalLog.detectedPathologies || []).length}`,
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

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50 dark:bg-slate-900/50">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Image Preview & Case Meta (4/10 ratio) */}
            <div className="lg:col-span-5 space-y-4 flex flex-col">
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
                <div className="min-h-[260px] max-h-[45vh] bg-slate-950 rounded-lg flex items-center justify-center p-2 relative overflow-hidden border border-slate-800/80">
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
                      alt="Dental Radiograph"
                      referrerPolicy="no-referrer"
                      className="max-h-[40vh] w-auto object-contain rounded-md"
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

              {/* Case Metadata Badges */}
              <div className="bg-white dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('caseMetadata')}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">{t('toothFdi')}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{modalLog.tooth?.fdiNumber || 'N/A'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">{t('technique')}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{modalLog.technique || 'N/A'}</span>
                  </div>
                  <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">{t('status4')}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{modalLog.sessionStatus}</span>
                  </div>
                  <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500 block text-[10px]">{t('verifiedBy')}</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">{modalLog.verifiedBy || (t('unverified'))}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Pathology Comparison & Admin Selection */}
            <div className="lg:col-span-7 space-y-4 flex flex-col">
              <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-xs flex-1 flex flex-col overflow-hidden">
                {/* Validation Header */}
                <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center space-x-2">
                    <Star className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>{t('errorAssessment')}</span>
                  </h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hidden sm:inline-block mr-1">
                      {t('concur')}
                    </span>
                    <button
                      onClick={async () => {
                        setAdminConcurred(true);
                        // Doctor's selection (if any), otherwise fallback to AI detected
                        const doctorKeys: string[] = modalLog.confirmedPathologies?.map(p => String(p.pathologyKey || (p as any).key || '')) || [];
                        const aiKeys: string[] = modalLog.detectedPathologies?.map(p => String(p.pathologyKey || (p as any).key || '')) || [];
                        const keysToConfirm: string[] = Array.from(new Set((doctorKeys.length > 0 ? doctorKeys : aiKeys).filter(Boolean)));
                        await handleSaveAdminVerification(keysToConfirm, '');
                        onClose();
                      }}
                      className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                        adminConcurred === true
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('yes')}</span>
                    </button>
                    <button
                      onClick={() => {
                        setAdminConcurred(false);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center space-x-1 transition-all cursor-pointer ${
                        adminConcurred === false
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
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
                        // Display Read-only list
                        const doctorKeys = modalLog.confirmedPathologies?.map(p => p.pathologyKey || (p as any).key) || [];
                        const aiKeys = modalLog.detectedPathologies?.map(p => p.pathologyKey || (p as any).key) || [];
                        const keysToShow = [...new Set(doctorKeys.length > 0 ? doctorKeys : aiKeys)];
                        
                        if (keysToShow.length === 0) {
                          return (
                            <div className="p-4 text-center text-emerald-600 dark:text-emerald-400 font-bold text-xs bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                              {t('standardRadiographNoPathology')}
                            </div>
                          );
                        }

                        return keysToShow.map((key) => {
                          const itemInfo = PATHOLOGY_TAXONOMY.find(t => t.key === key);
                          if (!itemInfo) return null;
                          return (
                            <div key={key} className="bg-white dark:bg-slate-800/80 rounded-xl p-3 border shadow-sm transition-all border-amber-300 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/20">
                              <div className="flex items-center space-x-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: itemInfo.color }} />
                                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                                  {language === 'EN' ? itemInfo.labelEn : (itemInfo.label || (itemInfo as any).labelVi)}
                                </span>
                              </div>
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
                        <span className="text-xs font-bold text-rose-800 dark:text-rose-300">
                          {t('manualSelectionRequired')}
                        </span>
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                          {t('selectAllCorrectPathologies')}
                        </span>
                      </div>
                      
                      <div className="border border-slate-200 dark:border-slate-700/60 rounded-xl overflow-hidden flex-1 flex flex-col">
                        <div className="p-2 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-[10px] text-slate-700 dark:text-slate-300 grid grid-cols-12 gap-1 text-center shrink-0">
                          <span className="col-span-5 text-left">{t('pathologyCategory')}</span>
                          <span className="col-span-2">{t('ai')}</span>
                          <span className="col-span-2">{t('doc')}</span>
                          <span className="col-span-3 text-amber-600 dark:text-amber-400 font-extrabold">{t('final')}</span>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60 overflow-y-auto flex-1 custom-scrollbar">
                          {PATHOLOGY_TAXONOMY.map((item) => {
                            const aiHas = detectedKeys.includes(item.key);
                            const docHas = doctorConfirmedKeys.includes(item.key);
                            const isChecked = selectedKeys.includes(item.key);

                            return (
                              <div
                                key={item.key}
                                onClick={() => handleToggleKey(item.key)}
                                className={`p-2 grid grid-cols-12 gap-1 items-center cursor-pointer transition-colors text-xs ${
                                  isChecked
                                    ? 'bg-amber-50/60 dark:bg-amber-900/20'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                }`}
                              >
                                <div className="col-span-5 flex items-center space-x-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                  <span className="font-medium text-slate-800 dark:text-slate-200 text-[10px] leading-tight">
                                    {language === 'EN' ? item.labelEn : (item.label || (item as any).labelVi)}
                                  </span>
                                </div>

                                <div className="col-span-2 flex justify-center">
                                  {aiHas ? (
                                    <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                      Có
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600">-</span>
                                  )}
                                </div>

                                <div className="col-span-2 flex justify-center">
                                  {docHas ? (
                                    <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                      Có
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600">-</span>
                                  )}
                                </div>

                                <div className="col-span-3 flex justify-center" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleKey(item.key)}
                                    className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Admin Notes */}
                      <div className="space-y-1 shrink-0">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t('adminClinicalAssessmentNotes')}
                        </label>
                        <textarea
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          placeholder={
                            t('enterClinicalEvaluationOr')
                          }
                          rows={2}
                          className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-amber-500 outline-none resize-none"
                        />
                      </div>

                      {/* Save Action Button */}
                      <button
                        onClick={async () => {
                          await handleSaveAdminVerification();
                          onClose();
                        }}
                        disabled={isSavingVerification}
                        className="w-full flex justify-center items-center space-x-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer mt-2"
                      >
                        {isSavingVerification ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>{t('saving')}</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" />
                            <span>{t('saveConfirmGround')}</span>
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
    </div>
  );
};
