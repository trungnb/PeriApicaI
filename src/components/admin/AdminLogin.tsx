import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Lock, Loader2, AlertCircle } from 'lucide-react';

interface AdminLoginProps {
  onLogin: (password: string, rememberMe: boolean) => Promise<boolean>;
  externalError?: string | null;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLogin, externalError }) => {
  const { t, i18n } = useTranslation('admin');
  const isEn = i18n.language === 'en';

  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const prefetchAdminTabs = () => {
    import('./ReportsTab').catch(() => {});
    import('./BugsTab').catch(() => {});
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isLoading) return;
    setIsLoading(true);
    await onLogin(password, rememberMe);
    setIsLoading(false);
    setPassword('');
  };

  return (
    <div className="p-6 sm:p-8 flex flex-col items-center justify-center space-y-6 text-center w-full max-w-sm mx-auto">
      {/* Crisp, high-contrast Icon container */}
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-800/80 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-xs">
        <Lock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
      </div>

      <div className="space-y-1">
        <h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
          {t('admin:adminLogin_title')}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {isEn
            ? 'Enter administrative credentials to access clinical logs'
            : 'Cổng truy cập quản trị hệ thống & nhật ký lâm sàng'}
        </p>
      </div>

      <form onSubmit={handleLogin} className="w-full space-y-4 text-left">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
            {t('admin:passwordLabel')}
          </label>
          <input
            type="password"
            value={password}
            onFocus={prefetchAdminTabs}
            onChange={(e) => {
              setPassword(e.target.value);
              prefetchAdminTabs();
            }}
            placeholder={t('admin:adminLogin_passwordPlaceholder')}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all shadow-2xs font-mono"
            autoFocus
            disabled={isLoading}
          />
        </div>

        <div className="flex items-center space-x-2 pt-0.5">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded border-slate-300 dark:border-slate-700 focus:ring-blue-500 cursor-pointer accent-blue-600"
            disabled={isLoading}
          />
          <label htmlFor="rememberMe" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            {t('admin:rememberMe')}
          </label>
        </div>

        {externalError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center space-x-2 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{externalError}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!password.trim() || isLoading}
          className="w-full h-10 sm:h-11 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:scale-100 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs sm:text-sm shadow-md shadow-blue-600/20 transition-all flex items-center justify-center space-x-2 cursor-pointer"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{t('admin:authenticating')}</span>
            </>
          ) : (
            <span>{t('admin:submit')}</span>
          )}
        </button>
      </form>
    </div>
  );
};

