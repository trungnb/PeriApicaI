import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { adminAuthLimiter } from '../config/limiter';
import { serverLog } from '../config/env';

const router = Router();

// In-memory admin session storage: Map<sessionToken, expireTimestamp>
export const adminSessions = new Map<string, number>();

// Clean up expired sessions periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [token, expire] of adminSessions.entries()) {
    if (now > expire) {
      adminSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Check every hour

export function generateAdminToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isValidAdminToken(token: string): boolean {
  if (!token) return false;
  const expire = adminSessions.get(token);
  if (!expire) return false;
  if (Date.now() > expire) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token && isValidAdminToken(token)) {
    return next();
  }

  serverLog('WARN', 'SECURITY', `Unauthorized admin access attempt to ${req.method} ${req.path} from IP: ${req.ip}`);
  return res.status(401).json({ success: false, error: 'Phiên đăng nhập Admin không hợp lệ hoặc đã hết hạn.' });
}

function getEnvAdminPassword(): string {
  let expected = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '';
  if ((expected.startsWith("'") && expected.endsWith("'")) || (expected.startsWith('"') && expected.endsWith('"'))) {
    expected = expected.slice(1, -1).trim();
  }
  return expected;
}

const handleAdminLogin = (req: Request, res: Response) => {
  const { password } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  const expectedPassword = getEnvAdminPassword();

  if (!expectedPassword) {
    serverLog('ERROR', 'SECURITY', 'ADMIN_PASSWORD environment variable is not set in environment.');
    return res.status(500).json({
      success: false,
      error: 'Chưa cấu hình biến môi trường ADMIN_PASSWORD trong hệ thống. Vui lòng liên hệ quản trị viên.',
    });
  }

  const inputPassword = typeof password === 'string' ? password.trim() : '';

  const isPasswordMatch = () => {
    if (!inputPassword || !expectedPassword) return false;
    // Hash both to the same length (SHA-256) to eliminate length timing attacks
    const inputHash = crypto.createHash('sha256').update(inputPassword).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedPassword).digest();
    return crypto.timingSafeEqual(inputHash, expectedHash);
  };

  if (!isPasswordMatch()) {
    serverLog('WARN', 'SECURITY', `Failed admin login attempt from IP: ${clientIp}`);
    return res.status(401).json({ success: false, error: 'Mật khẩu Admin không chính xác.' });
  }

  serverLog('INFO', 'SECURITY', `Successful admin login from IP: ${clientIp}`);
  const token = generateAdminToken();
  adminSessions.set(token, Date.now() + 2 * 60 * 60 * 1000); // 2 hours valid
  return res.json({ success: true, token });
};

// Admin login endpoints (supports both /api/admin/auth and /api/admin/login)
router.post('/api/admin/auth', adminAuthLimiter, handleAdminLogin);
router.post('/api/admin/login', adminAuthLimiter, handleAdminLogin);

// Admin logout
router.post('/api/admin/logout', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) adminSessions.delete(token);
  return res.json({ success: true });
});

export default router;
