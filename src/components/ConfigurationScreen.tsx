import React from 'react';
import { ToothInfo } from '../types/dental';
import { ALL_TEETH, getToothDisplayName, getArchDisplayName, getToothTypeDisplayName } from '../data/taxonomyData';
import { Check, HardDrive, Compass, Target, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { prefetchStep2AIModules } from '../hooks/usePredictivePrefetch';

const q1Teeth = ALL_TEETH.filter((t) => t.quadrant === 1);
const q2Teeth = ALL_TEETH.filter((t) => t.quadrant === 2);
const q3Teeth = ALL_TEETH.filter((t) => t.quadrant === 3);
const q4Teeth = ALL_TEETH.filter((t) => t.quadrant === 4);

export const ConfigurationScreen: React.FC = React.memo(() => {
  const { t, i18n } = useTranslation('config');
  const language = useAppStore(state => state.language);
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  // Proactively prime and prefetch AI modules and base64 decoder as soon as Step 2 mounts
  React.useEffect(() => {
    prefetchStep2AIModules();
  }, []);

  const hasAnalysisResult = useAppStore(state => !!state.analysisResult);
  const [pendingChange, setPendingChange] = React.useState<(() => void) | null>(null);

  const handleInterceptChange = (changeFn: () => void) => {
    if (hasAnalysisResult) {
      setPendingChange(() => changeFn);
    } else {
      changeFn();
    }
  };

  const selectedTechnique = useAppStore(state => state.selectedTechnique);
  const onSelectTechnique = useAppStore(state => state.setSelectedTechnique);
  const selectedReceptor = useAppStore(state => state.selectedReceptor);
  const onSelectReceptor = useAppStore(state => state.setSelectedReceptor);
  const selectedTooth = useAppStore(state => state.selectedTooth);
  const onSelectTooth = (tooth: ToothInfo) => {
    handleInterceptChange(() => {
      const store = useAppStore.getState();
      if (store.selectedTooth.fdiNumber !== tooth.fdiNumber) {
        store.setSelectedTooth(tooth);
        store.setImageDataUrl(null);
      }
    });
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24">
        <div className="max-w-5xl mx-auto space-y-6">
          
          {/* Header */}
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4 space-y-1">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>{isPathology ? t('pathologyTitle') : t('title')}</span>
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isPathology ? t('pathologySubtitle') : t('subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Technique */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
              <div className="flex items-center space-x-2">
                <Compass className={`w-5 h-5 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {isPathology ? t('pathologyTechniqueTitle') : t('techniqueTitle')}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  onClick={() => handleInterceptChange(() => onSelectTechnique('Paralleling'))}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer h-full min-h-[120px] flex flex-col justify-start ${
                    selectedTechnique === 'Paralleling'
                      ? isPathology
                        ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 shadow-2xs font-semibold'
                        : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 shadow-2xs font-semibold'
                      : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t('paralleling')}</span>
                    {selectedTechnique === 'Paralleling' && (
                      <Check className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight font-normal">
                    {t('parallelingDesc')}
                  </p>
                </button>

                <button
                  onClick={() => handleInterceptChange(() => onSelectTechnique('Bisecting Angle'))}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer h-full min-h-[120px] flex flex-col justify-start ${
                    selectedTechnique === 'Bisecting Angle'
                      ? isPathology
                        ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 shadow-2xs font-semibold'
                        : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 shadow-2xs font-semibold'
                      : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t('bisecting')}</span>
                    {selectedTechnique === 'Bisecting Angle' && (
                      <Check className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight font-normal">
                    {t('bisectingDesc')}
                  </p>
                </button>
              </div>
            </div>

            {/* Receptor Type */}
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
              <div className="flex items-center space-x-2">
                <HardDrive className={`w-5 h-5 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {isPathology ? t('pathologyReceptorTitle') : t('receptorTitle')}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  onClick={() => handleInterceptChange(() => onSelectReceptor('Analogue/Phosphor Plate'))}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer h-full min-h-[120px] flex flex-col justify-start ${
                    selectedReceptor === 'Analogue/Phosphor Plate'
                      ? isPathology
                        ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 shadow-2xs font-semibold'
                        : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 shadow-2xs font-semibold'
                      : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t('phosphorPlate')}</span>
                    {selectedReceptor === 'Analogue/Phosphor Plate' && (
                      <Check className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight font-normal">
                    {t('phosphorPlateDesc')}
                  </p>
                </button>

                <button
                  onClick={() => handleInterceptChange(() => onSelectReceptor('Digital Sensor'))}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer h-full min-h-[120px] flex flex-col justify-start ${
                    selectedReceptor === 'Digital Sensor'
                      ? isPathology
                        ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 shadow-2xs font-semibold'
                        : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 shadow-2xs font-semibold'
                      : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{t('digitalSensor')}</span>
                    {selectedReceptor === 'Digital Sensor' && (
                      <Check className={`w-4 h-4 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-tight font-normal">
                    {t('digitalSensorDesc')}
                  </p>
                </button>
              </div>
            </div>
          </div>

          {/* Target Tooth Section */}
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700/80 pb-3">
              <div className="flex items-center space-x-2">
                <Target className={`w-5 h-5 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    {isPathology ? t('pathologyTargetToothTitle') : t('targetToothTitle')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isPathology ? t('pathologyTargetToothSubtitle') : t('targetToothSubtitle')}
                  </p>
                </div>
              </div>
            </div>

            {selectedTooth && (
              <div className={`rounded-xl p-3.5 border flex items-center justify-between text-xs ${
                isPathology
                  ? 'bg-teal-50/80 dark:bg-teal-950/40 border-teal-200 dark:border-teal-500/30 text-teal-900 dark:text-teal-100'
                  : 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-500/30 text-blue-900 dark:text-blue-100'
              }`}>
                <div className="flex items-center space-x-3">
                  <span className={`w-8 h-8 rounded-lg text-white font-bold flex items-center justify-center text-sm shadow-xs font-mono ${
                    isPathology ? 'bg-teal-600 dark:bg-teal-600' : 'bg-blue-600 dark:bg-blue-600'
                  }`}>
                    {selectedTooth.fdiNumber}
                  </span>
                  <div>
                    <p className="font-bold text-sm text-slate-900 dark:text-slate-100">{getToothDisplayName(selectedTooth, language)}</p>
                    <p className={`text-[11px] font-mono ${isPathology ? 'text-teal-800 dark:text-teal-300' : 'text-blue-800 dark:text-sky-300'}`}>
                      {t('selectedToothDetails', {
                        universal: selectedTooth.universalNumber,
                        arch: getArchDisplayName(selectedTooth.arch, language),
                        type: getToothTypeDisplayName(selectedTooth.type, language),
                      })}
                    </p>
                  </div>
                </div>
                <span className={`hidden sm:inline-flex items-center space-x-1 px-2.5 py-1 rounded-md font-semibold text-[11px] border ${
                  isPathology
                    ? 'bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-700/60'
                    : 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-sky-300 border-blue-200 dark:border-blue-700/60'
                }`}>
                  {isPathology && <Sparkles className="w-3 h-3 text-teal-600 dark:text-teal-400" />}
                  <span>{isPathology ? t('pathologySelectedBadge') : t('selectedBadge')}</span>
                </span>
              </div>
            )}

            <div className="space-y-4 pt-2">
              {/* Maxillary */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider px-1 font-mono">
                  <span>{t('quadrant1')}</span>
                  <span className={`font-extrabold ${isPathology ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-sky-400'}`}>{t('maxillary')}</span>
                  <span>{t('quadrant2')}</span>
                </div>

                <div className="grid grid-cols-16 gap-1 bg-slate-50 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200 dark:border-slate-700/80">
                  {q1Teeth.map((tooth) => {
                    const isSelected = selectedTooth.fdiNumber === tooth.fdiNumber;
                    return (
                      <button
                        key={tooth.fdiNumber}
                        onClick={() => onSelectTooth(tooth)}
                        className={`h-8 rounded flex items-center justify-center transition-all border text-xs font-mono cursor-pointer ${
                          isSelected
                            ? isPathology
                              ? 'bg-teal-600 text-white border-teal-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-teal-400/40'
                              : 'bg-blue-600 text-white border-blue-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-blue-400/40'
                            : isPathology
                            ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-slate-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-700'
                        }`}
                        title={`${tooth.fdiNumber} - ${getToothDisplayName(tooth, language)}`}
                      >
                        <span className="font-bold">{tooth.fdiNumber}</span>
                      </button>
                    );
                  })}

                  {q2Teeth.map((tooth) => {
                    const isSelected = selectedTooth.fdiNumber === tooth.fdiNumber;
                    return (
                      <button
                        key={tooth.fdiNumber}
                        onClick={() => onSelectTooth(tooth)}
                        className={`h-8 rounded flex items-center justify-center transition-all border text-xs font-mono cursor-pointer ${
                          isSelected
                            ? isPathology
                              ? 'bg-teal-600 text-white border-teal-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-teal-400/40'
                              : 'bg-blue-600 text-white border-blue-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-blue-400/40'
                            : isPathology
                            ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-slate-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-700'
                        }`}
                        title={`${tooth.fdiNumber} - ${getToothDisplayName(tooth, language)}`}
                      >
                        <span className="font-bold">{tooth.fdiNumber}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mandibular */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider px-1 font-mono">
                  <span>{t('quadrant4')}</span>
                  <span className={`font-extrabold ${isPathology ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-sky-400'}`}>{t('mandibular')}</span>
                  <span>{t('quadrant3')}</span>
                </div>

                <div className="grid grid-cols-16 gap-1 bg-slate-50 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200 dark:border-slate-700/80">
                  {q4Teeth.map((tooth) => {
                    const isSelected = selectedTooth.fdiNumber === tooth.fdiNumber;
                    return (
                      <button
                        key={tooth.fdiNumber}
                        onClick={() => onSelectTooth(tooth)}
                        className={`h-8 rounded flex items-center justify-center transition-all border text-xs font-mono cursor-pointer ${
                          isSelected
                            ? isPathology
                              ? 'bg-teal-600 text-white border-teal-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-teal-400/40'
                              : 'bg-blue-600 text-white border-blue-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-blue-400/40'
                            : isPathology
                            ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-slate-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-700'
                        }`}
                        title={`${tooth.fdiNumber} - ${getToothDisplayName(tooth, language)}`}
                      >
                        <span className="font-bold">{tooth.fdiNumber}</span>
                      </button>
                    );
                  })}

                  {q3Teeth.map((tooth) => {
                    const isSelected = selectedTooth.fdiNumber === tooth.fdiNumber;
                    return (
                      <button
                        key={tooth.fdiNumber}
                        onClick={() => onSelectTooth(tooth)}
                        className={`h-8 rounded flex items-center justify-center transition-all border text-xs font-mono cursor-pointer ${
                          isSelected
                            ? isPathology
                              ? 'bg-teal-600 text-white border-teal-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-teal-400/40'
                              : 'bg-blue-600 text-white border-blue-500 font-extrabold shadow-md scale-105 z-10 ring-2 ring-blue-400/40'
                            : isPathology
                            ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-slate-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-700'
                        }`}
                        title={`${tooth.fdiNumber} - ${getToothDisplayName(tooth, language)}`}
                      >
                        <span className="font-bold">{tooth.fdiNumber}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {pendingChange && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-sm w-full p-6 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
              {i18n.language === 'en' ? 'Change Configuration?' : 'Thay đổi cấu hình?'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              {i18n.language === 'en'
                ? 'Changing the configuration will clear your current AI analysis results. You will need to re-analyze the image.'
                : 'Thay đổi này sẽ xóa kết quả phân tích AI hiện tại. Bạn sẽ phải chạy phân tích lại từ đầu.'}
            </p>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={() => setPendingChange(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                {i18n.language === 'en' ? 'Cancel' : 'Hủy bỏ'}
              </button>
              <button
                onClick={() => {
                  pendingChange();
                  setPendingChange(null);
                }}
                className={`px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors shadow-xs cursor-pointer ${
                  isPathology ? 'bg-teal-600 hover:bg-teal-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {i18n.language === 'en' ? 'Confirm Change' : 'Xác nhận thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default ConfigurationScreen;
