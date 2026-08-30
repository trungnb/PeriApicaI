import React from 'react';
import {
  DOMAIN_TITLES,
  TAXONOMY_ERRORS,
  getTaxonomyLabel,
  getDomainMeta,
  getToothDisplayName,
  getArchDisplayName,
  getTechniqueDisplayName,
  getReceptorDisplayName,
} from '../data/taxonomyData';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Sparkles,
  CheckSquare,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { MedicalDarkViewer } from './MedicalDarkViewer';
import { PerformanceTelemetry } from './PerformanceTelemetry';
import { useTranslation } from 'react-i18next';

export const AIAnalysisScreen: React.FC = React.memo(() => {
  const { t } = useTranslation(['analysis', 'common']);
  const language = useAppStore(state => state.language);

  const analysis = useAppStore(state => state.analysisResult);
  const selectedTooth = useAppStore(state => state.selectedTooth);
  const selectedTechnique = useAppStore(state => state.selectedTechnique);
  const selectedReceptor = useAppStore(state => state.selectedReceptor);
  const imageDataUrl = useAppStore(state => state.imageDataUrl);
  const isFallback = useAppStore(state => state.isFallbackAnalysis);

  const initialAiErrorKeys = React.useMemo(() => {
    const keys: string[] = [];
    if (analysis?.findings) {
      analysis.findings.forEach((f) => {
        f.detectedErrors?.forEach((e) => {
          if (e.errorKey && !keys.includes(e.errorKey)) {
            keys.push(e.errorKey);
          }
        });
      });
    }
    return keys;
  }, [analysis]);

  const userConcurred = useAppStore(state => state.userConcurred);
  const setUserConcurred = useAppStore(state => state.setUserConcurred);
  const selectedOverrideKeys = useAppStore(state => state.selectedOverrideKeys);
  const setSelectedOverrideKeys = useAppStore(state => state.setSelectedOverrideKeys);
  const setConfirmedErrorKeys = useAppStore(state => state.setConfirmedErrorKeys);

  React.useEffect(() => {
    if (selectedOverrideKeys.length === 0 && initialAiErrorKeys.length > 0) {
      setSelectedOverrideKeys(initialAiErrorKeys);
    }
  }, [initialAiErrorKeys]);

  const handleToggleOverrideKey = (key: string) => {
    setSelectedOverrideKeys(
      selectedOverrideKeys.includes(key) 
        ? selectedOverrideKeys.filter((k) => k !== key) 
        : [...selectedOverrideKeys, key]
    );
  };

  const confirmedErrorKeys =
    userConcurred === false ? selectedOverrideKeys : initialAiErrorKeys;

  React.useEffect(() => {
    setConfirmedErrorKeys(confirmedErrorKeys);
  }, [confirmedErrorKeys, setConfirmedErrorKeys]);

  // Early return if analysis is missing, AFTER all hooks have executed unconditionally
  if (!analysis) {
    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
        <p className="text-slate-600 font-medium">{t('noResults')}</p>
        <button
          onClick={() => useAppStore.getState().setCurrentStep(3)}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition-all shadow-xs cursor-pointer"
        >
          {t('backToUpload')}
        </button>
      </div>
    );
  }

  const getQualityBadge = (quality: string) => {
    switch (quality) {
      case 'Diagnostic':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/60 font-bold text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{t('qualityDiagnostic')}</span>
          </span>
        );
      case 'Needs Retake':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>{t('qualityNeedsRetake')}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-700/60 font-bold text-xs">
            <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>{t('qualityUnacceptable')}</span>
          </span>
        );
    }
  };

  const techniqueText = getTechniqueDisplayName(selectedTechnique, language);
  const receptorText = getReceptorDisplayName(selectedReceptor, language);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24 space-y-4 max-w-7xl mx-auto">
      
      {/* Top summary card */}
      <div className="shrink-0 bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700/80 pb-3">
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t('common:targetTooth')}: {selectedTooth?.fdiNumber} - {selectedTooth ? getToothDisplayName(selectedTooth, language) : ''} {selectedTooth ? `(${getArchDisplayName(selectedTooth.arch, language)})` : ''}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('imagingTechnique')}: <strong className="font-semibold text-blue-700 dark:text-sky-400">{techniqueText}</strong> • {t('receptorType')}: <strong className="font-semibold text-blue-700 dark:text-sky-400">{receptorText}</strong>
            </p>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {isFallback && (
              <span className="text-[10px] bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-semibold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                {t('fallbackBadge')}
              </span>
            )}
            {getQualityBadge(analysis.overallQuality)}
          </div>
        </div>

        {/* Notice regarding AI model */}
        <div className="bg-amber-50/90 dark:bg-amber-950/40 border-l-4 border-amber-500 border-t border-r border-b border-amber-200 dark:border-amber-700/60 rounded-xl p-3 text-xs text-amber-950 dark:text-amber-100 leading-relaxed space-y-1 shadow-xs">
          <div className="flex items-center space-x-2 font-semibold text-amber-900 dark:text-amber-300">
            <span className="text-amber-600 dark:text-amber-400">ℹ️</span>
            <span>{t('disclaimerTitle')}</span>
          </div>
          <p className="text-amber-900/90 dark:text-amber-200/90 pl-5 leading-relaxed">
            {t('disclaimerDesc')}
          </p>
        </div>
      </div>

      {/* Diagnostics & Execution Telemetry */}
      <PerformanceTelemetry />

      {/* Main Layout (Adaptive 2 or 3 columns based on userConcurred) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Image Viewer */}
        <div className={`${userConcurred === false ? 'lg:col-span-4' : 'lg:col-span-3'} flex flex-col space-y-3`}>
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex flex-col space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center space-x-2">
              <Eye className="w-4 h-4 text-blue-600 dark:text-sky-400" />
              <span>{t('radiographViewerTitle')}</span>
            </h3>

            <MedicalDarkViewer
              imageDataUrl={imageDataUrl || undefined}
              toothFdi={selectedTooth.fdiNumber}
              technique={techniqueText}
              receptor={receptorText}
              showScannerBeam={false}
            />
          </div>
        </div>

        {/* Center Column: AI Findings (Hidden when user disagrees to leave space for manual error selection) */}
        {userConcurred !== false && (
          <div className="lg:col-span-5 flex flex-col space-y-4 pr-1 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                <span>{t('aiFindingsTitle')}</span>
              </h3>
              <span className="text-[11px] font-semibold text-blue-800 dark:text-sky-300 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-700/60 font-mono">
                {t('errorsFoundCount', { count: initialAiErrorKeys.length })}
              </span>
            </div>

            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
              {analysis.findings.map((finding) => {
                const domainMeta = getDomainMeta(finding.domainId, language);

                return (
                  <div
                    key={finding.domainId}
                    className={`bg-white dark:bg-slate-800/90 rounded-2xl p-3 border shadow-xs space-y-2 transition-all ${
                      finding.hasErrors
                        ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/30 dark:bg-amber-950/20'
                        : 'border-slate-200 dark:border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-2.5">
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs">{domainMeta?.name || finding.domainName}</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {domainMeta?.description || finding.domainSummary}
                        </p>
                      </div>

                      {finding.hasErrors ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold border border-amber-200 dark:border-amber-700/60 flex items-center space-x-1 shrink-0">
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          <span>{finding.detectedErrors.length} {t('errorsBadge')}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold border border-emerald-200 dark:border-emerald-700/60 flex items-center space-x-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>{t('acceptableBadge')}</span>
                        </span>
                      )}
                    </div>

                    {finding.hasErrors && finding.detectedErrors.length > 0 ? (
                      <div className="space-y-2 pt-0.5">
                        {finding.detectedErrors.map((err, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-700/60 space-y-1 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-amber-900 dark:text-amber-200 text-xs flex items-center space-x-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                                <span>{getTaxonomyLabel(err.errorKey, language) || err.errorName}</span>
                              </span>
                              <div className="flex items-center gap-1.5">
                                {err.provenance === 'matched_consensus' && (
                                  <span className="text-[9px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-semibold px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                                    {language === 'EN' ? 'Consensus' : 'Hội chẩn'}
                                  </span>
                                )}
                                {(err.provenance === 'model_a_only' || err.provenance === 'model_b_only') && (
                                  <span className="text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                    {language === 'EN' ? 'Review Needed' : 'Cần rà soát'}
                                  </span>
                                )}
                                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                                  {t('confidence', { val: err.confidence })}
                                </span>
                              </div>
                            </div>
                            <p className="text-amber-900/80 dark:text-amber-200/80 text-[11px] leading-relaxed pl-3">
                              {err.clinicalObservation}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 italic pt-0.5">
                        {finding.domainSummary}
                      </p>
                    )}
                  </div>
                );
              })}

            </div>
          </div>
        )}

        {/* Right Column: Clinical Verification & Error Selection */}
        <div className={`${userConcurred === false ? 'lg:col-span-8' : 'lg:col-span-4'} flex flex-col space-y-4 pr-1 transition-all duration-200`}>
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-3">
              <div className="flex items-center space-x-2">
                <CheckSquare className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t('clinicalVerificationTitle')}</h3>
              </div>
              {userConcurred === true && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200 dark:border-emerald-700/60">
                  {t('concurredBadge')}
                </span>
              )}
              {userConcurred === false && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 text-[10px] font-bold border border-rose-200 dark:border-rose-700/60">
                  {t('manualBadge')}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug">
                {t('agreeQuestion')}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setUserConcurred(true);
                    setSelectedOverrideKeys(initialAiErrorKeys);
                  }}
                  className={`px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer min-h-[44px] ${
                    userConcurred === true
                      ? 'bg-emerald-600 text-white font-bold shadow-2xs'
                      : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('agreeYes')}</span>
                </button>

                <button
                  onClick={() => {
                    setUserConcurred(false);
                  }}
                  className={`px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer min-h-[44px] ${
                    userConcurred === false
                      ? 'bg-rose-600 text-white font-bold shadow-2xs'
                      : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <XCircle className="w-4 h-4" />
                  <span>{t('agreeNo')}</span>
                </button>
              </div>
            </div>

            {userConcurred === false && (
              <div className="pt-3 space-y-3 border-t border-slate-100 dark:border-slate-700/80 animate-in fade-in duration-200">
                <div className="bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-700/60 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
                  {t('manualSelectHint')}
                </div>

                <div className="space-y-3 pr-1 max-h-[460px] overflow-y-auto custom-scrollbar">
                  {Object.entries(DOMAIN_TITLES).map(([domainId]) => {
                    const domainMeta = getDomainMeta(domainId, language);
                    const domainErrors = TAXONOMY_ERRORS.filter(
                      (e) => e.domainId === domainId
                    );
                    return (
                      <div key={domainId} className="space-y-2 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80">
                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block font-mono">
                          {domainMeta?.name}
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {domainErrors.map((err) => {
                            const isChecked = selectedOverrideKeys.includes(err.key);
                            const label = getTaxonomyLabel(err.key, language);
                            const desc = language === 'EN' && err.descriptionEn ? err.descriptionEn : err.description;
                            return (
                              <label
                                key={err.key}
                                htmlFor={`override-${err.key}`}
                                className={`flex items-start space-x-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                                  isChecked
                                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 dark:border-blue-400 text-blue-950 dark:text-blue-100 font-semibold shadow-2xs'
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                <input
                                  id={`override-${err.key}`}
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleOverrideKey(err.key)}
                                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 shrink-0 accent-blue-600 cursor-pointer"
                                />
                                <div className="space-y-0.5">
                                  <p className="text-xs font-bold leading-tight text-slate-800 dark:text-slate-200">{label}</p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{desc}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Confirmed Errors summary */}
            <div className="pt-3 space-y-2 border-t border-slate-100 dark:border-slate-700/80">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block font-mono">
                {t('confirmedSummary', { count: confirmedErrorKeys.length })}
              </span>

              {confirmedErrorKeys.length === 0 ? (
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium italic bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-lg border border-emerald-200 dark:border-emerald-700/60">
                  {t('noErrorsSummary')}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {confirmedErrorKeys.map((key) => {
                    const label = getTaxonomyLabel(key, language) || key;
                    return (
                      <span
                        key={key}
                        className="inline-block px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/60 text-[10px] font-bold text-amber-800 dark:text-amber-300 font-mono"
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            
          </div>
        </div>
      </div>
      </div>
    </div>
  );
});

export default AIAnalysisScreen;
