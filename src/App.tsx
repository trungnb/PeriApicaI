import React, { useEffect, useState, useRef, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from './theme/ThemeProvider';
import { Header } from './components/Header';
import { StickyBottomNav } from './components/StickyBottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainScreenSkeleton, ModalSkeleton } from './components/SkeletonLoaders';
import { useAppStore } from './store/appStore';
import { flushPendingLogs, flushPendingPathologyLogs } from './services/apiService';
import { usePredictivePrefetch } from './hooks/usePredictivePrefetch';
import { useRadiographAnalysis } from './hooks/useRadiographAnalysis';
import { useAssessmentSession } from './hooks/useAssessmentSession';

const lazyWithRetry = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) =>
  lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      console.warn('[lazyWithRetry] Dynamic import failed, retrying in 500ms...', error);
      await new Promise(resolve => setTimeout(resolve, 500));
      return await factory();
    }
  });

const WelcomeScreen = lazyWithRetry(() => import('./components/WelcomeScreen').then(module => ({ default: module.WelcomeScreen })));
const ConfigurationScreen = lazyWithRetry(() => import('./components/ConfigurationScreen').then(module => ({ default: module.ConfigurationScreen })));
const UploadScreen = lazyWithRetry(() => import('./components/UploadScreen').then(module => ({ default: module.UploadScreen })));
const AIAnalysisScreen = lazyWithRetry(() => import('./components/AIAnalysisScreen').then(module => ({ default: module.AIAnalysisScreen })));
const PathologyAnalysisScreen = lazyWithRetry(() => import('./components/PathologyAnalysisScreen').then(module => ({ default: module.PathologyAnalysisScreen })));
const ValidationScreen = lazyWithRetry(() => import('./components/ValidationScreen').then(module => ({ default: module.ValidationScreen })));
const TreatmentRecommendationScreen = lazyWithRetry(() => import('./components/TreatmentRecommendationScreen').then(module => ({ default: module.TreatmentRecommendationScreen })));
const AdminPortalModal = lazyWithRetry(() => import('./components/AdminPortalModal').then(module => ({ default: module.AdminPortalModal })));
const ReportBugModal = lazyWithRetry(() => import('./components/ReportBugModal').then(module => ({ default: module.ReportBugModal })));
const GlobalAlertModal = lazyWithRetry(() => import('./components/GlobalAlertModal').then(module => ({ default: module.GlobalAlertModal })));
const SystemNoticeModal = lazyWithRetry(() => import('./components/SystemNoticeModal').then(module => ({ default: module.SystemNoticeModal })));
const DisclaimerModal = lazyWithRetry(() => import('./components/DisclaimerModal').then(module => ({ default: module.DisclaimerModal })));

const pageVariants = {
  initial: (direction: 'forward' | 'backward') => ({
    opacity: 0,
    x: direction === 'forward' ? 20 : -20,
  }),
  in: {
    opacity: 1,
    x: 0,
  },
  out: (direction: 'forward' | 'backward') => ({
    opacity: 0,
    x: direction === 'forward' ? -20 : 20,
  }),
};

