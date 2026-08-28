import React, { useMemo, useEffect } from 'react';
import {
  Microscope,
  Loader2,
  Brain,
  CheckCircle2,
  Sparkles,
  CheckSquare,
  AlertTriangle,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { usePathologyAnalysis } from '../hooks/usePathologyAnalysis';
import { PolygonContourEditor } from './PolygonContourEditor';
import { PathologyFindingCard } from './PathologyFindingCard';
import { PerformanceTelemetry } from './PerformanceTelemetry';
import {
  PATHOLOGY_DICT,
} from '../constants/dictionaries';
import {
  PATHOLOGY_DOMAIN_META,
  PATHOLOGY_TAXONOMY,
} from '../data/pathologyTaxonomyData';
import {
  getToothDisplayName,
  getArchDisplayName,
  getTechniqueDisplayName,
  getReceptorDisplayName,
} from '../data/taxonomyData';
import { ConfirmedPathology, AIDetection, PathologyKey, PathologyDomainId } from '../types/dental';

export const PathologyAnalysisScreen: React.FC = React.memo(() => {
  const language = useAppStore((s) => s.language);
  const imageDataUrl = useAppStore((s) => s.imageDataUrl);
  const selectedTooth = useAppStore((s) => s.selectedTooth);
  const selectedTechnique = useAppStore((s) => s.selectedTechnique);
  const selectedReceptor = useAppStore((s) => s.selectedReceptor);
  const confirmedPathologies = useAppStore((s) => s.confirmedPathologies);
  const setConfirmedPathologies = useAppStore((s) => s.setConfirmedPathologies);
  const hiddenDetectionIds = useAppStore((s) => s.hiddenDetectionIds);
  const pathologyGeminiResult = useAppStore((s) => s.pathologyGeminiResult);
  const pathologyAnalysisStatus = useAppStore((s) => s.pathologyAnalysisStatus);
  const pathologyStatusMessage = useAppStore((s) => s.pathologyStatusMessage);
  const isEn = language === 'EN';

  const userConcurred = useAppStore((s) => s.userConcurred);
  const setUserConcurred = useAppStore((s) => s.setUserConcurred);
  const selectedOverrideKeys = useAppStore((s) => s.selectedOverrideKeys);
  const setSelectedOverrideKeys = useAppStore((s) => s.setSelectedOverrideKeys);

  const updateDetectionPolygon = useAppStore((s) => s.updateDetectionPolygon);
  const toggleDetectionVisibility = useAppStore((s) => s.toggleDetectionVisibility);

  const { runAnalysis } = usePathologyAnalysis();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const isRunning = pathologyAnalysisStatus === 'analyzing';
  const isComplete = pathologyAnalysisStatus === 'complete';

  // Initial keys detected by AI
  const initialAiPathologyKeys = useMemo(() => {
    return confirmedPathologies.map((p) => p.pathologyKey);
  }, [confirmedPathologies]);

  // Sync override keys with initial detections
  useEffect(() => {
    if (selectedOverrideKeys.length === 0 && initialAiPathologyKeys.length > 0) {
      setSelectedOverrideKeys(initialAiPathologyKeys);
    }
  }, [initialAiPathologyKeys, selectedOverrideKeys.length]);

  const handleToggleOverrideKey = (key: PathologyKey) => {
    const isSelected = selectedOverrideKeys.includes(key);
    let nextKeys: string[];
    if (isSelected) {
      nextKeys = selectedOverrideKeys.filter((k) => k !== key);
    } else {
      nextKeys = [...selectedOverrideKeys, key];
    }
    setSelectedOverrideKeys(nextKeys);

    // Update confirmed pathologies according to override selection
    const updated = nextKeys.map((k) => {
      const existing = confirmedPathologies.find((p) => p.pathologyKey === k);
      if (existing) return existing;
      const tax = PATHOLOGY_DICT[k];
      const defaultBox: [number, number, number, number] = [150, 150, 350, 350];
      const defaultPolygon: [number, number][] = [
        [150, 150],
        [350, 150],
        [350, 350],
        [150, 350],
      ];
      return {
        id: `manual-${k}-${Date.now()}`,
        pathologyKey: k as PathologyKey,
        domainId: tax.domainId,
        confidence: 90,
        bbox: defaultBox,
        polygonPoints: defaultPolygon,
        color: tax.color,
        fillColor: tax.fillColor,
        label: tax.label,
        labelEn: tax.labelEn,
        description: tax.description,
        descriptionEn: tax.descriptionEn,
        geminiVerified: false,
        isUserEdited: true,
      } as ConfirmedPathology;
    });

    setConfirmedPathologies(updated);
  };

  // Visible detections for canvas
  const visibleDetections = useMemo(
    () => confirmedPathologies.filter((d) => !hiddenDetectionIds.has(d.id)) as AIDetection[],
    [confirmedPathologies, hiddenDetectionIds],
  );

  // Group confirmed pathologies by domain
  const byDomain = useMemo(() => {
    const groups = new Map<PathologyDomainId, ConfirmedPathology[]>();
    confirmedPathologies.forEach((p) => {
      if (!groups.has(p.domainId)) groups.set(p.domainId, []);
      groups.get(p.domainId)!.push(p);
    });
    return groups;
  }, [confirmedPathologies]);

  const techniqueText = getTechniqueDisplayName(selectedTechnique, language);
  const receptorText = getReceptorDisplayName(selectedReceptor, language);

  if (!imageDataUrl) return null;

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-4 pt-4 pb-24 space-y-4 max-w-7xl mx-auto">
        
        {/* ── Step Header Card ─────────── */}
        <div className="shrink-0 bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700/80 pb-3">
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

          {/* Disclaimer notice banner (Amber theme) */}
          <div className="bg-amber-50/90 dark:bg-amber-950/40 border-l-4 border-amber-500 border-t border-r border-b border-amber-200 dark:border-amber-700/60 rounded-xl p-3.5 text-xs text-amber-950 dark:text-amber-100 leading-relaxed space-y-1 shadow-xs">
            <div className="flex items-center space-x-2 font-semibold text-amber-900 dark:text-amber-300">
              <span className="text-amber-600 dark:text-amber-400">ℹ️</span>
              <span>{isEn ? 'AI Anomaly Segmentation Disclaimer' : 'Lưu ý về Phân đoạn Bất thường AI'}</span>
            </div>
            <p className="text-amber-900/90 dark:text-amber-200/90 pl-5 leading-relaxed">
              {isEn
                ? 'AI segmentation outlines are for clinical educational & reference purposes. Final diagnostic verification rests with the licensed dental practitioner.'
                : 'Các đường viền đa giác phân đoạn tự động từ AI phục vụ mục đích hỗ trợ học tập & tham khảo lâm sàng. Chẩn đoán và quyết định điều trị cuối cùng thuộc về Bác sĩ Răng Hàm Mặt.'}
            </p>
          </div>
        </div>

        {/* Diagnostics & Execution Telemetry */}
        <PerformanceTelemetry />

        {/* ── Idle State (when user has not run segmentation yet) ── */}
        {pathologyAnalysisStatus === 'idle' && (
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-12 border border-slate-200/80 dark:border-slate-700/80 shadow-xs text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 flex items-center justify-center mx-auto">
              <Microscope className="w-8 h-8" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isEn ? 'Ready for Pathology Spatial Grounding' : 'Sẵn Sàng Phân Đoạn Tổn Thương Nha Khoa'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
              {isEn
                ? 'Gemini 2D Spatial will scan the radiograph and trace organic polygon boundary contours around recognized pathologies and anatomical structures.'
                : 'Mô hình Gemini 2D Spatial sẽ quét phim X-quang và tự động phân đoạn các đường viền đa giác ôm sát từng tổn thương và cấu trúc giải phẫu.'}
            </p>
            <button
              onClick={runAnalysis}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition-all shadow-md shadow-teal-500/20 active:scale-95 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isEn ? 'Run Spatial Segmentation' : 'Bắt Đầu Phân Đoạn Tổn Thương'}</span>
            </button>
          </div>
        )}

        {/* ── Loading State ───────────────────────────────────── */}
        {isRunning && confirmedPathologies.length === 0 && (
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-12 border border-slate-200/80 dark:border-slate-700/80 shadow-xs text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {pathologyStatusMessage ?? (isEn ? 'Segmenting structures with Gemini 2D Spatial...' : 'Đang phân đoạn cấu trúc với Gemini 2D Spatial...')}
            </p>
            <p className="text-[11px] text-slate-400">
              {isEn ? 'Extracting normalized polygon contours...' : 'Đang tính toán tọa độ đường viền đa giác giải phẫu...'}
            </p>
          </div>
        )}

        {/* ── Error State ─────────────────────────────────────── */}
        {pathologyAnalysisStatus === 'error' && confirmedPathologies.length === 0 && (
          <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-10 border border-rose-200 dark:border-rose-800/60 shadow-xs text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {isEn ? 'Pathology Segmentation Incomplete' : 'Phân Đoạn Bất Thường Chưa Hoàn Thành'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {pathologyStatusMessage || (isEn ? 'AI service encountered an error or reached quota limit.' : 'Hệ thống AI gặp sự cố hoặc đã chạm hạn mức sử dụng.')}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={runAnalysis}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition-all shadow-xs cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isEn ? 'Retry Segmentation' : 'Thử Lại Phân Đoạn'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Main 12-Column Grid (Identical to Luồng A) ──────── */}
        {(isComplete || confirmedPathologies.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* ── LEFT: Viewer Canvas & Controls (4 cols) ───────── */}
            <div className="lg:col-span-4 flex flex-col space-y-4 pr-1">
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center space-x-2">
                    <Microscope className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>{isEn ? 'Interactive Spatial Contours' : 'Bản Đồ Viền Đa Giác'}</span>
                  </h3>
                </div>

                {/* Dark Viewer Canvas Container */}
                <div className="rounded-xl overflow-hidden bg-slate-900 border border-slate-700/60 p-2 flex items-center justify-center">
                  <PolygonContourEditor
                    imageDataUrl={imageDataUrl}
                    detections={visibleDetections}
                    selectedId={selectedId}
                    onPolygonUpdate={updateDetectionPolygon}
                    onSelect={setSelectedId}
                  />
                </div>

                {/* Spatial Manipulation Hint Box (Amber theme style) */}
                <div className="p-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border-l-4 border-amber-500 border-t border-r border-b border-amber-200 dark:border-amber-700/60 text-xs text-amber-950 dark:text-amber-100 space-y-1 shadow-xs">
                  <p className="font-bold text-xs flex items-center gap-1.5 text-amber-900 dark:text-amber-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    {isEn ? 'Interactive Contour Controls:' : 'Hướng dẫn chỉnh sửa viền:'}
                  </p>
                  <p className="pl-5 text-amber-900/90 dark:text-amber-200/90">• {isEn ? 'Click & drag vertices to reshape boundary.' : 'Kéo các điểm neo tròn để nắn chỉnh viền bất thường.'}</p>
                  <p className="pl-5 text-amber-900/90 dark:text-amber-200/90">• {isEn ? 'Click inside polygon to move whole boundary.' : 'Kéo bên trong viền để di chuyển toàn bộ vùng.'}</p>
                </div>

                {/* Gemini Diagnostic Overview Card */}
                {pathologyGeminiResult?.overallSummary && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5 text-teal-500" />
                      {isEn ? 'Gemini Diagnostic Overview:' : 'Tóm tắt chẩn đoán Gemini:'}
                    </span>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {pathologyGeminiResult.overallSummary}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: Findings & Clinical Verification (8 cols) ─ */}
            <div className="lg:col-span-8 flex flex-col space-y-4 pr-1">
              
              {/* Clinical Verification Box (Exact concurrence mechanism as Luồng A) */}
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-3">
                  <div className="flex items-center space-x-2">
                    <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {isEn ? 'Clinical Verification & Agreement' : 'Thẩm Định & Đồng Thuận Lâm Sàng'}
                    </h3>
                  </div>
                  {userConcurred === true && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold border border-emerald-200 dark:border-emerald-700/60">
                      {isEn ? '✓ Concurred with AI' : '✓ Đồng thuận với AI'}
                    </span>
                  )}
                  {userConcurred === false && (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 text-[10px] font-bold border border-rose-200 dark:border-rose-700/60">
                      {isEn ? '✏ Manual Override Active' : '✏ Chỉnh sửa thủ công'}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug">
                    {isEn
                      ? 'Do you clinically agree with the AI-segmented anomalies and structures?'
                      : 'Bác sĩ có đồng thuận với các bất thường và cấu trúc do AI phân đoạn?'}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setUserConcurred(true);
                        // Reset to AI findings
                        setSelectedOverrideKeys(initialAiPathologyKeys);
                      }}
                      className={`px-3 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer min-h-[44px] ${
                        userConcurred === true
                          ? 'bg-emerald-600 text-white font-bold shadow-2xs'
                          : 'bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{isEn ? 'Yes, Agree' : 'Đồng ý'}</span>
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
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{isEn ? 'Disagree' : 'Không đồng ý'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Manual Checklist Mode (when user clicks "Không đồng ý") */}
              {userConcurred === false && (
                <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border border-rose-200 dark:border-rose-800 shadow-xs space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-rose-100 dark:border-rose-800/60 pb-2">
                    <span className="text-xs font-bold text-rose-800 dark:text-rose-300">
                      {isEn ? 'Select actual clinical findings from 8 standardized categories:' : 'Tích chọn các bất thường thực tế trên phim (8 nhóm chuẩn):'}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-500">
                      {selectedOverrideKeys.length} / 8 đã chọn
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PATHOLOGY_TAXONOMY.map((item) => {
                      const isChecked = selectedOverrideKeys.includes(item.key);
                      return (
                        <div
                          key={item.key}
                          onClick={() => handleToggleOverrideKey(item.key)}
                          className={`p-3 rounded-xl border flex items-start gap-2.5 cursor-pointer select-none transition-all ${
                            isChecked
                              ? 'border-teal-500 bg-teal-50/70 dark:bg-teal-950/50 text-teal-950 dark:text-teal-200 ring-2 ring-teal-500/40 shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50/80 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-0.5 rounded text-teal-600 focus:ring-teal-500 pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.color }} />
                              <span className="text-xs font-bold leading-tight truncate">{isEn ? item.labelEn : item.label}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{isEn ? item.descriptionEn : item.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Identified Findings List */}
              <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-3">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                    <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                      {isEn ? `Confirmed Anomalies (${confirmedPathologies.length})` : `Danh Sách Cấu Trúc & Bất Thường (${confirmedPathologies.length})`}
                    </h3>
                  </div>
                </div>

                {confirmedPathologies.length === 0 && (
                  <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200 space-y-2">
                    <div className="flex items-center space-x-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      <span>{isEn ? 'No Anomalies Detected' : 'Không Phát Hiện Bất Thường'}</span>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                      {isEn
                        ? 'The radiograph does not exhibit signs of periapical radiolucency, bone loss, or carious lesions.'
                        : 'Không ghi nhận dấu hiệu thấu quang quanh chóp, tiêu xương ổ răng hay sâu răng trên phim.'}
                    </p>
                  </div>
                )}

                {/* 3 Domain Groups */}
                <div className="space-y-4">
                  {Array.from(byDomain.entries()).map(([domainId, detections]) => {
                    const domainMeta = PATHOLOGY_DOMAIN_META[domainId];
                    return (
                      <div key={domainId} className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{domainMeta?.icon}</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                              {isEn ? domainMeta?.labelEn : domainMeta?.label}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            {detections.length}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {detections.map((det) => (
                            <PathologyFindingCard
                              key={det.id}
                              detection={det}
                              isSelected={selectedId === det.id}
                              isVisible={!hiddenDetectionIds.has(det.id)}
                              geminiVerified={det.geminiVerified}
                              geminiNote={det.geminiNote}
                              onSelect={() => setSelectedId(det.id === selectedId ? null : det.id)}
                              onToggleVisibility={() => toggleDetectionVisibility(det.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
});

export default PathologyAnalysisScreen;

