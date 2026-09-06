import React, { useEffect } from 'react';
import { Cpu, Check, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { apiRequest } from '../services/apiService';

export const ModelSelectionSection: React.FC = React.memo(() => {
  const language = useAppStore((s) => s.language);
  const appEngineMode = useAppStore((s) => s.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const analysisMode = useAppStore((s) => s.analysisMode);
  const setAnalysisMode = useAppStore((s) => s.setAnalysisMode);

  const isEn = language === 'EN';

  useEffect(() => {
    // Clear a pre-pilot preference retained in this browser's running session.
    const state = useAppStore.getState();
    if (state.selectedModelA) state.setSelectedModelA('');
    if (state.selectedModelB) state.setSelectedModelB('');
    // Preserve BYOK's system-fallback availability hint without fetching selectable models.
    let active = true;
    apiRequest<{ systemApiAvailable: boolean }>('/api/system-capabilities')
      .then(data => {
        if (active && typeof data.systemApiAvailable === 'boolean') state.setSystemApiAvailable(data.systemApiAvailable);
      })
      .catch(err => console.error('Failed to load system capabilities:', err));
    return () => { active = false; };
  }, []);

  return (
    <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/80 pb-2">
        <div className="flex items-center space-x-2">
          <Cpu className={`w-4 h-4 shrink-0 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
            {isEn ? 'AI Processing Mode & Model Selection' : 'Chế độ & Mô hình AI Phân tích'}
          </h4>
        </div>

      </div>

      {/* Single vs Dual Mode Selection */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {/* Single AI Mode */}
        <div
          onClick={() => setAnalysisMode('single')}
          className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start space-x-2.5 ${
            analysisMode === 'single'
              ? isPathology
                ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 font-medium shadow-xs'
                : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 font-medium shadow-xs'
              : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            <div
              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                analysisMode === 'single'
                  ? isPathology
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              {analysisMode === 'single' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </div>
          <div className="space-y-0.5 flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight flex items-center gap-1.5">
              <span>Single AI</span>
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
              {isEn ? '1 model call for fast result' : 'Gửi 1 lượt gọi model đơn lẻ (Tối ưu tốc độ)'}
            </p>
          </div>
        </div>

        {/* Dual AI Consensus / Multi-Agent Mode */}
        <div
          onClick={() => setAnalysisMode('consensus')}
          className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start space-x-2.5 ${
            analysisMode === 'consensus'
              ? isPathology
                ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 font-medium shadow-xs'
                : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 font-medium shadow-xs'
              : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            <div
              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                analysisMode === 'consensus'
                  ? isPathology
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              {analysisMode === 'consensus' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </div>
          <div className="space-y-0.5 flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight flex items-center gap-1">
              <span>{isPathology ? (isEn ? 'Dual AI Consensus' : 'Hội chẩn Song song') : (isEn ? 'Dual AI' : 'Hội chẩn Song song')}</span>
              <Sparkles className="w-3 h-3 text-amber-500" />
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
              {isPathology 
                ? (isEn ? 'Parallel 2-model vision & spatial polygon fusion' : 'Hội chẩn song song 2 model & dung hợp đa giác')
                : (isEn ? '2 models parallel cross-check' : 'Hội chẩn song song 2 model & tổng hợp')}
            </p>
          </div>
        </div>
      </div>

      {isPathology && analysisMode === 'consensus' && (
        <div className="pt-2">
          <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-lg p-2.5 flex items-start space-x-2 text-[10px] sm:text-xs">
            <span className="text-amber-500 mt-0.5 shrink-0">⏳</span>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              {isEn 
                ? 'Dual AI Consensus mode processes 2 AI models simultaneously and will take more time.' 
                : 'Chế độ Hội chẩn Song song xử lý đồng thời 2 mô hình AI sẽ tốn nhiều thời gian hơn.'}
            </p>
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80">
        <p className="text-xs text-slate-800 dark:text-slate-200">
          {isEn ? 'Model: Automatic' : 'Mô hình: Tự động'}
        </p>
      </div>
    </div>
  );
});
