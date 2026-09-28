import React from 'react';
import {
  Stethoscope,
  BookOpen,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { PathologyOverlayCanvas } from './PathologyOverlayCanvas';
import {
  getPathologyLabel,
  getPathologyDescription,
  getTreatmentText,
} from '../constants/dictionaries';
import {
  PATHOLOGY_DOMAIN_META,
} from '../data/pathologyTaxonomyData';
import {
  getToothDisplayName,
  getArchDisplayName,
  getTechniqueDisplayName,
  getReceptorDisplayName,
} from '../data/taxonomyData';

export const TreatmentRecommendationScreen: React.FC = React.memo(() => {
  const language = useAppStore((s) => s.language);
  const imageDataUrl = useAppStore((s) => s.imageDataUrl);
  const confirmedPathologies = useAppStore((s) => s.confirmedPathologies);
  const selectedTooth = useAppStore((s) => s.selectedTooth);
  const selectedTechnique = useAppStore((s) => s.selectedTechnique);
  const selectedReceptor = useAppStore((s) => s.selectedReceptor);
  const userNotes = useAppStore((s) => s.userNotes);
  const setUserNotes = useAppStore((s) => s.setUserNotes);
  const isEn = language === 'EN';

  const techniqueText = getTechniqueDisplayName(selectedTechnique, language);
  const receptorText = getReceptorDisplayName(selectedReceptor, language);

  const treatmentItems = React.useMemo(() => {
    return confirmedPathologies.map((p) => {
      const label = getPathologyLabel(p.pathologyKey, language);
      const desc = getPathologyDescription(p.pathologyKey, language);
      const treatment = getTreatmentText(p.pathologyKey, language);
      const domainMeta = PATHOLOGY_DOMAIN_META[p.domainId];

      return {
        id: p.id,
        key: p.pathologyKey,
        label,
        domainId: p.domainId,
        domainName: isEn ? domainMeta?.labelEn : domainMeta?.label,
        description: desc,
        treatment,
        color: p.color,
        confidence: p.confidence,
      };
    });
  }, [confirmedPathologies, language, isEn]);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24 space-y-4 max-w-7xl mx-auto">
        
        {/* Step Header */}
        <div className="shrink-0 bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isEn
                ? `Target Tooth: ${selectedTooth.fdiNumber} - ${getToothDisplayName(selectedTooth, language)} (${getArchDisplayName(selectedTooth.arch, language)})`
                : `Răng mục tiêu: ${selectedTooth.fdiNumber} - ${getToothDisplayName(selectedTooth, language)} (${getArchDisplayName(selectedTooth.arch, language)})`}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {isEn ? 'Imaging Technique' : 'Kỹ thuật chụp'}: <strong className="font-semibold text-teal-700 dark:text-teal-400">{techniqueText}</strong> • {isEn ? 'Receptor Type' : 'Bộ nhận ảnh'}: <strong className="font-semibold text-teal-700 dark:text-teal-400">{receptorText}</strong>
            </p>
          </div>
        </div>

        {/* 12-Column Grid — Exact structure of ValidationScreen */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column (4 cols): Image with Polygon Overlay & Summary */}
          <div className="lg:col-span-4 flex flex-col space-y-4 pr-1">
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>{isEn ? 'Evaluated Radiograph' : 'Ảnh X-quang Đã Phân Đoạn'}</span>
              </h3>

              {imageDataUrl && (
                <div className="rounded-xl overflow-hidden bg-slate-900">
                  <PathologyOverlayCanvas
                    imageDataUrl={imageDataUrl}
                    detections={confirmedPathologies}
                    selectedId={null}
                  />
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700/80">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block font-mono">
                  {isEn
                    ? `Reviewed Findings (${confirmedPathologies.length}):`
                    : `Phát hiện đã rà soát (${confirmedPathologies.length}):`}
                </span>

                {confirmedPathologies.length === 0 ? (
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium italic bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-700/60">
                    {isEn ? 'No reviewed candidate findings are present for this radiograph.' : 'Không có phát hiện gợi ý đã rà soát trên phim.'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {treatmentItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2 bg-teal-50/80 dark:bg-teal-950/50 rounded-lg border border-teal-200 dark:border-teal-700/60 text-teal-900 dark:text-teal-200 text-xs font-semibold flex items-center space-x-2 font-mono"
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.color }} />
                        <span className="truncate">{item.label}</span>
                        <span className="ml-auto text-[10px] opacity-70">{typeof item.confidence === 'number' ? `${item.confidence}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column (8 cols): Step-by-Step Treatment Guidance */}
          <div className="lg:col-span-8 flex flex-col space-y-6 pr-1">
            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-slate-700/80 pb-3">
                <Stethoscope className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {isEn ? 'Educational Reference Guidance' : 'Hướng dẫn Tham khảo Giáo dục'}
                </h3>
              </div>

              {treatmentItems.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isEn
                      ? 'Reference guidance linked to the reviewed finding classes:'
                      : 'Hướng dẫn tham khảo gắn với các nhóm phát hiện đã rà soát:'}
                  </p>

                  <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1 custom-scrollbar">
                    {treatmentItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-2 transition-all hover:border-slate-300 dark:hover:border-slate-600"
                      >
                        {/* Title Row with Domain Badge */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-200/80 dark:border-slate-700/80 pb-2">
                          <div className="flex items-center space-x-2 text-teal-950 dark:text-teal-200 font-extrabold text-sm">
                            <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                            <span>{item.label}</span>
                          </div>
                          {item.domainName && (
                            <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-700/60">
                              {item.domainName}
                            </span>
                          )}
                        </div>

                        {/* X-ray Observation Description */}
                        {item.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                            {isEn ? 'Radiographic Finding' : 'Dấu hiệu X-quang'}: {item.description}
                          </p>
                        )}

                        {/* Treatment Action Box (matching Sparkles in Luồng A) */}
                        <div className="pt-1 space-y-1">
                          <span className="text-xs font-bold text-teal-800 dark:text-teal-400 flex items-center space-x-1">
                            <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                            <span>{isEn ? 'Reference Guidance:' : 'Hướng dẫn tham khảo:'}</span>
                          </span>
                          <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-medium pl-3 bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                            {item.treatment}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200 space-y-2">
                  <div className="flex items-center space-x-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <span>{isEn ? 'No Reviewed Candidate Findings' : 'Không có Phát hiện Gợi ý đã Rà soát'}</span>
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    {isEn
                      ? 'No reviewed candidate findings are present. This does not establish a normal radiograph; interpret independently.'
                      : 'Không có phát hiện gợi ý đã rà soát. Kết quả này không xác lập phim bình thường; cần diễn giải độc lập.'}
                  </p>
                </div>
              )}

              {/* Notes Input — Identical to Luồng A */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isEn ? 'Reviewer Notes:' : 'Ghi chú của người rà soát:'}
                </label>
                <textarea
                  rows={3}
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  placeholder={isEn ? 'Enter reviewer notes...' : 'Nhập ghi chú rà soát...'}
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
});

export default TreatmentRecommendationScreen;
