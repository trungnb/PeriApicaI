import { isTerminalExecutionError } from '../services/geminiService';
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
  saveAdminPathologyReview,
  getPathologyLogs,
} from '../services/firestorePathologyService';
import { adminAuth } from './authRoutes';
import { serverLog } from '../config/env';
import { validatePathologySegment, extractAndValidateImage } from '../middleware/validation';
import { requireUsableApiKeyMode } from '../middleware/apiKeyMode';
import { requireValidityReceipt } from '../middleware/validityReceipt';
import { ExecutionBudget, getApiKeySources } from '../services/geminiService';
import { discoverAvailableVisionModels, getOrCreateAssessmentSnapshot } from '../services/modelManager';
import { digestValidityImage } from '../services/validityReceipt';

import { generalActionLimiter } from '../config/limiter';
import { bindCancellationLifecycle } from '../utils/lifecycle';
import {
  parsePublicPathologySaveDto,
  PublicPersistenceValidationError,
} from '../middleware/publicPersistenceDto';
const router = Router();

// ─── POST /api/segment-pathology ──────────────────────────────
// Gemini 2D Spatial Polygon Grounding for 8 anatomical & pathological structures
router.post('/api/segment-pathology', requireUsableApiKeyMode, validatePathologySegment, requireValidityReceipt, analyzeLimiter, async (req: Request, res: Response) => {
  const prepStart = Date.now();
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => {
    controller.abort();
  }, 60000); // 60s deadline requirement

  bindCancellationLifecycle(res, controller, deadlineTimer);

  try {
    const { imageBase64, mimeType: declaredMime, toothFdi, language, selectedModel, analysisMode, selectedModelB } = req.body;
    const { apiKeyOption, customApiKey } = res.locals.apiKeyMode;
    const effectiveCustomKey = apiKeyOption === 'custom' ? customApiKey : undefined;

    await discoverAvailableVisionModels(effectiveCustomKey);

    const assessmentId = req.body.assessmentId || res.locals.validityReceipt?.assessmentId;
    const snapshot = getOrCreateAssessmentSnapshot(
      assessmentId,
      (selectedModel || selectedModelB)
        ? {
            pathology_branch_a: selectedModel,
            pathology_branch_b: selectedModelB,
          }
        : undefined,
      effectiveCustomKey
    );

    const roleA = snapshot.roles.pathology_branch_a;
    const roleB = snapshot.roles.pathology_branch_b;
    const effectiveModelA = roleA.primaryModel;
    const effectiveModelB = roleB.primaryModel;

    if (!imageBase64 || !toothFdi) {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Missing imageBase64 or toothFdi' });
    }

    const imageInfo = extractAndValidateImage(imageBase64, declaredMime);
    if (!imageInfo) {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Corrupted or invalid Base64 image encoding or mismatched MIME type' });
    }

    const { cleanBase64, mimeType: cleanMime } = imageInfo;

    const rawLang = String(language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const outputLanguage = isEn ? 'EN' : 'VI';

    const cacheKey = crypto
      .createHash('sha256')
      .update(String(assessmentId || ''))
      .update(String(snapshot.ladderRevision || ''))
      .update(cleanBase64)
      .update(String(toothFdi || ''))
      .update(String(outputLanguage || ''))
      .update(String(effectiveModelA || 'gemini-flash-latest'))
      .update(String(analysisMode || 'single'))
      .update(String(effectiveModelB || 'gemini-flash-lite-latest'))
      .update(apiKeyOption === 'custom' ? `custom_${customApiKey}` : 'system')
      .digest('hex');

    if (pathologyVerifyCache.has(cacheKey)) {
      clearTimeout(deadlineTimer);
      const cached = pathologyVerifyCache.get(cacheKey);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ success: true, result: { ...cached, validityAudit: res.locals.validityAudit }, isCached: true })}\n\n`);
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
    // Execution Budget: max 4 calls for Single Mode (allows ladder fallback across keys), 4 calls for Dual Consensus Mode
    const budget = new ExecutionBudget(
      4, 
      controller.signal,
      analysisMode === 'consensus' ? 2 : 4,
      prepStart + 60000
    );
    const apiStart = Date.now();

    const imageDigest = res.locals.validityReceipt?.imageDigest || digestValidityImage(cleanBase64) || undefined;

    const segResult = await segmentPathologyWithGemini(
      cleanBase64,
      cleanMime,
      toothFdi,
      outputLanguage,
      effectiveModelA?.trim() || undefined,
      apiKeyOption === 'custom' ? customApiKey : undefined,
      updateStatus,
      analysisMode,
      effectiveModelB?.trim() || undefined,
      budget,
      {
        assessmentId,
        imageDigest,
        roleA,
        roleB,
      }
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
      res.write(`data: ${JSON.stringify({
        success: true,
        result: {
          ...segResult.result,
          matrixRevision: snapshot.matrixRevision,
          ladderRevision: snapshot.ladderRevision,
      resolverPlanType: snapshot.resolverPlanType,
          validityAudit: res.locals.validityAudit,
        },
        usedModel: segResult.usedModel,
        matrixRevision: snapshot.matrixRevision,
        ladderRevision: snapshot.ladderRevision,
      resolverPlanType: snapshot.resolverPlanType,
        telemetry: { preparationTimeMs, apiDurationMs },
      })}\n\n`);
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
      systemApiAvailable: getApiKeySources().length > 0,
      userMessage,
      error: 'Segmentation failed'
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (err: any) {
    clearTimeout(deadlineTimer);
    if (isTerminalExecutionError(err)) {
      if (!res.destroyed && !res.writableEnded) {
        const errorMsg = err.code === 'EXECUTION_DEADLINE' ? 'Request timed out' : (err.code === 'ATTEMPT_BUDGET_EXHAUSTED' ? 'AI attempt budget exhausted.' : 'Request cancelled');
        const payload = {
          success: false,
          errorType: err.code || 'CANCELLED',
          error: errorMsg,
        };
        if (res.headersSent) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
        else res.status(err.code === 'EXECUTION_DEADLINE' ? 504 : 499).json(payload);
      }
      return;
    }
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
    // Do not allow arbitrary large payloads in objects other than image Base64
    if (JSON.stringify(req.body).length > 3 * 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const { record, imageDataUrl } = parsePublicPathologySaveDto(req.body);
    const result = await savePathologyLog(record, imageDataUrl);
    return res.json(result);
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    if (err instanceof PublicPersistenceValidationError) {
      return res.status(400).json({ success: false, error: err.message });
    }
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

    const reviewedAt = new Date().toISOString();
    const result = await saveAdminPathologyReview({
      assessmentId,
      finalFindings: Array.isArray(verifiedPathologies) ? verifiedPathologies : [],
      notes: verifiedNotes || '',
      reviewedAt,
      reviewerId: res.locals.adminReviewerId,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    serverLog('ERROR', 'PathologyAPI', 'Failed to verify pathology log', err);
    return res.status(500).json({ success: false, error: 'Failed to verify pathology log' });
  }
});

// The legacy deletion path is disabled for pilot. Use the DEL_PASSWORD-protected Admin flow.
router.post('/api/pathology-logs/delete', adminAuth, (_req: Request, res: Response) => {
  return res.status(410).json({ success: false, error: 'LEGACY_DELETE_DISABLED' });
});

export default router;
