import React, { useState } from 'react';
import { Key, Check, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { validateCustomApiKey } from '../services/apiService';

export const ByokConfigSection: React.FC = React.memo(() => {
  const { t, i18n } = useTranslation('upload');
  const appEngineMode = useAppStore(state => state.appEngineMode);
  const isPathology = appEngineMode === 'pathology_segmentation';

  const apiKeyOption = useAppStore(state => state.apiKeyOption);
  const customApiKey = useAppStore(state => state.customApiKey);
  const rememberCustomApiKey = useAppStore(state => state.rememberCustomApiKey);
  const setApiKeyOption = useAppStore(state => state.setApiKeyOption);
  const setCustomApiKey = useAppStore(state => state.setCustomApiKey);
  const setRememberCustomApiKey = useAppStore(state => state.setRememberCustomApiKey);

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  const handleTestKey = React.useCallback(async () => {
    if (!customApiKey.trim()) {
      setValidationResult({
        valid: false,
        message: i18n.language === 'en' ? 'Please enter an API Key to test.' : 'Vui lòng nhập API Key để kiểm tra.',
      });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    const res = await validateCustomApiKey(customApiKey.trim());
    setIsValidating(false);
    setValidationResult({
      valid: res.valid,
      message: res.valid
        ? t('byokValidKey')
        : `${t('byokInvalidKey')} (${res.message})`,
    });
  }, [customApiKey, i18n.language, t]);

  return (
    <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-3">
      {/* Header */}
      <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-slate-700/80 pb-2">
        <Key className={`w-4 h-4 shrink-0 ${isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'}`} />
        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
          {t('byokTitle')}
        </h4>
      </div>

      {/* Info Notice Banner */}
      <div className={`border rounded-xl p-3 text-xs ${
        isPathology
          ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-200/80 dark:border-teal-700/60 text-teal-950 dark:text-teal-100'
          : 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-200/80 dark:border-blue-700/60 text-blue-950 dark:text-blue-100'
      }`}>
        <p className={`leading-relaxed text-[11px] ${
          isPathology ? 'text-teal-900/90 dark:text-teal-200/90' : 'text-blue-900/90 dark:text-blue-200/90'
        }`}>
          {t('byokNotice')}
        </p>
      </div>

      {/* Options Selection */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {/* Option 1: System Free Key */}
        <div
          onClick={() => {
            setApiKeyOption('system');
            setValidationResult(null);
          }}
          className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start space-x-2.5 ${
            apiKeyOption === 'system'
              ? isPathology
                ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 font-medium shadow-xs'
                : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 font-medium shadow-xs'
              : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            <div
              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                apiKeyOption === 'system'
                  ? isPathology
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              {apiKeyOption === 'system' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </div>
          <div className="space-y-0.5 flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
              {t('byokSystemOption')}
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
              {t('byokSystemSub')}
            </p>
          </div>
        </div>

        {/* Option 2: Personal Key (BYOK) */}
        <div
          onClick={() => setApiKeyOption('custom')}
          className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-start space-x-2.5 ${
            apiKeyOption === 'custom'
              ? isPathology
                ? 'bg-teal-50/90 dark:bg-teal-950/50 border-teal-600 dark:border-teal-400 text-teal-950 dark:text-teal-100 ring-1 ring-teal-600 dark:ring-teal-400 font-medium shadow-xs'
                : 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-600 dark:border-blue-400 text-blue-950 dark:text-blue-100 ring-1 ring-blue-600 dark:ring-blue-400 font-medium shadow-xs'
              : 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            <div
              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                apiKeyOption === 'custom'
                  ? isPathology
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              {apiKeyOption === 'custom' && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </div>
          <div className="space-y-0.5 flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
              {t('byokCustomOption')}
            </p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
              {t('byokCustomSub')}
            </p>
          </div>
        </div>
      </div>

      {/* Custom Key Input Area (Expanded when custom selected) */}
      {apiKeyOption === 'custom' && (
        <div id="byok-input-container" className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="space-y-1.5">
            <label htmlFor="byok-custom-api-key-input" className="block text-xs font-bold text-slate-800 dark:text-slate-200">
              {t('byokCustomInputLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="byok-custom-api-key-input"
                type="password"
                value={customApiKey}
                onChange={(e) => {
                  setCustomApiKey(e.target.value);
                  setValidationResult(null);
                }}
                placeholder={t('byokCustomInputPlaceholder')}
                className={`flex-1 bg-slate-50 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all outline-none ${
                  isPathology
                    ? 'focus:border-teal-500 focus:ring-1 focus:ring-teal-500'
                    : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                }`}
              />
              <button
                type="button"
                onClick={handleTestKey}
                disabled={isValidating || !customApiKey.trim()}
                className={`px-3.5 py-2 text-white rounded-xl text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 flex items-center space-x-1 cursor-pointer active:scale-95 ${
                  isPathology
                    ? 'bg-teal-600 dark:bg-teal-600 hover:bg-teal-700 dark:hover:bg-teal-500'
                    : 'bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500'
                }`}
              >
                {isValidating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('byokValidatingBtn')}</span>
                  </>
                ) : (
                  <span>{t('byokValidateBtn')}</span>
                )}
              </button>
            </div>
          </div>

          {/* Validation Feedback */}
          {validationResult && (
            <div
              className={`p-2.5 rounded-xl border text-xs font-medium flex items-center space-x-2 ${
                validationResult.valid
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700/60'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 border-rose-200 dark:border-rose-700/60'
              }`}
            >
              {validationResult.valid ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{validationResult.message}</span>
            </div>
          )}

          {/* Get Key Link */}
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-0.5">
            <span>{t('byokCustomKeyHelp')}</span>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className={`font-semibold hover:underline inline-flex items-center gap-1 ${
                isPathology ? 'text-teal-600 dark:text-teal-400' : 'text-blue-600 dark:text-sky-400'
              }`}
            >
              <span>{t('byokGetFreeKeyLink')}</span>
            </a>
          </div>

          {/* Remember Key Checkbox & Notice */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-1.5">
            <label className="flex items-start space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberCustomApiKey}
                onChange={(e) => setRememberCustomApiKey(e.target.checked)}
                className={`mt-0.5 w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-700 cursor-pointer ${
                  isPathology
                    ? 'text-teal-600 focus:ring-teal-500 accent-teal-600'
                    : 'text-blue-600 focus:ring-blue-500 accent-blue-600'
                }`}
              />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t('byokRememberKeyLabel')}
              </span>
            </label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pl-5">
              {t('byokRememberKeyNotice')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
