import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, CheckCircle2, Stethoscope } from 'lucide-react';
import { ConfirmedPathology } from '../types/dental';
import {
  PATHOLOGY_DICT,
  getPathologyLabel,
  getPathologyDescription,
} from '../constants/dictionaries';
import {
  URGENCY_BADGE,
} from '../data/pathologyTaxonomyData';
import { useAppStore } from '../store/appStore';

interface Props {
  detection: ConfirmedPathology;
  isSelected: boolean;
  isVisible: boolean;
  geminiNote?: string;
  geminiVerified: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
}

export const PathologyFindingCard: React.FC<Props> = React.memo(({
  detection,
  isSelected,
  isVisible,
  geminiNote,
  geminiVerified,
  onSelect,
  onToggleVisibility,
}) => {
  const { t } = useTranslation(['pathology', 'common']);
  const language = useAppStore((s) => s.language);

  const taxItem = PATHOLOGY_DICT[detection.pathologyKey];
  const urgency = taxItem?.protocol?.urgency ?? 'routine';
  const urgencyBadge = URGENCY_BADGE[urgency];
  const label = getPathologyLabel(detection.pathologyKey, language);
  const description = getPathologyDescription(detection.pathologyKey, language);

  const hasGeometry = detection.geometryStatus === 'valid' ||
    (!detection.geometryStatus && Array.isArray(detection.polygonPoints) && detection.polygonPoints.length >= 3);

  return (
    <div
      className={`relative rounded-xl border transition-all cursor-pointer select-none ${
        isSelected
          ? 'border-teal-500 bg-teal-50/60 dark:bg-teal-950/30 shadow-md ring-1 ring-teal-500/20'
          : hasGeometry
          ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
          : 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-400 dark:hover:border-slate-600'
      }`}
      onClick={onSelect}
    >
      {/* Colour stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl"
        style={{ background: detection.color }}
      />

      <div className="pl-4 pr-3 py-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                {taxItem?.domainId?.replace('domain_p', 'P')}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${urgencyBadge.className}`}
              >
                {language === 'EN' ? urgencyBadge.labelEn : urgencyBadge.label}
              </span>
              {!hasGeometry && (
                <span className="text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600">
                  {language === 'EN' ? 'Localisation unavailable' : 'Không có toạ độ định vị'}
                </span>
              )}
              {geminiVerified && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  {t('geminiVerified')}
                </span>
              )}
              {detection.provenance === 'matched_consensus' && (
                <span
                  title={detection.modelAScore !== undefined && detection.modelBScore !== undefined ? `Flash: ${detection.modelAScore}% | Pro: ${detection.modelBScore}%` : undefined}
                  className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-semibold px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800"
                >
                  {language === 'EN' ? 'Both Models Agreed' : '2 Mô hình nhất quán'}
                  {detection.modelAScore !== undefined && detection.modelBScore !== undefined && (
                    <span className="ml-1 opacity-75 font-mono text-[9px]">
                      ({detection.modelAScore}% / {detection.modelBScore}%)
                    </span>
                  )}
                </span>
              )}
              {detection.provenance === 'model_a_only' && !detection.humanReviewed && (
                <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                  {language === 'EN' ? 'Model A Only (Review Needed)' : '1 Mô hình (A) - Cần rà soát'}
                </span>
              )}
              {detection.provenance === 'model_b_only' && !detection.humanReviewed && (
                <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                  {language === 'EN' ? 'Model B Only (Review Needed)' : '1 Mô hình (B) - Cần rà soát'}
                </span>
              )}
              {detection.humanReviewed && (
                <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                  {language === 'EN' ? 'Human Confirmed' : 'Bác sĩ đã xác nhận'}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">
              {label}
            </p>
          </div>

          {/* Visibility toggle button */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {hasGeometry ? (
              <button
                onClick={onToggleVisibility}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 transition-colors cursor-pointer"
                title={isVisible ? (language === 'EN' ? 'Hide contour on image' : 'Ẩn viền trên ảnh') : (language === 'EN' ? 'Show contour on image' : 'Hiện viền trên ảnh')}
              >
                {isVisible ? <Eye className="w-4 h-4 text-teal-600 dark:text-teal-400" /> : <EyeOff className="w-4 h-4" />}
              </button>
            ) : (
              <span
                className="p-1.5 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                title={language === 'EN' ? 'No contour available on image' : 'Không có toạ độ viền trên ảnh'}
              >
                <EyeOff className="w-4 h-4" />
              </span>
            )}
          </div>
        </div>

        {/* Confidence & Details */}
        <div className="flex gap-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          <span
            title={language === 'EN' ? 'Model confidence score (heuristic, requires clinical verification)' : 'Điểm ước lượng mô hình AI (cần xác minh chuyên môn)'}
          >
            {t('confidence')}:{' '}
            <strong className="text-slate-700 dark:text-slate-300">
              {typeof detection.confidence === 'number' ? `${detection.confidence}%` : '—'}
            </strong>
          </span>
          {hasGeometry && detection.polygonPoints && detection.polygonPoints.length >= 3 ? (
            <span>
              · <strong className="text-teal-600 dark:text-teal-400">{detection.polygonPoints.length}</strong> {language === 'EN' ? 'vertices' : 'điểm neo'}
            </span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 italic">
              · {language === 'EN' ? 'No contour' : 'Không có viền'}
            </span>
          )}
          {detection.isUserEdited && (
            <span className="text-teal-600 dark:text-teal-400 font-semibold font-sans">
              (✏ {t('edited')})
            </span>
          )}
        </div>

        {/* Clinical Note / Description */}
        {(description || geminiNote) && (
          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 pt-0.5">
            {geminiNote || description}
          </p>
        )}

        {/* Treatment Recommendation */}
        {detection.treatmentRecommendation && (
          <div className="mt-2 p-2 bg-teal-50/50 dark:bg-teal-950/20 rounded-lg border border-teal-200/80 dark:border-teal-800/40 text-[11px]">
            <p className="font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5 mb-0.5">
              <Stethoscope className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
              {t('treatmentRecommendation', language === 'EN' ? 'Treatment Recommendation:' : 'Hướng xử trí & Điều trị đề xuất:')}
            </p>
            <p className="text-slate-700 dark:text-slate-200">
              {detection.treatmentRecommendation}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});
