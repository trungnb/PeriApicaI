import React, { useEffect } from 'react';
import { Cpu, RefreshCw, Check, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { apiRequest } from '../services/apiService';

export const ModelSelectionSection: React.FC = React.memo(() => {
  const language = useAppStore((s) => s.language);
  const appEngineMode = useAppStore((s) => s.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const analysisMode = useAppStore((s) => s.analysisMode);
  const setAnalysisMode = useAppStore((s) => s.setAnalysisMode);

  const selectedModelA = useAppStore((s) => s.selectedModelA);
  const setSelectedModelA = useAppStore((s) => s.setSelectedModelA);
  const selectedModelB = useAppStore((s) => s.selectedModelB);
  const setSelectedModelB = useAppStore((s) => s.setSelectedModelB);

  const availableModels = useAppStore((s) => s.availableModels);
  const setAvailableModels = useAppStore((s) => s.setAvailableModels);
  const isLoadingModels = useAppStore((s) => s.isLoadingModels);
  const setIsLoadingModels = useAppStore((s) => s.setIsLoadingModels);

  const apiKeyOption = useAppStore((s) => s.apiKeyOption);
  const customApiKey = useAppStore((s) => s.customApiKey);

  const isEn = language === 'EN';

  const loadModels = React.useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const data = await apiRequest<{
        success: boolean;
        models: Array<{ id: string; displayName: string }>;
      }>('/api/available-models', {
        method: 'POST',
        body: JSON.stringify({
          customApiKey: apiKeyOption === 'custom' ? customApiKey : undefined,
        }),
      });

      if (data && data.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        
        // Set default selections if needed
        const flashModel = data.models.find((m) => m.id.includes('flash')) || data.models[0];
        const proModel = data.models.find((m) => m.id.includes('pro')) || data.models[0];

        if (flashModel && !selectedModelA) {
          setSelectedModelA(flashModel.id);
        }
        if (proModel && !selectedModelB) {
          setSelectedModelB(proModel.id);
        }
      }
    } catch (err) {
      console.error('Failed to load available models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  }, [apiKeyOption, customApiKey, selectedModelA, selectedModelB, setAvailableModels, setIsLoadingModels, setSelectedModelA, setSelectedModelB]);

  useEffect(() => {
    loadModels();
  }, [apiKeyOption, customApiKey]);

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
        <button
          onClick={loadModels}
          disabled={isLoadingModels}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          title={isEn ? 'Refresh models' : 'Làm mới danh sách mô hình'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
        </button>
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

      {/* Model Dropdown Selectors */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-3">
        {analysisMode === 'single' ? (
          <div className="space-y-1.5">
            <label htmlFor="select-model-single" className="block text-xs font-bold text-slate-800 dark:text-slate-200">
              {isEn ? 'Choose Active AI Model:' : 'Lựa chọn Mô hình AI Phân tích:'}
            </label>
            <select
              id="select-model-single"
              value={selectedModelA || 'gemini-flash-latest'}
              onChange={(e) => setSelectedModelA(e.target.value)}
              className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium cursor-pointer"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.id}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="select-model-primary" className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                {isEn ? 'Primary Model (Model 1):' : 'Mô hình AI Ưu tiên 1:'}
              </label>
              <select
                id="select-model-primary"
                value={selectedModelA || 'gemini-flash-latest'}
                onChange={(e) => setSelectedModelA(e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium cursor-pointer"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="select-model-secondary" className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                {isEn ? 'Secondary Model (Model 2):' : 'Mô hình AI Phản biện 2:'}
              </label>
              <select
                id="select-model-secondary"
                value={selectedModelB || 'gemini-pro-latest'}
                onChange={(e) => setSelectedModelB(e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium cursor-pointer"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
