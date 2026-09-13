import React from 'react';
import {
  TAXONOMY_DICT,
  getRemediationText,
  getTaxonomyLabel,
  getDomainMeta,
  getToothDisplayName,
  getArchDisplayName,
  getTechniqueDisplayName,
  getReceptorDisplayName,
} from '../data/taxonomyData';
import {
  CheckCircle2,
  BookOpen,
  Sparkles,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { MedicalDarkViewer } from './MedicalDarkViewer';
import { useTranslation } from 'react-i18next';

export const ValidationScreen: React.FC = React.memo(() => {
  const { t } = useTranslation(['common', 'remediation', 'analysis']);
  const { t: tRemediation } = useTranslation('remediation');
  const { t: tAnalysis } = useTranslation('analysis');
  const language = useAppStore(state => state.language);

  const analysis = useAppStore(state => state.analysisResult);
  const selectedTooth = useAppStore(state => state.selectedTooth);
  const selectedTechnique = useAppStore(state => state.selectedTechnique);
  const selectedReceptor = useAppStore(state => state.selectedReceptor);
  const imageDataUrl = useAppStore(state => state.imageDataUrl);
  const confirmedErrorKeys = useAppStore(state => state.confirmedErrorKeys);

  const userNotes = useAppStore(state => state.userNotes);
  const setUserNotes = useAppStore(state => state.setUserNotes);

  const remediationGuidelines = React.useMemo(() => {
    return (confirmedErrorKeys || []).map((key) => {
      const errorItem = TAXONOMY_DICT[key];
      const label = getTaxonomyLabel(key, language) || errorItem?.label || key;
      const desc = language === 'EN' && errorItem?.descriptionEn ? errorItem.descriptionEn : (errorItem?.description || '');
      return {
        key,
        domainId: errorItem?.domainId || 'domain_1',
        label,
        description: desc,
        remediation: getRemediationText(key, language),
      };
    });
  }, [confirmedErrorKeys, language]);

  // Early return if analysis is missing, AFTER all hooks have executed unconditionally
  if (!analysis) {
    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
        <p className="text-slate-600 font-medium">{tAnalysis('noResults')}</p>
        <button
          onClick={() => useAppStore.getState().setCurrentStep(3)}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-xs transition-all shadow-xs cursor-pointer"
        >
          {tAnalysis('backToUpload')}
        </button>
      </div>
    );
  }

  const techniqueText = getTechniqueDisplayName(selectedTechnique, language);
  const receptorText = getReceptorDisplayName(selectedReceptor, language);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24 space-y-4 max-w-7xl mx-auto">
      
      {/* Step Header */}
      <div className="shrink-0 bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {language === 'EN' ? 'Target Tooth' : 'Răng mục tiêu'}: {selectedTooth?.fdiNumber} - {selectedTooth ? getToothDisplayName(selectedTooth, language) : ''} {selectedTooth ? `(${getArchDisplayName(selectedTooth.arch, language)})` : ''}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {language === 'EN' ? 'Imaging Technique' : 'Kỹ thuật chụp'}: <strong className="font-semibold text-blue-700 dark:text-sky-400">{techniqueText}</strong> • {language === 'EN' ? 'Receptor Type' : 'Bộ nhận ảnh'}: <strong className="font-semibold text-blue-700 dark:text-sky-400">{receptorText}</strong>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Viewer & Confirmed errors list */}
        <div className="lg:col-span-4 flex flex-col space-y-4 pr-1">
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-sky-400" />
              <span>{tRemediation('reviewedRadiograph')}</span>
            </h3>

            <MedicalDarkViewer
              imageDataUrl={imageDataUrl || undefined}
              toothFdi={selectedTooth.fdiNumber}
              technique={techniqueText}
              receptor={receptorText}
              showScannerBeam={false}
            />

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700/80">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block font-mono">
                {tRemediation('confirmedErrorsCount', { count: confirmedErrorKeys.length })}:
              </span>
              {confirmedErrorKeys.length === 0 ? (
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium italic bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-700/60">
                  {tRemediation('perfectFilmMsg')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {remediationGuidelines.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center space-x-2 font-mono"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Step-by-step remediation guide & teacher notes */}
        <div className="lg:col-span-8 flex flex-col space-y-6 pr-1">
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-slate-700/80 pb-3">
              <Wrench className="w-5 h-5 text-blue-600 dark:text-sky-400" />
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                {tRemediation('detailedGuideTitle')}
              </h3>
            </div>

            {remediationGuidelines.length > 0 ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tRemediation('detailedGuideIntro')}
                </p>

                <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1 custom-scrollbar">
                  {remediationGuidelines.map((item, idx) => {
                    const domainMeta = getDomainMeta(item.domainId, language);

                    return (
                      <div
                        key={idx}
                        className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-2 transition-all hover:border-slate-300 dark:hover:border-slate-600"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-200/80 dark:border-slate-700/80 pb-2">
                          <div className="flex items-center space-x-2 text-blue-900 dark:text-sky-300 font-extrabold text-sm">
                            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400" />
                            <span>{item.label}</span>
                          </div>
                          {domainMeta && (
                            <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-sky-300 border border-blue-200 dark:border-blue-700/60">
                              {domainMeta.name.split(':')[0]}
                            </span>
                          )}
                        </div>

                        {item.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                            {tRemediation('causeLabel')}: {item.description}
                          </p>
                        )}

                        <div className="pt-1 space-y-1">
                          <span className="text-xs font-bold text-blue-800 dark:text-sky-400 flex items-center space-x-1">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" />
                            <span>{tRemediation('correctionStepLabel')}:</span>
                          </span>
                          <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-medium pl-3 bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                            {item.remediation}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200 space-y-2">
                <div className="flex items-center space-x-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>{tRemediation('perfectFilmTitle')}</span>
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                  {tRemediation('perfectFilmDesc')}
                </p>
              </div>
            )}

            {/* Notes Input */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tRemediation('notesLabel')}
              </label>
              <textarea
                rows={3}
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder={tRemediation('notesPlaceholder')}
                className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
});

export default ValidationScreen;
