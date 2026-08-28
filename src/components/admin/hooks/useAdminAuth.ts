import { useState } from 'react';
import { getAdminToken, setAdminToken, clearAdminToken } from '../../../utils/adminAuthUtils';

export const useAdminAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!getAdminToken();
  });
  const [isVerifyingToken, setIsVerifyingToken] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const login = async (password: string, rememberMe: boolean): Promise<{ success: boolean; token?: string; error?: string }> => {
    try {
      setLoginError(null);
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
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
    
    try {
      sessionStorage.removeItem('admin_cached_logs');
      sessionStorage.removeItem('admin_cached_bugs');
      sessionStorage.removeItem('admin_cached_pathology_logs');
    } catch {}
    
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
    logout
  };
};
