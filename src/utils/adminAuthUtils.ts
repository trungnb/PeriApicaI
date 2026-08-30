export const ADMIN_PERSISTENT_TOKEN_KEY = 'admin_persistent_token';
export const ADMIN_SESSION_TOKEN_KEY = 'admin_session_token';

let memoryAdminToken: string | null = null;

// Clean up any old localStorage token on load
if (typeof window !== 'undefined') {
  const oldToken = localStorage.getItem(ADMIN_PERSISTENT_TOKEN_KEY);
  if (oldToken) {
    sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, oldToken);
    localStorage.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
  }
}

export const getAdminToken = (): string | null => {
  if (memoryAdminToken) return memoryAdminToken;
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
  }
  return null;
};

export const isRemembered = (): boolean => {
  return false; // No longer support long-term remember
};

export const setAdminToken = (token: string, remember: boolean) => {
  memoryAdminToken = token;
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, token);
    localStorage.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
  }
};

export const clearAdminToken = () => {
  memoryAdminToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ADMIN_PERSISTENT_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
    try {
      sessionStorage.removeItem('admin_cached_logs');
      sessionStorage.removeItem('admin_cached_bugs');
      sessionStorage.removeItem('admin_cached_pathology_logs');
    } catch {}
  }
};
