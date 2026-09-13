import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import all JSON translations
import uploadVI from './locales/vi/upload.json';
import configVI from './locales/vi/config.json';
import welcomeVI from './locales/vi/welcome.json';
import commonVI from './locales/vi/common.json';
import remediationVI from './locales/vi/remediation.json';
import analysisVI from './locales/vi/analysis.json';
import adminVI from './locales/vi/admin.json';
import pathologyVI from './locales/vi/pathology.json';

import uploadEN from './locales/en/upload.json';
import configEN from './locales/en/config.json';
import welcomeEN from './locales/en/welcome.json';
import commonEN from './locales/en/common.json';
import remediationEN from './locales/en/remediation.json';
import analysisEN from './locales/en/analysis.json';
import adminEN from './locales/en/admin.json';
import pathologyEN from './locales/en/pathology.json';

// Initialize language from localStorage or auto-detect based on browser settings
export const getInitialLanguage = (): 'vi' | 'en' => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('periapical_language');
      if (saved) {
        const upper = saved.toUpperCase();
        if (upper === 'EN') return 'en';
        if (upper === 'VI') return 'vi';
      }
    } catch {
      // Ignore localStorage access errors (e.g., in private mode or restricted iframes)
    }

    // Auto-detect browser preferred language(s) in priority order
    try {
      const langs: readonly string[] =
        typeof navigator !== 'undefined' && navigator.languages && navigator.languages.length
          ? navigator.languages
          : typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage)
            ? [navigator.language || (navigator as any).userLanguage]
            : [];

      for (const rawLang of langs) {
        if (typeof rawLang === 'string') {
          const lower = rawLang.toLowerCase();
          if (lower.startsWith('vi')) return 'vi';
          if (lower.startsWith('en')) return 'en';
        }
      }
    } catch {
      // Fallback safely if navigator inspection fails
    }
  }
  return 'vi';
};

i18next
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        upload: uploadEN,
        config: configEN,
        welcome: welcomeEN,
        common: commonEN,
        remediation: remediationEN,
        analysis: analysisEN,
        admin: adminEN,
        pathology: pathologyEN,
      },
      vi: {
        upload: uploadVI,
        config: configVI,
        welcome: welcomeVI,
        common: commonVI,
        remediation: remediationVI,
        analysis: analysisVI,
        admin: adminVI,
        pathology: pathologyVI,
      }
    },
    lng: getInitialLanguage(),
    fallbackLng: 'vi',
    defaultNS: 'common',
    ns: ['common', 'welcome', 'config', 'upload', 'analysis', 'remediation', 'admin', 'pathology'],
    interpolation: {
      escapeValue: false // React already escapes values
    }
  });

export default i18next;
