import { Router, Request, Response } from 'express';
import { generalActionLimiter } from '../config/limiter';
import { getStorageAdapter } from '../services/storageAdapter';
import { adminAuth } from './authRoutes';
import { sanitizeCredentialString, redactObjectSecrets } from '../../utils/apiKeySecurity';

const router = Router();

// Endpoint: Bug report submitting
router.post('/api/report-bug', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const rawData = req.body;
    if (!rawData || typeof rawData !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid bug report payload' });
    }

    // Sanitize and whitelist payload to prevent Prototype Pollution or schema poisoning, and redact any credentials
    const cleanDescription = typeof rawData.description === 'string'
      ? sanitizeCredentialString(rawData.description.substring(0, 5000))
      : 'Không có mô tả';

    let cleanErrorDetails: Record<string, any> | null = null;
    if (rawData.errorDetails && typeof rawData.errorDetails === 'object') {
      try {
        const serialized = JSON.stringify(rawData.errorDetails);
        if (serialized.length > 64 * 1024) {
          return res.status(400).json({ success: false, error: 'errorDetails exceeds maximum allowed size (64KB)' });
        }
        cleanErrorDetails = redactObjectSecrets(rawData.errorDetails);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid errorDetails object' });
      }
    }

    const bugData = {
      description: cleanDescription,
      path: typeof rawData.path === 'string' ? rawData.path.substring(0, 500) : 'N/A',
      source: typeof rawData.source === 'string' ? rawData.source.substring(0, 200) : 'USER_SUBMITTED',
      severity: typeof rawData.severity === 'string' ? rawData.severity.substring(0, 50) : 'ERROR',
      timestamp: typeof rawData.timestamp === 'string' ? rawData.timestamp : new Date().toISOString(),
      errorDetails: cleanErrorDetails,
    };

    const storageAdapter = getStorageAdapter();
    const result = await storageAdapter.saveBug(bugData);
    return res.json(result);
  } catch (err: any) {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to report bug' });
    }
  }
});

// Endpoint: Retrieve bug logs (admin-protected)
router.get('/api/bugs', adminAuth, async (req: Request, res: Response) => {
  try {
    const rawLimit = parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(Math.max(1, rawLimit), 500) : undefined;
    const storageAdapter = getStorageAdapter();
    const bugs = await storageAdapter.getBugs(limit);
    return res.json({
      success: true,
      source: storageAdapter.type,
      count: bugs.length,
      bugs,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Failed to fetch bugs' });
  }
});

export default router;
