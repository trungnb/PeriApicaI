/**
 * Pathology Routes — POST /api/segment-pathology | POST /api/save-pathology | GET /api/pathology-logs
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { analyzeLimiter } from '../config/limiter';
import {
  segmentPathologyWithGemini,
  pathologyVerifyCache,
} from '../services/geminiPathologyService';
import {
  savePathologyLog,
  getPathologyLogs,
  deletePathologyLogs,
} from '../services/firestorePathologyService';
import { adminAuth } from './authRoutes';
import { serverLog } from '../config/env';
import { validatePathologySegment } from '../middleware/validation';

const router = Router();

// ─── POST /api/segment-pathology ──────────────────────────────
// Gemini 2D Spatial Polygon Grounding for 8 anatomical & pathological structures
router.post('/api/segment-pathology', validatePathologySegment, analyzeLimiter, async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, toothFdi, language, customApiKey, selectedModel, analysisMode, selectedModelB } = req.body;

    if (!imageBase64 || !toothFdi) {
      return res.status(400).json({ error: 'Missing imageBase64 or toothFdi' });
    }

    const outputLanguage = language || 'Tiếng Việt';

    let cleanBase64 = imageBase64;
    let cleanMime = mimeType || 'image/jpeg';
    if (typeof imageBase64 === 'string' && imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) { cleanMime = match[1]; cleanBase64 = match[2]; }
    }

    const cacheKey = crypto
      .createHash('sha256')
      .update(cleanBase64)
      .update(String(toothFdi || ''))
      .update(String(outputLanguage || ''))
      .update(String(selectedModel || 'gemini-flash-latest'))
      .update(String(analysisMode || 'single'))
      .update(String(selectedModelB || 'gemini-flash-lite-latest'))
      .update(customApiKey ? `custom_${customApiKey.trim()}` : 'system')
      .digest('hex');

    if (pathologyVerifyCache.has(cacheKey)) {
      return res.json({ success: true, result: pathologyVerifyCache.get(cacheKey), isCached: true });
    }

    // Set Server-Sent Events (SSE) headers for real-time status streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const updateStatus = (message: string) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ statusMessage: message })}\n\n`);
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      }
    };

    const segResult = await segmentPathologyWithGemini(
      cleanBase64,
      cleanMime,
      toothFdi,
      outputLanguage,
      selectedModel?.trim() || undefined,
      customApiKey?.trim() || undefined,
      updateStatus,
      analysisMode,
      selectedModelB?.trim() || undefined
    );

    if (segResult.success && segResult.result) {
      pathologyVerifyCache.set(cacheKey, segResult.result);
      res.write(`data: ${JSON.stringify({ success: true, result: segResult.result, usedModel: segResult.usedModel })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    serverLog('INFO', 'PathologyAPI', 'Segmentation result unavailable (Quota Exhausted)', { errorType: segResult.isCustomKeyFailed ? 'CUSTOM_KEY_FAILED' : 'ALL_EXHAUSTED' });
    res.write(`data: ${JSON.stringify({
      success: false,
      errorType: segResult.isCustomKeyFailed ? 'CUSTOM_KEY_FAILED' : 'ALL_EXHAUSTED',
      isCustomKeyFailed: segResult.isCustomKeyFailed,
      isAllExhausted: segResult.isAllExhausted,
      userMessage: segResult.isCustomKeyFailed
        ? (outputLanguage === 'EN' ? 'Your custom API key has exceeded its quota limit or is invalid.' : 'API Key cá nhân của bạn không hợp lệ hoặc đã vượt quá hạn mức sử dụng.')
        : (outputLanguage === 'EN' ? 'All system API keys and models exhausted.' : 'Tất cả các khóa API và mô hình AI hệ thống đều đã chạm ngưỡng hạn mức (Quota). Vui lòng thử lại sau.'),
      error: segResult.error ?? 'Segmentation failed'
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (err: any) {
    serverLog('ERROR', 'PathologyAPI', 'Internal error during segmentation', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    res.write(`data: ${JSON.stringify({ success: false, error: 'Internal server error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
});

// ─── POST /api/save-pathology ──────────────────────────────
// Save completed pathology assessment to Firestore seg_reports
router.post('/api/save-pathology', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || !payload.tooth) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const result = await savePathologyLog(payload, payload.imageDataUrl);
    return res.json(result);
  } catch (err: any) {
    serverLog('ERROR', 'PathologyAPI', 'Failed to save pathology log', err);
    return res.status(500).json({ success: false, error: 'Failed to save pathology data' });
  }
});

// ─── GET /api/pathology-logs ──────────────────────────────
// Fetch pathology_logs (Admin only)
router.get('/api/pathology-logs', adminAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const logs = await getPathologyLogs(limit);
    return res.json({ success: true, logs });
  } catch (err: any) {
    serverLog('ERROR', 'PathologyAPI', 'Failed to fetch pathology logs', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch pathology logs' });
  }
});

// ─── POST /api/verify-pathology ─────────────────────────────
// Admin verification & Ground Truth confirmation for pathology logs
router.post('/api/verify-pathology', adminAuth, async (req: Request, res: Response) => {
  try {
    const { assessmentId, verifiedPathologies, verifiedNotes } = req.body;
    if (!assessmentId) {
      return res.status(400).json({ success: false, error: 'Thiếu assessmentId' });
    }

    const payloadToUpdate = {
      assessmentId,
      finalConfirmedPathologies: Array.isArray(verifiedPathologies) ? verifiedPathologies : [],
      verifiedNotes: verifiedNotes || '',
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'Admin',
      isReviewedByAdmin: true,
    };

    const result = await savePathologyLog(payloadToUpdate);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    serverLog('ERROR', 'PathologyAPI', 'Failed to verify pathology log', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to verify pathology log' });
  }
});

// ─── POST /api/pathology-logs/delete ──────────────────────
// Delete pathology_logs by range (Admin only)
router.post('/api/pathology-logs/delete', adminAuth, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body;
    const result = await deletePathologyLogs({ startDate, endDate });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

export default router;
