import { getAdminToken } from "../utils/adminAuthUtils";
import { useAdminAuth } from './admin/hooks/useAdminAuth';
import { useAdminData } from './admin/hooks/useAdminData';
import { useAdminDelete } from './admin/hooks/useAdminDelete';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, BarChart2, Bug, LogOut, Flame, RefreshCw, Trash2, Loader2, Activity, Microscope } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useMetadataStore } from '../store/useMetadataStore';
import { AdminLogin } from './admin/AdminLogin';
import { DeleteDataModal } from './admin/DeleteDataModal';
import { DeleteConfirmModal } from './admin/modals/DeleteConfirmModal';
import { AdminModalSkeleton } from './SkeletonLoaders';

const lazyWithRetry = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) =>
  lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return await factory();
    }
  });

const ReportsTab = lazyWithRetry(() => import('./admin/ReportsTab').then(module => ({ default: module.ReportsTab })));
const BugsTab = lazyWithRetry(() => import('./admin/BugsTab').then(module => ({ default: module.BugsTab })));
const SystemHealthTab = lazyWithRetry(() => import('./admin/SystemHealthTab').then(module => ({ default: module.SystemHealthTab })));
const PathologyLogsPanel = lazyWithRetry(() => import('./admin/PathologyLogsPanel').then(module => ({ default: module.PathologyLogsPanel })));




