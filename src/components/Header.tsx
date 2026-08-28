import React from "react";
import { ShieldCheck, Bug, Sun, Moon } from "lucide-react";
import { useTheme } from '../theme/useTheme';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';

export const Header: React.FC = React.memo(() => {
  const { t } = useTranslation('common');
  const language = useAppStore(state => state.language);
  const toggleLanguage = useAppStore(state => state.toggleLanguage);
  const { isDark, toggleTheme } = useTheme();

  const currentStep = useAppStore(state => state.currentStep);
  const hasImageData = useAppStore(state => Boolean(state.imageDataUrl));
  const hasAnalysisResult = useAppStore(state => Boolean(state.analysisResult || state.pathologyGeminiResult));
  const isAnalyzing = useAppStore(state => state.isAnalyzing);
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const onResetToStart = () => {
    if (isAnalyzing) return;
    useAppStore.getState().startNewSession();
  };

  const onOpenBugModal = () => useAppStore.getState().setIsBugModalOpen(true);
  const onOpenAdminModal = () => useAppStore.getState().setIsAdminModalOpen(true);
  const prefetchAdminModal = () => {
    import('./AdminPortalModal').catch(() => {});
  };

  const steps = [
    { num: 1, label: t('stepHome') },
    { num: 2, label: t('stepConfig') },
    { num: 3, label: t('stepUpload') },
    { num: 4, label: t('stepAnalysis') },
    { num: 5, label: t('stepRemediation') },
  ];

  return (
    <header className="shrink-0 bg-slate-50/95 dark:bg-slate-950/95 border-b border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sticky top-0 z-40 backdrop-blur-md shadow-2xs">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-2.5">
        <div className="flex items-center justify-between gap-1.5 lg:gap-3 flex-nowrap">
          {/* Brand Logo & Name (Hành Kim sinh Thủy - Bạch Kim Platinum + Đen Thạch Anh) */}
          <div
            className="flex items-center space-x-2 sm:space-x-2.5 cursor-pointer group shrink-0"
            onClick={onResetToStart}
          >
            {/* Logo Container with Subtle Fading Aura Glow */}
            <div className="relative flex items-center justify-center shrink-0">
              {/* Outer Fading Aura Glow */}
              <div
                className={`absolute -inset-1 rounded-xl blur-xs transition-all duration-300 opacity-[0.55] group-hover:opacity-85 ${
                  isPathology
                    ? 'bg-teal-500/60'
                    : 'bg-sky-500/60'
                }`}
              />

              {/* Inner Logo Box */}
              <div
                className={`relative z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-slate-900 flex items-center justify-center shrink-0 overflow-hidden border transition-all duration-300 ${
                  isPathology
                    ? 'border-teal-500/60 shadow-[0_0_8px_rgba(20,184,166,0.3)]'
                    : 'border-sky-500/60 shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                }`}
              >
                <img
                  src="/logo.png?v=2"
                  alt="PeriApicaI"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="hidden sm:block">
              <h1 className="text-base sm:text-lg lg:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-1.5 sm:gap-2">
                <span className="flex items-center">
                  PeriApic
                  <span
                    className={`font-black ml-0 transition-all duration-300 bg-clip-text text-transparent ${
                      isPathology
                        ? 'bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-300 dark:from-teal-300 dark:via-emerald-300 dark:to-cyan-200 drop-shadow-[0_0_6px_rgba(20,184,166,0.5)]'
                        : 'bg-gradient-to-r from-sky-500 via-blue-400 to-indigo-400 dark:from-sky-300 dark:via-blue-300 dark:to-indigo-300 drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]'
                    }`}
                  >
                    aI
                  </span>
                </span>
                <span className="inline-flex items-center text-[9px] font-mono font-bold tracking-tight text-slate-600 dark:text-slate-300 bg-slate-200/90 dark:bg-slate-800/90 px-1.5 py-0.5 rounded-full border border-slate-300/80 dark:border-slate-700/80 leading-none shadow-2xs self-baseline sm:self-center">
                  {t('version')}
                </span>
              </h1>
            </div>
          </div>

          {/* Workflow Steps Navigator (Ánh sáng kim loại Platinum slate-200 / Đen Thạch Anh slate-900) */}
          <nav
            aria-label="Progress Stepper"
            className="flex items-center space-x-0.5 md:space-x-1 bg-slate-200/90 dark:bg-slate-900/90 p-1 rounded-xl border border-slate-300/80 dark:border-slate-800 shadow-inner shrink-0"
          >
            {steps.map((s, idx) => {
              const isActive = currentStep === s.num;
              const isPassed = currentStep > s.num;

              const isClickable = isAnalyzing
                ? false
                : s.num === currentStep
                  ? true
                  : s.num === 1
                    ? true
                    : currentStep === 1
                      ? false
                      : s.num <= currentStep
                        ? true
                        : s.num === 3
                          ? hasImageData
                          : s.num >= 4
                            ? hasAnalysisResult
                            : false;

              const handleStepClick = () => {
                if (isClickable && s.num !== currentStep) {
                  useAppStore.getState().setCurrentStep(s.num);
                }
              };

              return (
                <React.Fragment key={s.num}>
                  <button
                    type="button"
                    onClick={handleStepClick}
                    disabled={!isClickable}
                    title={
                      s.num === currentStep
                        ? `${t('currentAt')} ${s.label}`
                        : isClickable
                          ? `${t('switchTo')} ${s.label}`
                          : `${t('notAvailable')} (${s.label})`
                    }
                    className={`flex items-center justify-center py-1 rounded-lg text-xs transition-all ${
                      isActive
                        ? "px-1.5 lg:px-2.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold shadow-xs border border-slate-950 dark:border-white cursor-default"
                        : isClickable
                          ? "px-1.5 lg:px-2.5 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-300/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white cursor-pointer active:scale-95"
                          : "px-1.5 lg:px-2.5 text-slate-400 dark:text-slate-500 font-medium cursor-not-allowed opacity-60"
                    }`}
                  >
                    {/* Circle Indicator: Number or Checkmark */}
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all ${
                        isActive
                          ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-black shadow-xs"
                          : isPassed
                            ? "bg-slate-300/90 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-400/60 dark:border-slate-600"
                            : "bg-transparent text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {isPassed ? "✓" : s.num}
                    </span>

                    {/* Adaptive Label */}
                    <span
                      className={`whitespace-nowrap text-xs ${
                        isActive
                          ? "hidden lg:inline-block ml-1.5 font-bold"
                          : "hidden xl:inline-block ml-1.5"
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>

                  {/* Connecting Line between steps */}
                  {idx < steps.length - 1 && (
                    <div className="hidden lg:block w-1.5 xl:w-2.5 h-0.5 rounded-full mx-0.5 transition-colors duration-300">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          currentStep > s.num
                            ? "bg-slate-900 dark:bg-slate-200"
                            : "bg-slate-300 dark:bg-slate-700"
                        }`}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Right Action Group */}
          <div className="flex items-center space-x-1.5 lg:space-x-2 shrink-0">
            {/* Language Switcher - Desktop (lg+) */}
            <button
              type="button"
              onClick={() => {
                if (currentStep === 1) toggleLanguage();
              }}
              disabled={currentStep !== 1}
              className={`hidden lg:inline-flex relative items-center p-0.5 w-[72px] h-8 rounded-xl border shadow-inner select-none transition-all shrink-0 active:scale-95 ${
                currentStep === 1
                  ? "bg-slate-200/90 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300/80 dark:border-slate-700 cursor-pointer"
                  : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
              }`}
              title={
                currentStep !== 1
                  ? t('langChangeDisabledTooltip')
                  : (language === 'VI' ? t('langTooltipVI') : t('langTooltipEN'))
              }
              role="switch"
              aria-checked={language === 'EN'}
              aria-label="Toggle language between VI and EN"
            >
              <div
                className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[10px] shadow-xs border transition-transform duration-200 ease-out pointer-events-none ${
                  currentStep === 1
                    ? "bg-slate-900 dark:bg-slate-100 border-slate-950 dark:border-white shadow-xs"
                    : "bg-slate-400 border-slate-400"
                } ${t('translatexfull')}`}
              />
              <span
                className={`relative z-10 w-1/2 flex items-center justify-center text-xs transition-colors duration-150 pointer-events-none ${
                  language === 'VI'
                    ? "text-white dark:text-slate-900 font-extrabold"
                    : "text-slate-600 dark:text-slate-400 font-semibold"
                }`}
              >
                VI
              </span>
              <span
                className={`relative z-10 w-1/2 flex items-center justify-center text-xs transition-colors duration-150 pointer-events-none ${
                  t('textwhiteDarktextslate900Fontextrabold')
                }`}
              >
                EN
              </span>
            </button>

            {/* Language Switcher - Mobile/Tablet (< lg) */}
            <button
              type="button"
              onClick={() => {
                if (currentStep === 1) toggleLanguage();
              }}
              disabled={currentStep !== 1}
              className={`lg:hidden flex items-center justify-center w-8 h-8 rounded-xl border shadow-inner select-none transition-all shrink-0 active:scale-95 text-[11px] font-extrabold tracking-wide ${
                currentStep === 1
                  ? "bg-slate-200/90 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300/80 dark:border-slate-700 cursor-pointer"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
              }`}
              title={
                currentStep !== 1
                  ? t('langChangeDisabledTooltip')
                  : (language === 'VI' ? t('langTooltipVI') : t('langTooltipEN'))
              }
              role="switch"
              aria-checked={language === 'EN'}
              aria-label="Toggle language between VI and EN"
            >
              {language}
            </button>

            {/* Theme Toggle - Desktop (lg+) */}
            <button
              type="button"
              onClick={toggleTheme}
              className="hidden lg:inline-flex relative items-center p-0.5 w-[72px] h-8 rounded-xl border shadow-inner select-none transition-all shrink-0 cursor-pointer active:scale-95 bg-slate-200/90 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300/80 dark:border-slate-700"
              title={t('darkModeTooltip')}
              role="switch"
              aria-checked={isDark}
              aria-label="Toggle Theme"
            >
              <div
                className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[10px] shadow-xs border bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 transition-transform duration-200 ease-out pointer-events-none ${
                  isDark ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              <span
                className={`relative z-10 w-1/2 flex items-center justify-center transition-colors duration-150 pointer-events-none ${
                  !isDark ? "text-amber-500" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Sun className="w-4 h-4" />
              </span>
              <span
                className={`relative z-10 w-1/2 flex items-center justify-center transition-colors duration-150 pointer-events-none ${
                  isDark ? "text-sky-400 font-extrabold" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Moon className="w-4 h-4" />
              </span>
            </button>

            {/* Theme Toggle - Mobile/Tablet (< lg) */}
            <button
              type="button"
              onClick={toggleTheme}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-xl border shadow-inner select-none transition-all shrink-0 cursor-pointer active:scale-95 bg-slate-200/90 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 border-slate-300/80 dark:border-slate-700"
              title={t('darkModeTooltip')}
              role="switch"
              aria-checked={isDark}
              aria-label="Toggle Theme"
            >
              {isDark ? (
                <Moon className="w-4 h-4 text-sky-400" />
              ) : (
                <Sun className="w-4 h-4 text-amber-500" />
              )}
            </button>

            {/* Bug Report Button */}
            <button
              onClick={onOpenBugModal}
              className="flex items-center justify-center p-1.5 lg:px-2.5 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/60 font-semibold text-xs transition-all shadow-xs border border-rose-200 shrink-0 cursor-pointer active:scale-95 w-8 lg:w-[115px]"
              title={t('reportBugTitle')}
            >
              <Bug className="w-4 h-4 lg:w-3.5 lg:h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
              <span className="hidden lg:inline ml-1.5 whitespace-nowrap">{t('reportBug')}</span>
            </button>

            {/* Admin Portal Button (Đen Thạch Anh / Bạch Kim Tương Phản Cao) */}
            <button
              onClick={onOpenAdminModal}
              onMouseEnter={prefetchAdminModal}
              onFocus={prefetchAdminModal}
              onTouchStart={prefetchAdminModal}
              className="flex items-center justify-center p-1.5 lg:px-2.5 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 font-bold text-xs transition-all shadow-xs shrink-0 cursor-pointer active:scale-95 w-8 lg:w-[115px] border border-slate-950 dark:border-white"
              title={t('adminTitle')}
            >
              <ShieldCheck className="w-4 h-4 lg:w-3.5 lg:h-3.5 shrink-0 text-white dark:text-slate-900" />
              <span className="hidden lg:inline ml-1.5 whitespace-nowrap">{t('admin')}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});
