import { useState } from 'react';
import { getAdminToken, setAdminToken, clearAdminToken } from '../../../utils/adminAuthUtils';
import { clearAdminSessionCache } from '../../../utils/adminSessionCache';

export const useAdminAuth = () => {
  // A stored token is only a candidate session until the portal has restored
  // it. This prevents Admin readers from running during the restoration render.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isVerifyingToken, setIsVerifyingToken] = useState<boolean>(() => Boolean(getAdminToken()));
  const [loginError, setLoginError] = useState<string | null>(null);

  const login = async (password: string, reviewerId: string, rememberMe: boolean): Promise<{ success: boolean; token?: string; error?: string }> => {
    try {
      setLoginError(null);
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, reviewerId }),
      });
      const data = await res.json();
      
      if (data.success && data.token) {
        setAdminToken(data.token, rememberMe);
        setIsAuthenticated(true);
        return { success: true, token: data.token };
      } else {
        const errorMsg = data.error || 'Mật khẩu quản trị không chính xác.';
        setLoginError(errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (err) {
      console.error('Login error:', err);
      const errorMsg = 'Lỗi kết nối. Vui lòng thử lại.';
      setLoginError(errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  const verifySession = async (): Promise<boolean> => {
    const token = getAdminToken();
    if (!token) {
      setIsAuthenticated(false);
      setIsVerifyingToken(false);
      return false;
    }

    setIsVerifyingToken(true);
    try {
      const res = await fetch('/api/admin/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 200) {
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          setIsAuthenticated(true);
          setIsVerifyingToken(false);
          return true;
        }
      }
      clearAdminToken();
      clearAdminSessionCache();
      setIsAuthenticated(false);
      setIsVerifyingToken(false);
      return false;
    } catch {
      clearAdminToken();
      clearAdminSessionCache();
      setIsAuthenticated(false);
      setIsVerifyingToken(false);
      return false;
    }
  };

  const logout = () => {
    const token = getAdminToken();
    if (token) {
      fetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }).catch(err => console.warn('Logout API error (ignored):', err));
    }
    
    clearAdminToken();
    clearAdminSessionCache();
    
    setIsAuthenticated(false);
    setIsVerifyingToken(false);
  };

  return {
    isAuthenticated,
    setIsAuthenticated,
    isVerifyingToken,
    setIsVerifyingToken,
    loginError,
    setLoginError,
    login,
    logout,
    verifySession,
  };
};
