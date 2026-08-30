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
import { ExecutionBudget } from '../services/geminiService';

import { generalActionLimiter } from '../config/limiter';
const router = Router();

// ─── POST /api/segment-pathology ──────────────────────────────
// Gemini 2D Spatial Polygon Grounding for 8 anatomical & pathological structures
router.post('/api/segment-pathology', validatePathologySegment, analyzeLimiter, async (req: Request, res: Response) => {
  const prepStart = Date.now();
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => {
    controller.abort();
  }, 60000); // 60s deadline requirement

  req.on('close', () => {
    clearTimeout(deadlineTimer);
    controller.abort();
  });

  try {
    const { imageBase64, mimeType, toothFdi, language, customApiKey, selectedModel, analysisMode, selectedModelB } = req.body;

    if (!imageBase64 || !toothFdi) {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Missing imageBase64 or toothFdi' });
    }

    const rawLang = String(language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const outputLanguage = isEn ? 'EN' : 'VI';

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
      clearTimeout(deadlineTimer);
      const cached = pathologyVerifyCache.get(cacheKey);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ success: true, result: cached, isCached: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
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

    const prepEnd = Date.now();
    const preparationTimeMs = prepEnd - prepStart;
    const budget = new ExecutionBudget(analysisMode === 'consensus' ? 4 : 3, controller.signal);
    const apiStart = Date.now();

    const segResult = await segmentPathologyWithGemini(
      cleanBase64,
      cleanMime,
      toothFdi,
      outputLanguage,
      selectedModel?.trim() || undefined,
      customApiKey?.trim() || undefined,
      updateStatus,
      analysisMode,
      selectedModelB?.trim() || undefined,
      budget
    );

    const apiDurationMs = Date.now() - apiStart;
    clearTimeout(deadlineTimer);

    if (segResult.success && segResult.result) {
      serverLog('INFO', 'Telemetry', 'Pathology Segmentation Completed', {
        preparationTimeMs,
        apiDurationMs,
        totalTimeMs: preparationTimeMs + apiDurationMs,
        mode: analysisMode || 'single',
      });

      pathologyVerifyCache.set(cacheKey, segResult.result);
      res.write(`data: ${JSON.stringify({ success: true, result: segResult.result, usedModel: segResult.usedModel, telemetry: { preparationTimeMs, apiDurationMs } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    let errorType = 'ALL_EXHAUSTED';
    let isQuotaExhausted = false;
    let isCustomKeyFailed = Boolean(segResult.isCustomKeyFailed);
    let userMessage = '';

    if (isCustomKeyFailed) {
      errorType = 'CUSTOM_KEY_FAILED';
      isQuotaExhausted = Boolean(segResult.isQuotaExhausted);
      userMessage = isEn
        ? 'Your custom API key has exceeded its quota limit or is invalid.'
        : 'API Key cá nhân của bạn không hợp lệ hoặc đã vượt quá hạn mức sử dụng.';
    } else if (segResult.isQuotaExhausted || segResult.isAllExhausted) {
      errorType = 'ALL_EXHAUSTED';
      isQuotaExhausted = true;
      userMessage = isEn
        ? 'The system trial quota is currently exhausted. Please try again later or enter your own Gemini API Key (BYOK).'
        : 'Hạn mức thử nghiệm của hệ thống hiện tại đã hết hoặc đang quá tải.\nVui lòng quay lại sau ít phút hoặc nhập API Key cá nhân (BYOK) để tiếp tục!';
    } else if (segResult.isTransient) {
      errorType = 'TRANSIENT';
      isQuotaExhausted = false;
      userMessage = isEn
        ? 'The AI segmentation service timed out or is temporarily busy. Please try again.'
        : 'Dịch vụ phân đoạn AI tạm thời bị gián đoạn hoặc quá thời gian phản hồi (Timeout). Vui lòng thử lại.';
    } else {
      errorType = 'TRANSIENT';
      isQuotaExhausted = false;
      userMessage = isEn
        ? 'An error occurred during AI segmentation. Please try again.'
        : 'Có lỗi xảy ra trong quá trình phân đoạn AI. Vui lòng thử lại.';
    }

    serverLog('INFO', 'PathologyAPI', `Segmentation result unavailable (${errorType})`, { errorType, isQuotaExhausted, isTransient: segResult.isTransient });
    res.write(`data: ${JSON.stringify({
      success: false,
      errorType,
      isCustomKeyFailed,
      isAllExhausted: errorType === 'ALL_EXHAUSTED',
      isQuotaExhausted,
      userMessage,
      error: segResult.error ?? 'Segmentation failed'
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (err: any) {
    clearTimeout(deadlineTimer);
    serverLog('ERROR', 'PathologyAPI', 'Internal error during segmentation', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Internal server error', errorType: 'TRANSIENT', isQuotaExhausted: false });
    }
    res.write(`data: ${JSON.stringify({ success: false, error: 'Internal server error', errorType: 'TRANSIENT', isQuotaExhausted: false })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
});

// ─── POST /api/save-pathology ──────────────────────────────
// Save completed pathology assessment to Firestore seg_reports
router.post('/api/save-pathology', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || !payload.tooth || typeof payload.assessmentId !== 'string' || payload.assessmentId.length > 100) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    
    // Do not allow arbitrary large payloads in objects other than image Base64
    if (JSON.stringify(payload).length > 3 * 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
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
