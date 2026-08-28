export const ADMIN_PERSISTENT_TOKEN_KEY = 'admin_persistent_token';

let memoryAdminToken: string | null = null;

export const getAdminToken = (): string | null => {
  return memoryAdminToken || localStorage.getItem(ADMIN_PERSISTENT_TOKEN_KEY);
};

export const isRemembered = (): boolean => {
  return Boolean(localStorage.getItem(ADMIN_PERSISTENT_TOKEN_KEY));
};

export const setAdminToken = (token: string, remember: boolean) => {
  if (remember) {
    localStorage.setItem(ADMIN_PERSISTENT_TOKEN_KEY, token);
    memoryAdminToken = token;
  } else {
    localStorage.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
    memoryAdminToken = token;
  }
  sessionStorage.removeItem('admin_session_token');
};

export const clearAdminToken = () => {
  memoryAdminToken = null;
  localStorage.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
  sessionStorage.removeItem('admin_session_token');
  try {
    sessionStorage.removeItem('admin_cached_logs');
    sessionStorage.removeItem('admin_cached_bugs');
    sessionStorage.removeItem('admin_cached_pathology_logs');
  } catch {}
};
