import { Router } from 'express';
import { getServiceAccountCredentials } from '../services/firebaseService';
import { getStorageAdapter, getOrInitServerCache } from '../services/storageAdapter';
import { isValidAdminToken } from './authRoutes';

const router = Router();

router.get('/api/health', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());
    
    // Check auth for sensitive info via Bearer token or x-admin-token
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const headerToken = req.headers['x-admin-token'] as string;
    const token = bearerToken || headerToken;
    const isAdmin = Boolean(token && isValidAdminToken(token));

    if (!isAdmin) {
      return res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds,
        uptimeHuman: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
      });
    }

    const serviceAccount = getServiceAccountCredentials();
    const zknjghtKey = process.env.zknjght_key ? process.env.zknjght_key.trim() : '';
    const geminiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
    const adminPassword = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '';
    const delPassword = process.env.DEL_PASSWORD ? process.env.DEL_PASSWORD.trim() : '';

    const cache = getOrInitServerCache();
    const storageAdapter = getStorageAdapter();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      uptimeHuman: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsageMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
      },
      firebaseAdmin: serviceAccount ? {
        status: 'configured',
        projectId: serviceAccount.project_id || 'unknown',
        clientEmail: serviceAccount.client_email ? serviceAccount.client_email.substring(0, 10) + '***@***' : undefined,
        storageAdapter: storageAdapter.type,
      } : {
        status: 'not_configured',
        notice: 'Sử dụng bộ nhớ đệm In-Memory. Cấu hình biến FIREBASE_SERVICE_ACCOUNT để kích hoạt Cloud Firestore.',
        storageAdapter: storageAdapter.type,
      },
      services: {
        hasZknjghtKey: Boolean(zknjghtKey),
        hasGeminiKey: Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY'),
        hasFirebaseServiceAccount: Boolean(serviceAccount),
        hasAdminPasswordConfigured: Boolean(adminPassword),
        hasDeletePasswordConfigured: Boolean(delPassword),
      },
      cacheStats: {
        reportsCount: cache.reports.length,
        bugsCount: cache.bugs.length,
        lastUpdated: cache.lastUpdated,
      },
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err?.message || 'Lỗi kiểm tra healthcheck' });
  }
});

export default router;
