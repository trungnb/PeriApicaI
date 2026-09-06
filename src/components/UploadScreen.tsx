import React, { useState, useRef, useEffect } from 'react';
import { Upload, Loader2, AlertTriangle, ShieldCheck, Check, Camera, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { MedicalDarkViewer } from './MedicalDarkViewer';
import { useTranslation } from 'react-i18next';
import { getToothDisplayName, getArchDisplayName, getTechniqueDisplayName, getReceptorDisplayName } from '../data/taxonomyData';
import { useAssessmentSession } from '../hooks/useAssessmentSession';
import { triggerProactiveValidityCheck } from '../hooks/useRadiographAnalysis';
import { ByokConfigSection } from './ByokConfigSection';
import { ModelSelectionSection } from './ModelSelectionSection';
import { CustomKeyErrorModal } from './CustomKeyErrorModal';

export const UploadScreen: React.FC = React.memo(() => {
  const { t, i18n } = useTranslation(['upload', 'common']);
  const language = useAppStore(state => state.language);
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const selectedTooth = useAppStore(state => state.selectedTooth);
  const selectedTechnique = useAppStore(state => state.selectedTechnique);
  const selectedReceptor = useAppStore(state => state.selectedReceptor);
  const imageDataUrl = useAppStore(state => state.imageDataUrl);
  const isAnalyzing = useAppStore(state => state.isAnalyzing);
  const analyzingStatusMessage = useAppStore(state => state.analyzingStatusMessage);
  const isQuotaExhausted = useAppStore(state => state.isQuotaExhausted);
  const quotaResetNotice = useAppStore(state => state.quotaResetNotice);
  const shareConsent = useAppStore(state => state.shareConsent);
  const setShareConsent = useAppStore(state => state.setShareConsent);
  const lastCompressionMetrics = useAppStore(state => state.lastCompressionMetrics);
  const compressedImageBase64 = useAppStore(state => state.compressedImageBase64);
  const validityGateState = useAppStore(state => state.validityGateState);
  
  const { handleImageSelectedAndAutoLog: onImageSelected } = useAssessmentSession();

  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const setGlobalError = useAppStore(state => state.setGlobalError);

  const hasAnalysisResult = useAppStore(state => !!state.analysisResult);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Auto-trigger proactive validity when image is ready and validity is idle
  useEffect(() => {
    if (imageDataUrl && compressedImageBase64 && validityGateState === 'idle' && !isAnalyzing) {
      triggerProactiveValidityCheck(compressedImageBase64).catch((err) => {
        console.debug('[UploadScreen] Auto proactive validity trigger notice:', err);
      });
    }
  }, [imageDataUrl, compressedImageBase64, validityGateState, isAnalyzing, selectedTooth.fdiNumber]);

  const handleInterceptFile = (file: File) => {
    if (hasAnalysisResult) {
      setPendingFile(file);
    } else {
      processFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleInterceptFile(file);
    }
    e.target.value = '';
  };

  const processFile = async (file: File) => {
    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/bmp'];
    if (!validImageTypes.includes(file.type)) {
      setGlobalError(t('invalidFileType'));
      return;
    }
    
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setGlobalError(i18n.language === 'en'
        ? 'Image file is too large. Please upload an image smaller than 20MB.'
        : 'File ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 20MB.');
      return;
    }

    try {
      setIsCompressing(true);
      await onImageSelected(file);
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      console.error('Error selecting image:', err);
      setGlobalError(t('compressError'));
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleInterceptFile(file);
    }
  };

  const techniqueText = getTechniqueDisplayName(selectedTechnique, language);
  const receptorText = getReceptorDisplayName(selectedReceptor, language);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24">
        <div className="max-w-5xl mx-auto space-y-4">
      
      {/* Banner summary */}
      <div className="shrink-0 bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {t('toothHeader', {
              fdi: selectedTooth.fdiNumber,
              name: getToothDisplayName(selectedTooth, language),
              arch: getArchDisplayName(selectedTooth.arch, language),
            })}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('techniqueLabel')}: <strong className={`font-semibold ${isPathology ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-sky-400'}`}>{techniqueText}</strong> • {t('receptorLabel')}:{' '}
            <strong className={`font-semibold ${isPathology ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-sky-400'}`}>{receptorText}</strong>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: In-place Upload & Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="space-y-2">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
              {imageDataUrl
                ? t('radiographPreview')
                : t('uploadRadiograph')}
            </h3>

            {/* Hidden File Inputs */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png, image/jpeg, image/jpg, image/webp"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleFileChange}
              accept="image/png, image/jpeg, image/jpg, image/webp"
              capture="environment"
              className="hidden"
            />

            {!imageDataUrl ? (
              /* Dropzone when no image */
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center cursor-pointer transition-all duration-200 relative overflow-hidden group ${
                  isDragging
                    ? isPathology
                      ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/40 scale-[1.01]'
                      : 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 scale-[1.01]'
                    : isPathology
                    ? 'border-slate-300 dark:border-slate-700 hover:border-teal-500/80 dark:hover:border-teal-400/80 bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs'
                    : 'border-slate-300 dark:border-slate-700 hover:border-blue-500/80 dark:hover:border-blue-400/80 bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs'
                }`}
              >
                <div className="max-w-md mx-auto space-y-4 relative z-10">
                  <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center border shadow-xs group-hover:scale-105 transition-transform duration-200 ${
                    isPathology
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700/60'
                      : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700/60'
                  }`}>
                    <Upload className={`w-6 h-6 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {isPathology
                        ? t('dragDropRadiograph')
                        : t('boxSubtitle')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('boxHint')}</p>
                  </div>
                  
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center shadow-xs transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 mr-1.5 text-slate-500 dark:text-slate-400" />
                      {t('chooseFileBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold text-white flex items-center shadow-xs transition-colors cursor-pointer ${
                        isPathology
                          ? 'bg-teal-600 dark:bg-teal-600 border border-teal-700 dark:border-teal-500 hover:bg-teal-700 dark:hover:bg-teal-500'
                          : 'bg-blue-600 dark:bg-blue-600 border border-blue-700 dark:border-blue-500 hover:bg-blue-700 dark:hover:bg-blue-500'
                      }`}
                    >
                      <Camera className="w-4 h-4 mr-1.5" />
                      {t('takePhotoBtn')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* In-Place Image Preview with Floating Re-upload Overlay Button */
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-3 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2 relative group">
                <div className="relative overflow-hidden rounded-xl bg-slate-950">
                  {/* Floating Re-upload Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fileInputRef.current) fileInputRef.current.click();
                    }}
                    className="absolute top-3 right-3 z-30 px-3 py-1.5 bg-slate-900/85 hover:bg-slate-900 text-white backdrop-blur-md border border-white/20 rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-xl transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-300 ${isPathology ? 'text-teal-300' : 'text-sky-400'}`} />
                    <span>{t('reuploadBtn')}</span>
                  </button>

                  <MedicalDarkViewer
                    imageDataUrl={imageDataUrl}
                    toothFdi={selectedTooth.fdiNumber}
                    technique={techniqueText}
                    receptor={receptorText}
                    showScannerBeam={isAnalyzing}
                  />

                  {/* Compressing Overlay */}
                  {isCompressing && (
                    <div className={`absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center space-y-3 text-white z-20 rounded-xl border ${
                      isPathology ? 'border-teal-500/40' : 'border-blue-500/40'
                    }`}>
                      <Loader2 className={`w-8 h-8 animate-spin ${isPathology ? 'text-teal-400' : 'text-sky-400'}`} />
                      <div className="text-center space-y-1.5 px-4">
                        <p className={`font-bold text-xs font-mono tracking-wider ${isPathology ? 'text-teal-300' : 'text-sky-300'}`}>
                          {t('compressingTitle') || 'ĐANG TỐI ƯU HÓA ẢNH X-QUANG'}
                        </p>
                        <p className="text-[11px] text-slate-300 leading-relaxed max-w-xs">
                          {i18n.language === 'en'
                            ? 'Processing multi-stage bilinear step-down resizing via background Offscreen Web Worker...'
                            : 'Đang giải mã và thu nhỏ đa tầng 50% bằng công nghệ Web Worker & OffscreenCanvas...'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Analyzing Overlay */}
                  {isAnalyzing && (
                    <div className={`absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center space-y-3 text-white z-20 rounded-xl border p-4 ${
                      isPathology ? 'border-teal-500/30' : 'border-slate-800'
                    }`}>
                      <Loader2 className={`w-8 h-8 animate-spin ${isPathology ? 'text-teal-400' : 'text-sky-400'}`} />
                      <div className="text-center space-y-1.5 max-w-md">
                        <p className={`font-bold text-sm font-mono tracking-wider ${isPathology ? 'text-teal-300' : 'text-sky-300'}`}>
                          {isPathology 
                            ? t('aiPathologySegmentation')
                            : t('analyzingTitle')}
                        </p>
                        <p className={`text-xs px-4 font-medium transition-all duration-300 leading-relaxed ${isPathology ? 'text-teal-100' : 'text-sky-100'}`}>
                          {analyzingStatusMessage || (isPathology
                            ? t('detectingPeriapicalLesionsBone')
                            : i18n.language === 'en'
                            ? 'Analyzing radiograph...'
                            : 'Đang phân tích phim X-quang...')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Image Validity Indicator */}
                {validityGateState !== 'idle' && (
                  <div className={`border rounded-xl px-3 py-2 text-xs flex items-center justify-between shadow-2xs mt-2 ${
                    validityGateState === 'checking'
                      ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/80 dark:border-blue-800/50 text-blue-800 dark:text-blue-200'
                      : validityGateState === 'valid' || validityGateState === 'user_confirmed'
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200'
                      : validityGateState === 'warning'
                      ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-800/50 text-amber-800 dark:text-amber-200'
                      : validityGateState === 'invalid'
                      ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-800/50 text-rose-800 dark:text-rose-200'
                      : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-300'
                  }`}>
                    <div className="flex items-center space-x-2 font-medium">
                      {validityGateState === 'checking' && (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
                          <span>{i18n.language === 'en' ? 'Checking image suitability...' : 'Đang kiểm tra tính phù hợp của ảnh...'}</span>
                        </>
                      )}
                      {(validityGateState === 'valid' || validityGateState === 'user_confirmed') && (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 stroke-[2.5]" />
                          <span>{i18n.language === 'en' ? 'Image suitable for analysis' : 'Ảnh phù hợp để phân tích'}</span>
                        </>
                      )}
                      {validityGateState === 'warning' && (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>{i18n.language === 'en' ? 'Tooth alignment confirmation needed' : 'Cần xác nhận vị trí răng mục tiêu'}</span>
                        </>
                      )}
                      {validityGateState === 'invalid' && (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>{i18n.language === 'en' ? 'Image not suitable for analysis' : 'Ảnh chưa phù hợp để phân tích'}</span>
                        </>
                      )}
                      {validityGateState === 'unavailable' && (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>{i18n.language === 'en' ? 'Validity check service unavailable' : 'Kiểm tra tính phù hợp tạm thời gián đoạn'}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Image Compression Optimization Banner */}
                {lastCompressionMetrics && (
                  <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-700/50 rounded-xl p-3 text-xs flex flex-col space-y-2 shadow-2xs mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 font-semibold text-slate-700 dark:text-slate-300">
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Tối ưu hóa ảnh X-quang</span>
                      </div>
                      <span className="text-[10px] bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                        -{lastCompressionMetrics.compressionRatio}% dung lượng
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                      <div>Độ phân giải gốc: <span className="text-slate-700 dark:text-slate-300 font-semibold">{lastCompressionMetrics.originalWidth}x{lastCompressionMetrics.originalHeight}px ({lastCompressionMetrics.originalSizeKB > 1024 ? `${(lastCompressionMetrics.originalSizeKB / 1024).toFixed(1)} MB` : `${lastCompressionMetrics.originalSizeKB} KB`})</span></div>
                      <div>Độ phân giải nén: <span className="text-slate-700 dark:text-slate-300 font-semibold">{lastCompressionMetrics.width}x{lastCompressionMetrics.height}px ({lastCompressionMetrics.compressedSizeKB} KB)</span></div>
                      <div>Thời gian xử lý: <span className="text-slate-700 dark:text-slate-300 font-semibold">{lastCompressionMetrics.processingTimeMs} ms</span></div>
                      <div>Xử lý tăng tốc: <span className="text-slate-700 dark:text-slate-300 font-semibold">{lastCompressionMetrics.wasAccelerated ? 'Web Worker (Offscreen)' : 'Main Thread Fallback'}</span></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI Analysis Mode & Dynamic Model Selection */}
            <ModelSelectionSection />
          </div>
        </div>

        {/* Right Column: BYOK Config & Data Privacy Consent */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* BYOK Configuration Section */}
          <ByokConfigSection />

          {/* User Consent for Image Sharing & AI Dataset */}
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
            <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-slate-700/80 pb-2">
              <ShieldCheck className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
              <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
                {t('privacyTitle')}
              </h4>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {t('privacyDesc')}
            </p>

            <div className="pt-1 space-y-2">
              <p className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                {t('consentHeader')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Agrees to share */}
              <div
                onClick={() => setShareConsent(true)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center space-x-2.5 ${
                  shareConsent
                    ? isPathology
                      ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 font-medium shadow-xs'
                      : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 font-medium shadow-xs'
                    : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="shrink-0">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                      shareConsent
                        ? isPathology ? 'border-teal-600 bg-teal-600 text-white' : 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
                    }`}
                  >
                    {shareConsent && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
                    {t('consentYesTitle')}
                  </p>
                </div>
              </div>

              {/* Option 2: Disagrees */}
              <div
                onClick={() => setShareConsent(false)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center space-x-2.5 ${
                  !shareConsent
                    ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-600 dark:border-amber-400 text-amber-950 dark:text-amber-100 ring-1 ring-amber-600 dark:ring-amber-400 font-medium shadow-xs'
                    : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="shrink-0">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                      !shareConsent ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
                    }`}
                  >
                    {!shareConsent && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
                    {t('consentNoTitle')}
                  </p>
                </div>
              </div>
            </div>
            </div>

            {/* Notice regarding storage lifecycle */}
            <div className="bg-amber-50/90 dark:bg-amber-950/40 border-l-4 border-amber-500 border-t border-r border-b border-amber-200 dark:border-amber-700/60 rounded-xl p-3.5 text-xs text-amber-950 dark:text-amber-100 leading-relaxed space-y-1 shadow-xs mt-3">
              <div className="flex items-center space-x-2 font-semibold text-amber-900 dark:text-amber-300">
                <span className="text-amber-600 dark:text-amber-400">ℹ️</span>
                <span>{t('storageNoticeTitle')}</span>
              </div>
              <p className="text-amber-900/90 dark:text-amber-200/90 pl-5 leading-relaxed whitespace-pre-wrap">
                {t('storageNoticeDesc')}
              </p>
            </div>
          </div>

          {isQuotaExhausted && (
            <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-700/60 rounded-xl p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center space-x-2 font-bold text-amber-950 dark:text-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>{t('quotaExhaustedTitle')}</span>
              </div>
              <p>
                {t('quotaExhaustedDesc', { time: quotaResetNotice || (i18n.language === 'en' ? '1 minute' : '1 phút') })}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
      {pendingFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
              {t('changeImageModalTitle')}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              {t('changeImageModalDesc')}
            </p>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={() => setPendingFile(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                {t('cancelBtn')}
              </button>
              <button
                onClick={() => {
                  if (pendingFile) processFile(pendingFile);
                  setPendingFile(null);
                }}
                className={`px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors shadow-xs cursor-pointer ${
                  isPathology ? 'bg-teal-600 hover:bg-teal-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {t('confirmChangeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Custom Key Error Modal */}
      <CustomKeyErrorModal />
    </div>
  );
});

export default UploadScreen;
