import React from 'react';
import { ArrowRight, Microscope, Layers, ShieldCheck, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';

export const WelcomeScreen: React.FC = React.memo(() => {
  const { t } = useTranslation('welcome');
  const setCurrentStep = useAppStore(state => state.setCurrentStep);
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const setAppEngineMode = useAppStore(state => state.setAppEngineMode);

  const onStart = () => setCurrentStep(2);
  const isPathology = appEngineMode === 'pathology_segmentation';

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-3 sm:px-6 lg:px-8 py-3 sm:py-4 lg:py-5 flex flex-col justify-center">
        <div className="w-full max-w-5xl xl:max-w-6xl mx-auto my-auto space-y-3 sm:space-y-4 lg:space-y-4.5">
          
          {/* Main Hero Card */}
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 sm:p-5 lg:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3 sm:space-y-3.5 relative overflow-hidden transition-all">
            <div className="space-y-2 sm:space-y-2.5 relative z-10">
              <h2 className="text-lg sm:text-2xl lg:text-[26px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
                {t('title')}
              </h2>

              <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm md:text-base leading-relaxed w-full">
                {t('descriptionIntro')} <strong className={`font-semibold ${isPathology ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-sky-400'}`}>{t('descriptionPeriapical')}</strong>{t('descriptionMiddle')} <strong className="text-slate-800 dark:text-slate-200 font-semibold">{t('descriptionAnalytics')}</strong>{t('descriptionEnd')}
              </p>

              {/* Mode Selector Cards */}
              <div className="pt-0.5 sm:pt-1 space-y-1.5 sm:space-y-2">
                <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('modeSelectionTitle')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3.5">
                  {/* Option 1: Classic Mode */}
                  <button
                    type="button"
                    onClick={() => setAppEngineMode('classic')}
                    className={`p-3 sm:p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-center cursor-pointer ${
                      !isPathology
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 dark:border-blue-500 ring-2 ring-blue-600/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2.5">
                        <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 shrink-0">
                          <ShieldCheck className="w-4 h-4" />
                        </span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                          {t('modeClassicTitle')}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 shrink-0">
                        {t('modeClassicBadge')}
                      </span>
                    </div>
                    {!isPathology && (
                      <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                  </button>

                  {/* Option 2: Pathology Mode (Deep Ocean Teal - Mệnh Thủy) */}
                  <button
                    type="button"
                    onClick={() => setAppEngineMode('pathology_segmentation')}
                    className={`p-3 sm:p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-center cursor-pointer ${
                      isPathology
                        ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/40 dark:border-teal-500 ring-2 ring-teal-600/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2.5">
                        <span className="p-1.5 rounded-lg bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                          {t('modePathologyTitle')}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300 shrink-0">
                        {t('modePathologyBadge')}
                      </span>
                    </div>
                    {isPathology && (
                      <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-teal-600 dark:bg-teal-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 sm:pt-2.5 flex items-center justify-center">
                <button
                  type="button"
                  id="welcome-start-button"
                  onClick={onStart}
                  className={`w-full max-w-sm sm:w-[320px] h-11 sm:h-12 px-6 rounded-xl text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95 shrink-0 ${
                    isPathology
                      ? 'bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500 shadow-teal-600/20'
                      : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-blue-600/20'
                  }`}
                >
                  <span className="whitespace-nowrap">{isPathology ? t('startPathologyButton') : t('startButton')}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>
          </div>

          {/* Dynamic Section 2: Supported Errors / Pathology Structures */}
          <AnimatePresence mode="wait">
            <motion.div
              key={appEngineMode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-1.5 sm:space-y-2"
            >
              <div className="flex items-center space-x-1.5">
                {isPathology ? (
                  <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                ) : (
                  <Microscope className="w-4 h-4 text-blue-600 dark:text-sky-400" />
                )}
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  {isPathology ? t('pathologyStructuresTitle') : t('supportedDomainsTitle')}
                </h3>
              </div>

              {!isPathology ? (
                /* Classic Mode 3 Domains */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3.5">
                  {/* Domain 1 */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 flex items-center justify-center font-bold text-[10px] border border-sky-200 dark:border-sky-700/60 font-mono shrink-0">
                        01
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('domain1Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('domain1Errors', { returnObjects: true }) as string[]).map((errName, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-sky-500 shrink-0" />
                          <span>{errName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Domain 2 */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold text-[10px] border border-amber-200 dark:border-amber-700/60 font-mono shrink-0">
                        02
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('domain2Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('domain2Errors', { returnObjects: true }) as string[]).map((errName, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                          <span>{errName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Domain 3 */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold text-[10px] border border-purple-200 dark:border-purple-700/60 font-mono shrink-0">
                        03
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('domain3Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('domain3Errors', { returnObjects: true }) as string[]).map((errName, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-purple-500 shrink-0" />
                          <span>{errName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                /* Pathology Mode 3 Structure Groups */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3.5">
                  {/* Group 1: Periapical & Periodontal */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-teal-200/60 dark:border-teal-900/40 shadow-xs hover:border-teal-300 dark:hover:border-teal-700 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 flex items-center justify-center font-bold text-[10px] border border-red-200 dark:border-red-700/60 font-mono shrink-0">
                        01
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('pathologyDomain1Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('pathologyDomain1Items', { returnObjects: true }) as string[]).map((item, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Group 2: Caries & Pulp */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-teal-200/60 dark:border-teal-900/40 shadow-xs hover:border-teal-300 dark:hover:border-teal-700 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold text-[10px] border border-amber-200 dark:border-amber-700/60 font-mono shrink-0">
                        02
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('pathologyDomain2Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('pathologyDomain2Items', { returnObjects: true }) as string[]).map((item, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Group 3: Restorations & Implants */}
                  <div className="bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border border-teal-200/60 dark:border-teal-900/40 shadow-xs hover:border-teal-300 dark:hover:border-teal-700 transition-all space-y-1.5 h-full flex flex-col justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 rounded-md bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center font-bold text-[10px] border border-teal-200 dark:border-teal-700/60 font-mono shrink-0">
                        03
                      </span>
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">{t('pathologyDomain3Title')}</h4>
                    </div>
                    <ul className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 font-medium flex-1 flex flex-col justify-around">
                      {(t('pathologyDomain3Items', { returnObjects: true }) as string[]).map((item, i) => (
                        <li key={i} className="flex items-center space-x-1.5">
                          <span className="w-1 h-1 rounded-full bg-teal-500 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Dynamic Section 3: 3-Step Workflow */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`workflow-${appEngineMode}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-1.5 sm:space-y-2"
            >
              <div className="flex items-center space-x-1.5">
                <Layers className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  {isPathology ? t('pathologyWorkflowTitle') : t('workflowTitle')}
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3.5">
                {/* Step 1 */}
                <div className={`bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border shadow-xs transition-all space-y-1.5 h-full flex flex-col justify-between ${
                  isPathology
                    ? 'border-teal-200/60 dark:border-teal-900/40 hover:border-teal-300'
                    : 'border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300'
                }`}>
                  <div className="flex items-center space-x-2">
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] border font-mono shrink-0 ${
                      isPathology
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700/60'
                        : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700/60'
                    }`}>
                      01
                    </span>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">
                      {isPathology ? t('pathologyWorkflowStep1Title') : t('workflowStep1Title')}
                    </h4>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 leading-relaxed font-medium flex-1">
                    {isPathology ? t('pathologyWorkflowStep1Desc') : t('workflowStep1Desc')}
                  </p>
                </div>

                {/* Step 2 */}
                <div className={`bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border shadow-xs transition-all space-y-1.5 h-full flex flex-col justify-between ${
                  isPathology
                    ? 'border-teal-200/60 dark:border-teal-900/40 hover:border-teal-300'
                    : 'border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300'
                }`}>
                  <div className="flex items-center space-x-2">
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] border font-mono shrink-0 ${
                      isPathology
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700/60'
                        : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/60'
                    }`}>
                      02
                    </span>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">
                      {isPathology ? t('pathologyWorkflowStep2Title') : t('workflowStep2Title')}
                    </h4>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 leading-relaxed font-medium flex-1">
                    {isPathology ? t('pathologyWorkflowStep2Desc') : t('workflowStep2Desc')}
                  </p>
                </div>

                {/* Step 3 */}
                <div className={`bg-white dark:bg-slate-800/90 rounded-xl p-3 sm:p-3.5 lg:p-4 border shadow-xs transition-all space-y-1.5 h-full flex flex-col justify-between ${
                  isPathology
                    ? 'border-teal-200/60 dark:border-teal-900/40 hover:border-teal-300'
                    : 'border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300'
                }`}>
                  <div className="flex items-center space-x-2">
                    <span className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] border font-mono shrink-0 ${
                      isPathology
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700/60'
                        : 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700/60'
                    }`}>
                      03
                    </span>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm leading-tight">
                      {isPathology ? t('pathologyWorkflowStep3Title') : t('workflowStep3Title')}
                    </h4>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 pt-1.5 border-t border-slate-100 dark:border-slate-700/80 leading-relaxed font-medium flex-1">
                    {isPathology ? t('pathologyWorkflowStep3Desc') : t('workflowStep3Desc')}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
});

export default WelcomeScreen;
