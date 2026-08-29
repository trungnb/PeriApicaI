import React, { useState, useEffect } from 'react';
import { Activity, Server, Cpu, HardDrive, Database, RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface SystemHealthData {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  uptimeHuman: string;
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    memoryUsageMB: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  firebaseAdmin: {
    status: string;
    projectId?: string;
    clientEmail?: string;
    storageAdapter?: string;
    notice?: string;
  };
  services: {
    hasZknjghtKey?: boolean;
    hasGeminiKey: boolean;
    hasFirebaseServiceAccount?: boolean;
    hasAdminPasswordConfigured: boolean;
    hasDeletePasswordConfigured: boolean;
  };
  cacheStats: {
    reportsCount: number;
    bugsCount: number;
    lastUpdated?: string;
  };
}

interface SystemHealthTabProps {
  getAuthHeader: () => Record<string, string>;
}

export const SystemHealthTab: React.FC<SystemHealthTabProps> = ({ getAuthHeader }) => {
  const language = useAppStore(state => state.language);
  const isEn = language === 'EN';

  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  const fetchHealth = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health', {
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }
      const data: SystemHealthData = await res.json();
      setHealthData(data);
      setLastFetchTime(new Date());
    } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      setError(err?.message || (isEn ? 'Failed to load health metrics' : 'Lỗi tải chỉ số sức khỏe hệ thống'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(() => {
      // Pause polling when browser tab is inactive or hidden
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchHealth();
    }, 10000); // Auto refresh every 10s when tab is active
    return () => clearInterval(interval);
  }, []);

  const heapPercentage = healthData?.system?.memoryUsageMB
    ? Math.min(100, Math.round((healthData.system.memoryUsageMB.heapUsed / Math.max(1, healthData.system.memoryUsageMB.heapTotal)) * 100))
    : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-blue-950/40 space-y-6 min-h-0">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between bg-white dark:bg-blue-950/80 p-4 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-900/60 border border-blue-200 dark:border-blue-700 rounded-xl text-blue-600 dark:text-blue-400">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
              {isEn ? 'Server & Infrastructure Health' : 'Sức khỏe Server & Hạ tầng Backend'}
            </h4>
            <p className="text-xs text-slate-500 dark:text-blue-300/70 mt-0.5 flex items-center gap-1.5">
              <span>{isEn ? 'Real-time telemetry from Node.js process' : 'Chỉ số đo lường thời gian thực từ tiến trình Node.js'}</span>
              {lastFetchTime && (
                <>
                  <span className="text-slate-300 dark:text-blue-700">•</span>
                  <span className="text-slate-400 dark:text-blue-400">
                    {isEn ? 'Updated' : 'Cập nhật'}: {lastFetchTime.toLocaleTimeString()}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={fetchHealth}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isEn ? 'Refresh Metrics' : 'Làm mới chỉ số'}</span>
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 p-4 rounded-xl text-xs flex items-center space-x-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 dark:text-rose-400 shrink-0" />
          <div>
            <strong className="font-semibold">{isEn ? 'Connection Error:' : 'Lỗi kết nối:'}</strong> {error}
          </div>
        </div>
      )}

      {healthData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. Server Uptime & Status Card */}
          <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-blue-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-blue-500" />
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  {isEn ? 'Server Status & Uptime' : 'Trạng thái Server & Uptime'}
                </span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                healthData.status === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700'
                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700'
              }`}>
                {healthData.status === 'ok' ? 'Online 100%' : 'Error'}
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-blue-300/70 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-blue-400" />
                  {isEn ? 'Running Uptime:' : 'Thời gian Uptime:'}
                </span>
                <span className="font-bold font-mono text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-blue-900/60 px-2 py-0.5 rounded border border-slate-200 dark:border-blue-800/60">
                  {healthData.uptimeHuman}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-blue-300/70">{isEn ? 'Node Runtime:' : 'Phiên bản Node.js:'}</span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{healthData.system?.nodeVersion} ({healthData.system?.platform}-{healthData.system?.arch})</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-blue-300/70">{isEn ? 'Server Clock:' : 'Đồng hồ Server:'}</span>
                <span className="font-mono text-[11px] text-slate-600 dark:text-blue-300">
                  {new Date(healthData.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Memory Usage (RAM) Card */}
          <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-blue-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  {isEn ? 'Memory Usage (RAM)' : 'Sử dụng Bộ nhớ RAM'}
                </span>
              </div>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                {healthData.system?.memoryUsageMB?.heapUsed || 0} MB / {healthData.system?.memoryUsageMB?.heapTotal || 0} MB
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-600 dark:text-blue-300/80 mb-1">
                  <span>{isEn ? 'Heap Allocated' : 'Tải trọng Heap Memory'}</span>
                  <span>{heapPercentage}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-blue-900/50 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      heapPercentage > 85 ? 'bg-rose-500' : heapPercentage > 65 ? 'bg-amber-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${heapPercentage}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="bg-slate-50 dark:bg-blue-900/40 p-2 rounded-lg border border-slate-100 dark:border-blue-800/60">
                  <span className="text-[10px] text-slate-400 dark:text-blue-300/60 block font-medium">{isEn ? 'RSS (Total Allocated)' : 'RSS (Tổng cấp phát)'}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{healthData.system?.memoryUsageMB?.rss || 0} MB</span>
                </div>
                <div className="bg-slate-50 dark:bg-blue-900/40 p-2 rounded-lg border border-slate-100 dark:border-blue-800/60">
                  <span className="text-[10px] text-slate-400 dark:text-blue-300/60 block font-medium">{isEn ? 'External Memory' : 'Bộ nhớ External'}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{healthData.system?.memoryUsageMB?.external || 0} MB</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Firebase Admin SDK Status Card */}
          <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-blue-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  Firebase Admin SDK
                </span>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                healthData.firebaseAdmin?.status === 'configured'
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700'
                  : 'bg-slate-100 dark:bg-blue-900/60 text-slate-600 dark:text-blue-300 border-slate-200 dark:border-blue-700'
              }`}>
                {healthData.firebaseAdmin?.status === 'configured' ? (isEn ? 'Connected' : 'Đã kết nối') : (isEn ? 'Transient' : 'Tạm thời')}
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-blue-300/70">{isEn ? 'Project ID:' : 'Dự án Firebase:'}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                  {healthData.firebaseAdmin?.projectId || 'N/A'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-blue-300/70">{isEn ? 'Active Adapter:' : 'Adapter chính:'}</span>
                <span className="font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/60 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-700">
                  {healthData.firebaseAdmin?.storageAdapter || 'In-Memory'}
                </span>
              </div>

              {healthData.firebaseAdmin?.notice && (
                <p className="text-[11px] text-slate-500 dark:text-blue-300/70 bg-slate-50 dark:bg-blue-900/40 p-2 rounded border border-slate-100 dark:border-blue-800/60 italic">
                  {healthData.firebaseAdmin.notice}
                </p>
              )}
            </div>
          </div>

          {/* 4. In-Memory Cache Stats Card */}
          <div className="bg-white dark:bg-blue-950/80 p-5 rounded-xl border border-slate-200 dark:border-blue-800/70 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-blue-900/80 pb-3">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  {isEn ? 'In-Memory Cache & Local Persistence' : 'Thống kê Bộ nhớ Đệm In-Memory & Cache Local'}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              {/* Diagnostic Reports Cached */}
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-blue-900/40 border border-slate-100 dark:border-blue-800/60">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {isEn ? 'Cached Diagnostic Reports' : 'Báo Cáo Chẩn Đoán Khảo Sát'}
                </span>
                <span className="font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-800">
                  {healthData.cacheStats?.reportsCount || 0} {isEn ? 'items' : 'mục'}
                </span>
              </div>

              {/* Bug Logs Cached */}
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-blue-900/40 border border-slate-100 dark:border-blue-800/60">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {isEn ? 'Cached System Bug Logs' : 'Nhật Ký Báo Lỗi Hệ Thống'}
                </span>
                <span className="font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded border border-rose-100 dark:border-rose-800">
                  {healthData.cacheStats?.bugsCount || 0} {isEn ? 'items' : 'mục'}
                </span>
              </div>

              {/* Storage Adapter */}
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-blue-900/40 border border-slate-100 dark:border-blue-800/60">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {isEn ? 'Storage Adapter Mode' : 'Chế Độ Bộ Nhớ Đệm Lịch Sử'}
                </span>
                <span className="font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/60 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-700">
                  {healthData.firebaseAdmin?.storageAdapter || 'In-Memory + Disk Cache'}
                </span>
              </div>

              {/* Last Cache Sync */}
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-blue-900/40 border border-slate-100 dark:border-blue-800/60">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {isEn ? 'Last Memory Sync' : 'Thời Gian Đồng Bộ Bộ Nhớ'}
                </span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {healthData.cacheStats?.lastUpdated
                    ? new Date(healthData.cacheStats.lastUpdated).toLocaleTimeString()
                    : 'N/A'}
                </span>
              </div>

              {/* Cache Health Status */}
              <div className="flex items-center justify-between p-2 rounded bg-slate-50 dark:bg-blue-900/40 border border-slate-100 dark:border-blue-800/60">
                <span className="text-slate-700 dark:text-slate-200 font-medium">
                  {isEn ? 'Cache Integrity & Health' : 'Trạng Thái Vẹn Toàn Cache'}
                </span>
                <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-bold text-[11px] gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isEn ? 'Optimal' : 'Đã tối ưu'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
