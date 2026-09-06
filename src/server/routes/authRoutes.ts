import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { adminAuthLimiter } from '../config/limiter';
import { serverLog } from '../config/env';

const router = Router();

export interface AdminSession { expiresAt: number; reviewerId: string; }
// In-memory sessions bind the password-authenticated, allowlisted reviewer identity to the token.
export const adminSessions = new Map<string, AdminSession>();

// Clean up expired sessions periodically to prevent memory leaks
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (now > session.expiresAt) {
      adminSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Check every hour
cleanupInterval.unref?.();

export function generateAdminToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function getAdminSession(token: string): AdminSession | null {
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return null;
  }
  return session;
}

export function isValidAdminToken(token: string): boolean {
  return getAdminSession(token) !== null;
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const session = token ? getAdminSession(token) : null;
  if (session) {
    res.locals.adminReviewerId = session.reviewerId;
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

function configuredReviewerIds(): Set<string> {
  return new Set((process.env.PILOT_REVIEWER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean));
}

const handleAdminLogin = (req: Request, res: Response) => {
  const { password, reviewerId } = req.body;
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

  const normalizedReviewerId = typeof reviewerId === 'string' ? reviewerId.trim() : '';
  const reviewers = configuredReviewerIds();
  if (!normalizedReviewerId || !reviewers.has(normalizedReviewerId)) {
    return res.status(400).json({ success: false, error: 'A configured person-level reviewer ID is required.' });
  }

  serverLog('INFO', 'SECURITY', `Successful admin login from IP: ${clientIp}`);
  const token = generateAdminToken();
  adminSessions.set(token, { expiresAt: Date.now() + 2 * 60 * 60 * 1000, reviewerId: normalizedReviewerId });
  return res.json({ success: true, token, reviewerId: normalizedReviewerId });
};

// Admin login endpoints (supports both /api/admin/auth and /api/admin/login)
router.post('/api/admin/auth', adminAuthLimiter, handleAdminLogin);
router.post('/api/admin/login', adminAuthLimiter, handleAdminLogin);

// Admin session verification endpoint (validates candidate stored tokens before data queries)
router.get('/api/admin/session', adminAuth, (_req: Request, res: Response) => {
  return res.json({ success: true, reviewerId: res.locals.adminReviewerId });
});

// Admin logout
router.post('/api/admin/logout', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) adminSessions.delete(token);
  return res.json({ success: true });
});

export default router;