export const AdminPortalModal: React.FC = () => {
  const isOpen = useAppStore(state => state.isAdminModalOpen);
  const setIsAdminModalOpen = useAppStore(state => state.setIsAdminModalOpen);
  const { t, i18n } = useTranslation('admin');

  const { isAuthenticated, setIsAuthenticated, isVerifyingToken, setIsVerifyingToken, login, logout, loginError } = useAdminAuth();

  const {
    isSyncing,
    bugsList, setBugsList,
    displayLogs, setDisplayLogs,
    pathologyLogs, setPathologyLogs,
    syncErrorMessage,
    dateRangeFilter, setDateRangeFilter,
    fetchAdminData, fetchMetadata,
    getAuthHeader,
    quotaLocked,
    resetInfoStr, isFirebaseStorage,
    systemMetrics, cooldownSeconds
  } = useAdminData(logout);


  const handleClose = () => {
    setIsAdminModalOpen(false);
  };
  
  const [activeTab, setActiveTab] = useState<'reports' | 'pathology' | 'bugs' | 'health'>('reports');

  const {
    deleteTargetItem, setDeleteTargetItem,
    toastNotification,
    handleDeleteDocumentSuccess,
    handleBatchDeleteSuccess
  } = useAdminDelete({
    setDisplayLogs,
    setBugsList,
    setPathologyLogs,
    fetchMetadata,
    getAuthHeader,
    dateRangeFilter,
    fetchAdminData
  });

  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  
  // Stale-While-Revalidate: Initialize instantly from client session cache if available
  
  
  
  
  const setSystemMetrics = useMetadataStore(state => state.setSystemMetrics);
  
  const isMetadataLoading = useMetadataStore(state => state.isLoading);
  
  

  const totalLogsCount = systemMetrics?.reports?.totalSessions ?? 0;
  const totalBugsCount = systemMetrics?.bugs?.totalBugs ?? 0;
  const totalPathologyCount = systemMetrics?.pathology?.totalPathologyLogs ?? 0;

  

  /** Returns the Authorization header object for authenticated admin API calls. */
  

  

  const handleDateRangeChange = useCallback((newFilter: { preset: 'all' | 'today' | '7days' | '30days' | 'custom'; startDate?: string; endDate?: string }) => {
    setDateRangeFilter(prev => {
      if (prev.preset === newFilter.preset && prev.startDate === newFilter.startDate && prev.endDate === newFilter.endDate) {
        return prev;
      }
      return newFilter;
    });
    fetchAdminData(false, newFilter, false);
  }, []);

  
  

  

    
  
  
  
  
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

    /**
   * Authenticates admin by POSTing credentials to the server.
   * Returns true on success (server issues a token), false on failure.
   */
  const handleLogin = async (password: string, rememberMe: boolean): Promise<boolean> => {
    const res = await login(password, rememberMe);
    if (res.success) {
      // Clear stale client caches to avoid flash of old data
      setBugsList([]);
      setDisplayLogs([]);
      setPathologyLogs([]);
      setSystemMetrics(null);
      // Automatically fetch fresh report data and metadata on login
      fetchAdminData(true, undefined, false);
      fetchMetadata(getAuthHeader, dateRangeFilter).catch(console.warn);
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    logout();
    setBugsList([]);
    setDisplayLogs([]);
    setPathologyLogs([]);
    setSystemMetrics(null);
  };

  /**
   * Handles local state update and re-syncs system_metadata when a document is deleted.
   */
  

  /**
   * Handles local state updates after a batch deletion and re-syncs system_metadata.
   */
  

  const handleLoadMore = useCallback((collection: 'reports' | 'pathology' | 'bugs', currentLength: number) => {
    fetchAdminData(false, undefined, false, 100, currentLength, true);
  }, [fetchAdminData]);

  useEffect(() => {
    if (!isOpen) return;

    // Lock body scroll while Admin Portal is active
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleteModalOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const token = getAdminToken();
    if (token) {
      setIsAuthenticated(true);
      setIsVerifyingToken(false);
      fetchAdminData(false, undefined, false);
      // Automatically fetch fresh metadata stats from Firestore on mount
      fetchMetadata(getAuthHeader, dateRangeFilter).catch(console.warn);
    } else {
      setIsAuthenticated(false);
      setIsVerifyingToken(false);
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDeleteModalOpen, dateRangeFilter, getAuthHeader, fetchMetadata]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          {/* Animated Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => {
              if (!isDeleteModalOpen) {
                handleClose();
              }
            }}
          />

          {/* Animated Modal Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{
              duration: 0.24,
              ease: [0.16, 1, 0.3, 1]
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-portal-modal-title"
            className={`relative bg-white dark:bg-slate-900 rounded-2xl ${isAuthenticated ? 'max-w-7xl h-[92vh] max-h-[92vh]' : 'max-w-md'} w-full border border-slate-200/90 dark:border-slate-800 shadow-2xl overflow-hidden my-auto flex flex-col z-10 transition-[max-width,height] duration-200`}
            onClick={(e) => e.stopPropagation()}
          >
            {!isOnline && (
              <div className="bg-amber-500 text-slate-950 px-4 py-2.5 text-xs font-bold flex items-center justify-center space-x-2 shrink-0">
                <span>{t('admin:offlineWarn')}</span>
              </div>
            )}
        <div className="bg-slate-900 dark:bg-slate-950 text-white p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 border-b border-slate-800 dark:border-slate-800/90 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-600/20 rounded-xl border border-blue-500/30 text-blue-400 shadow-xs shrink-0">
              <ShieldCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id="admin-portal-modal-title" className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
                <span className="truncate">{t('admin:adminPortal_title')}</span>
                {isAuthenticated && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold px-2 py-0.5 rounded-full uppercase shrink-0">
                    {t('admin:loggedInBadge')}
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 mt-0.5">
                <span>{isAuthenticated ? t('admin:clinicalReportsSub') : (i18n.language === 'en' ? 'System Management' : 'Quản trị hệ thống')}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all sm:ml-1 cursor-pointer"
              aria-label={t('admin:close') || 'Đóng'}
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {!isAuthenticated ? (
          <AdminLogin onLogin={handleLogin} externalError={loginError} />
        ) : (displayLogs.length === 0 && !systemMetrics && (isVerifyingToken || isMetadataLoading || isSyncing)) ? (
          <AdminModalSkeleton />
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
            
            {/* 1. CRITICAL METADATA STATISTICS (ALWAYS VISIBLE AT THE TOP) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 p-4 sm:p-5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800/80 shrink-0">
              {/* Card 1: Diagnostic Sessions */}
              <div className="relative bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/50 shadow-2xs space-y-1 overflow-hidden transition-all hover:border-blue-400 dark:hover:border-blue-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
                    {i18n.language === 'en' ? 'Diagnostic Sessions' : 'Phiên chẩn đoán'}
                  </span>
                  <div className="p-1.5 bg-blue-500/10 text-blue-500 dark:text-blue-400 rounded-lg">
                    <BarChart2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                    {totalLogsCount}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-semibold">
                    {systemMetrics?.reports?.completedCount ?? 0} {i18n.language === 'en' ? 'Done' : 'Xong'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-800">•</span>
                  <span>
                    {systemMetrics?.reports?.incompleteCount ?? 0} {i18n.language === 'en' ? 'Draft' : 'Nháp'}
                  </span>
                </div>
              </div>

              {/* Card 2: Pathology Anomalies */}
              <div className="relative bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/50 shadow-2xs space-y-1 overflow-hidden transition-all hover:border-teal-400 dark:hover:border-teal-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
                    {i18n.language === 'en' ? 'Detected Anomalies' : 'Bất thường phát hiện'}
                  </span>
                  <div className="p-1.5 bg-teal-500/10 text-teal-500 dark:text-teal-400 rounded-lg">
                    <Microscope className="w-4 h-4" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                    {totalPathologyCount}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <span className="flex items-center text-teal-600 dark:text-teal-400 font-semibold">
                    {systemMetrics?.pathology?.verifiedCount ?? 0} {i18n.language === 'en' ? 'Verified' : 'Khớp'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-800">•</span>
                  <span>
                    {systemMetrics?.pathology?.unverifiedCount ?? 0} {i18n.language === 'en' ? 'Pending' : 'Mới'}
                  </span>
                </div>
              </div>

              {/* Card 3: System Bugs */}
              <div className="relative bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/50 shadow-2xs space-y-1 overflow-hidden transition-all hover:border-rose-400 dark:hover:border-rose-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
                    {i18n.language === 'en' ? 'System Bugs' : 'Báo cáo sự cố'}
                  </span>
                  <div className="p-1.5 bg-rose-500/10 text-rose-500 dark:text-rose-400 rounded-lg">
                    <Bug className="w-4 h-4" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                    {totalBugsCount}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <span className="flex items-center text-rose-600 dark:text-rose-400 font-semibold">
                    {(systemMetrics?.bugs?.severityDistribution?.critical ?? 0) + (systemMetrics?.bugs?.severityDistribution?.high ?? 0)} {i18n.language === 'en' ? 'Critical' : 'Nặng'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-800">•</span>
                  <span>
                    {(systemMetrics?.bugs?.severityDistribution?.medium ?? 0) + (systemMetrics?.bugs?.severityDistribution?.low ?? 0)} {i18n.language === 'en' ? 'Minor' : 'Nhẹ'}
                  </span>
                </div>
              </div>

              {/* Card 4: Active Devices */}
              <div className="relative bg-slate-50 dark:bg-slate-950/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/50 shadow-2xs space-y-1 overflow-hidden transition-all hover:border-violet-400 dark:hover:border-violet-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
                    {i18n.language === 'en' ? 'Active Devices' : 'Thiết bị hoạt động'}
                  </span>
                  <div className="p-1.5 bg-violet-500/10 text-violet-500 dark:text-violet-400 rounded-lg">
                    <Activity className="w-4 h-4" />
                  </div>
                </div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                    {systemMetrics?.reports?.uniqueUsersCount ?? 0}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-semibold">
                    {systemMetrics?.reports?.todayUsersCount ?? 0} {i18n.language === 'en' ? 'Active Today' : 'Hôm nay'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-800">•</span>
                  <span>
                    {i18n.language === 'en' ? 'Total' : 'Tổng số'}
                  </span>
                </div>
              </div>
            </div>

            {quotaLocked && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-700/60 px-6 py-3 flex items-center space-x-3 text-amber-900 dark:text-amber-200 text-xs shrink-0">
                <span className="text-base">⚠️</span>
                <div>
                  <strong className="font-semibold">{t('admin:quotaWarningTitle')}</strong> 
                  {' '}{t('admin:quotaWarningDesc', { resetTime: resetInfoStr || '14:00' })}
                </div>
              </div>
            )}

            {syncErrorMessage && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-700/60 px-6 py-3 flex items-center space-x-3 text-amber-900 dark:text-amber-200 text-xs shrink-0">
                <span className="text-base">⏳</span>
                <div>
                  <strong className="font-semibold">{i18n.language === 'en' ? 'Notification:' : 'Thông báo:'}</strong> 
                  {' '}{syncErrorMessage}
                </div>
              </div>
            )}

            {/* 2. SPLIT LAYOUT (SIDEBAR CONTROLS vs MAIN LIVE WORKSPACE) */}
            <div className="grid grid-cols-1 lg:grid-cols-4 flex-1 min-h-0 overflow-hidden">
              
              {/* LEFT SIDEBAR: MANAGEMENT CONTROLS */}
              <div className="lg:col-span-1 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 flex flex-col justify-between overflow-y-auto shrink-0 space-y-6">
                
                {/* 2A: Tabs Navigation */}
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase block">
                    {i18n.language === 'en' ? 'Navigation' : 'Chức năng quản lý'}
                  </span>
                  <nav className="flex flex-col space-y-1.5">
                    {/* Diagnostic Logs tab */}
                    <button
                      onClick={() => setActiveTab('reports')}
                      className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
                        activeTab === 'reports'
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-900/60 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <BarChart2 className={`w-4 h-4 shrink-0 ${activeTab === 'reports' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                        <span className="truncate">{t('admin:tabReports')}</span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        activeTab === 'reports'
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {totalLogsCount}
                      </span>
                    </button>

                    {/* Pathology Anomalies tab */}
                    <button
                      onClick={() => setActiveTab('pathology')}
                      className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
                        activeTab === 'pathology'
                          ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-950 dark:text-teal-100 border-teal-200 dark:border-teal-900/60 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Microscope className={`w-4 h-4 shrink-0 ${activeTab === 'pathology' ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`} />
                        <span className="truncate">{i18n.language === 'en' ? 'Anomalies' : 'Bất thường'}</span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        activeTab === 'pathology'
                          ? 'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {totalPathologyCount}
                      </span>
                    </button>

                    {/* Issues Tracker tab */}
                    <button
                      onClick={() => setActiveTab('bugs')}
                      className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
                        activeTab === 'bugs'
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 border-rose-200 dark:border-rose-900/60 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <Bug className={`w-4 h-4 shrink-0 ${activeTab === 'bugs' ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'}`} />
                        <span className="truncate">{t('admin:tabBugs')}</span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        activeTab === 'bugs'
                          ? 'bg-rose-100 dark:bg-rose-900 text-rose-800 dark:text-rose-200'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {totalBugsCount}
                      </span>
                    </button>

                    {/* Server Health tab */}
                    <button
                      onClick={() => setActiveTab('health')}
                      className={`flex items-center justify-start w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer whitespace-nowrap ${
                        activeTab === 'health'
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-100 border-indigo-200 dark:border-indigo-900/60 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <Activity className={`w-4 h-4 shrink-0 mr-2.5 ${activeTab === 'health' ? 'text-indigo-500 animate-pulse' : 'text-slate-400'}`} />
                      <span className="truncate">{i18n.language === 'en' ? 'System Health' : 'Sức khỏe Server'}</span>
                    </button>
                  </nav>
                </div>

                {/* 2B: Global Filters Overview */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase block">
                    {i18n.language === 'en' ? 'Query Filter Range' : 'Phạm vi dữ liệu'}
                  </span>
                  <div className="text-xs space-y-1 text-slate-700 dark:text-slate-300 font-medium">
                    <p className="flex justify-between">
                      <span className="text-slate-400">{i18n.language === 'en' ? 'Preset:' : 'Chu kỳ:'}</span>
                      <span className="font-bold text-slate-900 dark:text-white uppercase font-mono text-[11px]">
                        {dateRangeFilter.preset}
                      </span>
                    </p>
                    {dateRangeFilter.startDate && (
                      <p className="flex justify-between">
                        <span className="text-slate-400">{i18n.language === 'en' ? 'From:' : 'Từ:'}</span>
                        <span className="font-mono text-slate-600 dark:text-slate-400">
                          {dateRangeFilter.startDate}
                        </span>
                      </p>
                    )}
                    {dateRangeFilter.endDate && (
                      <p className="flex justify-between">
                        <span className="text-slate-400">{i18n.language === 'en' ? 'To:' : 'Đến:'}</span>
                        <span className="font-mono text-slate-600 dark:text-slate-400">
                          {dateRangeFilter.endDate}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {/* 2C: Administrative Actions Panel */}
                <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/60">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase block">
                    {i18n.language === 'en' ? 'Storage Status' : 'Bộ lưu trữ'}
                  </span>
                  
                  {/* Storage indicator */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/40">
                    <div className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
                      <Flame className={`w-4 h-4 ${isFirebaseStorage && !quotaLocked ? 'text-orange-400 fill-amber-400 drop-shadow-[0_0_4px_rgba(249,115,22,0.6)] animate-pulse' : 'text-slate-400 opacity-60'}`} />
                      <span>{isFirebaseStorage && !quotaLocked ? 'Cloud Firestore' : t('admin:transientStorage')}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => fetchAdminData(true, undefined, true)}
                    disabled={isSyncing || cooldownSeconds > 0}
                    className={`flex items-center justify-center space-x-2 w-full px-3 py-2 rounded-xl text-xs font-bold transition-all border text-white cursor-pointer ${
                      cooldownSeconds > 0
                        ? 'bg-slate-850 border-slate-750 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900 border-slate-800/60'
                    }`}
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>
                      {isSyncing
                        ? t('admin:syncingBtn')
                        : cooldownSeconds > 0
                        ? `${t('admin:syncBtn')} (${cooldownSeconds}s)`
                        : t('admin:syncBtn')}
                    </span>
                  </button>

                  <button
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="flex items-center justify-center space-x-2 w-full px-3 py-2 rounded-xl text-xs font-bold transition-all border border-rose-500/10 hover:border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{t('admin:adminPortal_deleteBtn')}</span>
                  </button>

                  <button
                    onClick={handleLogout}
                    className="flex items-center justify-center space-x-2 w-full px-3 py-2 rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>{t('admin:logoutBtn')}</span>
                  </button>
                </div>
              </div>

              {/* RIGHT WORKSPACE: LIVE ACTIVE TAB CONTROLS & LOG DETAILS */}
              <div className="lg:col-span-3 flex flex-col min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
                {activeTab === 'reports' && (
                  <Suspense fallback={<div className="flex items-center justify-center p-12 flex-1"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>}>
                    <ReportsTab
                      displayLogs={displayLogs}
                      systemMetrics={systemMetrics}
                      getAuthHeader={getAuthHeader}
                      totalLogsCount={totalLogsCount}
                      onRequestDelete={(target) => setDeleteTargetItem(target)}
                      onDateRangeChange={handleDateRangeChange}
                      onLoadMore={handleLoadMore}
                    />
                  </Suspense>
                )}
                
                {activeTab === 'pathology' && (
                  <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50 dark:bg-blue-950/10 min-h-0">
                    <Suspense fallback={<div className="flex items-center justify-center p-12 flex-1"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>}>
                      <PathologyLogsPanel
                        pathologyLogs={pathologyLogs}
                        systemMetrics={systemMetrics}
                        onUnauthorized={handleLogout}
                        getAuthHeader={getAuthHeader}
                        totalPathologyCount={totalPathologyCount}
                        onRequestDelete={(target) => setDeleteTargetItem(target)}
                        onDateRangeChange={handleDateRangeChange}
                        onLoadMore={handleLoadMore}
                      />
                    </Suspense>
                  </div>
                )}

                {activeTab === 'bugs' && (
                  <Suspense fallback={<div className="flex items-center justify-center p-12 flex-1"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>}>
                    <BugsTab
                      bugsList={bugsList}
                      systemMetrics={systemMetrics}
                      totalBugsCount={totalBugsCount}
                      onRequestDelete={(target) => setDeleteTargetItem(target)}
                      onDateRangeChange={handleDateRangeChange}
                      onLoadMore={handleLoadMore}
                    />
                  </Suspense>
                )}

                {activeTab === 'health' && (
                  <Suspense fallback={<div className="flex items-center justify-center p-12 flex-1"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>}>
                    <SystemHealthTab
                      getAuthHeader={getAuthHeader}
                    />
                  </Suspense>
                )}
              </div>
            </div>
          </div>
        )}

        <DeleteDataModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onSuccess={handleBatchDeleteSuccess}
          getAuthHeader={getAuthHeader}
        />

        <DeleteConfirmModal
          target={deleteTargetItem}
          isOpen={Boolean(deleteTargetItem)}
          onClose={() => setDeleteTargetItem(null)}
          onSuccess={handleDeleteDocumentSuccess}
          getAuthHeader={getAuthHeader}
        />

        {toastNotification && (
          <div className="fixed bottom-6 right-6 z-[110] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs font-bold flex items-center space-x-2 animate-bounce">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>{toastNotification.message}</span>
          </div>
        )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default AdminPortalModal;