const pageTransition: any = {
  type: "tween",
  ease: [0.2, 0.8, 0.2, 1],
  duration: 0.35,
};

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  usePredictivePrefetch(); // Enable Phase 4 Predictive Prefetching

  const { t: tCommon } = useTranslation('common');
  const { t: tConfig } = useTranslation('config');
  const { t: tUpload } = useTranslation('upload');
  const { t: tAnalysis } = useTranslation('analysis');
  const { t: tRemediation } = useTranslation('remediation');

  const { handleAnalyzeRadiograph } = useRadiographAnalysis();
  const { completeValidationAndSave, completePathologySessionAndSave, savePathologyStep4 } = useAssessmentSession();

  const currentStep = useAppStore(state => state.currentStep);
  const setCurrentStep = useAppStore(state => state.setCurrentStep);
  const isAdminModalOpen = useAppStore(state => state.isAdminModalOpen);
   
  const systemNoticeModal = useAppStore(state => state.systemNoticeModal);
  const isBugModalOpen = useAppStore(state => state.isBugModalOpen);
  const globalError = useAppStore(state => state.globalError);

  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem('periapic_disclaimer_seen')) {
        const timer = setTimeout(() => setIsDisclaimerOpen(true), 400);
        return () => clearTimeout(timer);
      }
    } catch {}
  }, []);

  const handleCloseDisclaimer = React.useCallback(() => {
    try {
      localStorage.setItem('periapic_disclaimer_seen', 'true');
    } catch {}
    setIsDisclaimerOpen(false);
  }, []);

  const prevStepRef = useRef(currentStep);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  useEffect(() => {
    if (currentStep !== prevStepRef.current) {
      setDirection(currentStep > prevStepRef.current ? 'forward' : 'backward');
      prevStepRef.current = currentStep;
    }
  }, [currentStep]);

  useEffect(() => {
    fetch('/api/health').catch(() => {});

    const triggerFlush = () => {
      flushPendingLogs().catch(() => {});
      flushPendingPathologyLogs().catch(() => {});
    };

    triggerFlush();

    window.addEventListener('online', triggerFlush);
    return () => {
      window.removeEventListener('online', triggerFlush);
    };
  }, []);

  const isAnalyzing = useAppStore(state => state.isAnalyzing);
  const isQuotaExhausted = useAppStore(state => state.isQuotaExhausted);
  const quotaResetNotice = useAppStore(state => state.quotaResetNotice);
  const hasImageData = useAppStore(state => Boolean(state.imageDataUrl));
  const appEngineMode = useAppStore(state => state.appEngineMode);

  // Stable callbacks for Navigation to prevent sub-tree re-rendering
  const handleNavToStep1 = React.useCallback(() => setCurrentStep(1), [setCurrentStep]);
  const handleNavToStep2 = React.useCallback(() => setCurrentStep(2), [setCurrentStep]);
  const handleNavToStep3 = React.useCallback(() => setCurrentStep(3), [setCurrentStep]);
  const handleNavToStep4 = React.useCallback(() => setCurrentStep(4), [setCurrentStep]);

  const handleProceedFromAnalysisClassic = React.useCallback(() => {
    const store = useAppStore.getState();
    store.setConfirmedErrorKeys(store.confirmedErrorKeys);
    store.setCurrentStep(5);
  }, []);

  const handleProceedFromAnalysisPathology = React.useCallback(() => {
    // 1. Transition immediately
    useAppStore.getState().setCurrentStep(5);
    // 2. Persist Step 4 progress in background
    savePathologyStep4().catch((err) => {
      console.debug('[App] Step 4 background log notice:', err);
    });
  }, [savePathologyStep4]);

  const handleFinishRemediationClassic = React.useCallback(() => {
    completeValidationAndSave().catch((err) => {
      console.debug('[App] Step 5 Classic finish background save notice:', err);
    });
  }, [completeValidationAndSave]);

  const handleFinishRemediationPathology = React.useCallback(() => {
    completePathologySessionAndSave().catch((err) => {
      console.debug('[App] Step 5 Pathology finish background save notice:', err);
    });
  }, [completePathologySessionAndSave]);

  // Memoized Bottom Navigation Node
  const bottomNavNode = React.useMemo(() => {
    switch (currentStep) {
      case 2:
        return (
          <StickyBottomNav
            onBack={handleNavToStep1}
            backText={tConfig('back')}
            onNext={handleNavToStep3}
            nextText={appEngineMode === 'pathology_segmentation' ? tConfig('pathologyContinue') : tConfig('continue')}
            nextIcon="arrow-right"
            maxWidthClass="max-w-5xl"
          />
        );
      case 3:
        return (
          <StickyBottomNav
            onBack={handleNavToStep2}
            backText={tUpload('back')}
            onNext={handleAnalyzeRadiograph}
            nextText={
              isAnalyzing
                ? tUpload('analyzingBtn')
                : (appEngineMode === 'pathology_segmentation'
                    ? tUpload('analyzePathologyBtn', tCommon('startPathologyAiSegmentation'))
                    : tUpload('analyzeBtn'))
            }
            isNextDisabled={!hasImageData}
            isAnalyzing={isAnalyzing}
            isQuotaExhausted={isQuotaExhausted}
            quotaResetNotice={tUpload('quotaLockedBtn', { time: quotaResetNotice || (tCommon('1m')) })}
            nextIcon="sparkles"
            maxWidthClass="max-w-5xl"
          />
        );
      case 4:
        // Classic mode: show Proceed to Remediation
        if (appEngineMode !== 'pathology_segmentation') {
          return (
            <StickyBottomNav
              onBack={handleNavToStep3}
              backText={tAnalysis('back')}
              onNext={handleProceedFromAnalysisClassic}
              nextText={tAnalysis('proceedToRemediation')}
              nextIcon="arrow-right"
              maxWidthClass="max-w-7xl"
            />
          );
        }
        // Pathology mode: bottom nav with proceed to treatment
        return (
          <StickyBottomNav
            onBack={handleNavToStep3}
            backText={tAnalysis('back', tCommon('back'))}
            onNext={handleProceedFromAnalysisPathology}
            nextText={tAnalysis('viewTreatmentSuggestions', tCommon('viewTreatmentSuggestions'))}
            nextIcon="arrow-right"
            maxWidthClass="max-w-7xl"
          />
        );
      case 5:
        if (appEngineMode !== 'pathology_segmentation') {
          return (
            <StickyBottomNav
              onBack={handleNavToStep4}
              backText={tRemediation('backToAnalysis')}
              onNext={handleFinishRemediationClassic}
              nextText={tRemediation('finishAndReturnHome')}
              nextIcon="home"
              maxWidthClass="max-w-7xl"
            />
          );
        }
        return (
          <StickyBottomNav
            onBack={handleNavToStep4}
            backText={tRemediation('backToAnalysis', tCommon('backToAnalysis'))}
            onNext={handleFinishRemediationPathology}
            nextText={tRemediation('finishAndReturnHome', tCommon('finishReturnHome'))}
            nextIcon="home"
            maxWidthClass="max-w-7xl"
          />
        );
      default:
        return null;
    }
  }, [
    currentStep,
    appEngineMode,
    isAnalyzing,
    isQuotaExhausted,
    quotaResetNotice,
    hasImageData,
    tConfig,
    tUpload,
    tAnalysis,
    tRemediation,
    tCommon,
    handleNavToStep1,
    handleNavToStep2,
    handleNavToStep3,
    handleNavToStep4,
    handleAnalyzeRadiograph,
    handleProceedFromAnalysisClassic,
    handleProceedFromAnalysisPathology,
    handleFinishRemediationClassic,
    handleFinishRemediationPathology,
  ]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans flex flex-col selection:bg-blue-100 selection:text-blue-900">
      <Header />

      <main className="flex-1 w-full relative flex flex-col min-h-0 overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div 
              key={currentStep} 
              custom={direction}
              initial="initial"
              animate="in"
              exit="out"
              variants={pageVariants}
              transition={pageTransition}
              className="flex-1 flex flex-col min-h-0 w-full"
            >
              <ErrorBoundary><Suspense fallback={<MainScreenSkeleton />}>
                {currentStep === 1 && <WelcomeScreen />}
                {currentStep === 2 && <ConfigurationScreen />}
                {currentStep === 3 && <UploadScreen />}
                {currentStep === 4 && appEngineMode !== 'pathology_segmentation' && <AIAnalysisScreen />}
                {currentStep === 4 && appEngineMode === 'pathology_segmentation' && <PathologyAnalysisScreen />}
                {currentStep === 5 && appEngineMode !== 'pathology_segmentation' && <ValidationScreen />}
                {currentStep === 5 && appEngineMode === 'pathology_segmentation' && <TreatmentRecommendationScreen />}
              </Suspense></ErrorBoundary>
            </motion.div>
          </AnimatePresence>
          {bottomNavNode}
      </main>

      {isAdminModalOpen && (
        <ErrorBoundary><Suspense fallback={<ModalSkeleton />}>
          <AdminPortalModal />
        </Suspense></ErrorBoundary>
      )}

      <Suspense fallback={<ModalSkeleton />}>
        {isBugModalOpen && <ReportBugModal />}
        {globalError && <GlobalAlertModal />}
        {systemNoticeModal?.isOpen && <SystemNoticeModal />}
        {isDisclaimerOpen && <DisclaimerModal onClose={handleCloseDisclaimer} />}
      </Suspense>

      <footer className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 py-2.5 px-3 sm:py-3 sm:px-4 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between space-y-1.5 sm:space-y-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
            {tCommon('disclaimer')}
          </p>
          <div className="flex items-center space-x-1 text-slate-400/80 dark:text-slate-500 text-[10px] uppercase tracking-widest">
            <span>By</span>
            <a 
              href="https://trungnb.github.io" 
              target="_blank" 
              rel="noopener noreferrer"
              className="font-semibold text-slate-400 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              NBTrung
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
