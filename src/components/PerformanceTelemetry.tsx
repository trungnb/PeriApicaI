import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Activity, Cpu, Wifi, Zap, Database, ChevronDown, ChevronUp } from 'lucide-react';

export const PerformanceTelemetry: React.FC = React.memo(() => {
  const lastAnalysisMetrics = useAppStore(state => state.lastAnalysisMetrics);
  const language = useAppStore(state => state.language);
  const [isOpen, setIsOpen] = useState(true); // default open to show the stats instantly

  if (!lastAnalysisMetrics) return null;

  const isEn = language === 'EN';

  const {
    clientCompressTimeMs,
    networkTimeMs,
    geminiTimeMs,
    totalTimeMs,
    wasCached,
    modelUsed
  } = lastAnalysisMetrics;

  return (
    <div id="performance-telemetry-panel" className="shrink-0 bg-slate-50/80 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl p-3.5 text-xs space-y-2 shadow-xs transition-all">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
          <span className="font-bold text-slate-950 dark:text-slate-200">
            {isEn ? '🔥 Diagnostics & Execution Telemetry' : '🔥 Chỉ số Đo lường & Hiệu năng Chẩn đoán'}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400 font-bold">
            {totalTimeMs}ms
          </span>
          {wasCached && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-[10px] text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200/40">
              {isEn ? 'Cache Hit' : 'Truy xuất Đệm (Cache)'}
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {isOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-200/50 dark:border-slate-800/60 transition-all">
          {/* Item 1: Client Compression */}
          <div className="bg-white dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40 flex items-start space-x-2.5 shadow-2xs">
            <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                {isEn ? 'Image Optimizer' : 'Tối ưu hóa Ảnh'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {isEn ? 'Web Worker Thread' : 'Nén đa tầng dưới luồng nền'}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1">
                {clientCompressTimeMs} <span className="text-[10px] font-normal text-slate-500">ms</span>
              </p>
            </div>
          </div>



          {/* Item 3: Gemini Execution */}
          <div className="bg-white dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40 flex items-start space-x-2.5 shadow-2xs">
            <Cpu className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                {isEn ? 'Server Processing' : 'Đo lường Server'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[110px]">
                {modelUsed || 'Gemini Flash'}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1">
                {geminiTimeMs} <span className="text-[10px] font-normal text-slate-500">ms</span>
              </p>
            </div>
          </div>

          {/* Item 4: Total & Status */}
          <div className="bg-white dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40 flex items-start space-x-2.5 shadow-2xs">
            <Database className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                {isEn ? 'Combined Latency' : 'Chu kỳ Xử lý'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {wasCached ? (isEn ? 'Cold Start Avoided' : 'Khớp bộ đệm RAM') : (isEn ? 'Cold Start Risk' : 'Mở container / Cold start')}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-slate-100 mt-1">
                {totalTimeMs} <span className="text-[10px] font-normal text-slate-500">ms</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
