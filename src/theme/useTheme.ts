import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';

export type ThemeMode = 'dark' | 'light';

export function useTheme() {
  const theme = useAppStore((state) => state.theme);
  const setThemeState = useAppStore((state) => state.setTheme);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
  }, [setThemeState]);

  const toggleTheme = useCallback(() => {
    setThemeState(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setThemeState]);

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
}
