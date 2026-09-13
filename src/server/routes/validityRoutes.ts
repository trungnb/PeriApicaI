import { isTerminalExecutionError } from '../services/geminiService';
import { Router, Request, Response } from 'express';
import { analyzeLimiter } from '../config/limiter';
import { serverLog } from '../config/env';
import {
  getCanonicalToothByFdi,
  isValidFdi,
  isValidBase64Image,
  extractAndValidateImage,
  isValidReceptor,
  isValidTechnique,
} from '../middleware/validation';
import { validateImageWithGemini } from '../services/geminiValidityService';
import { requireUsableApiKeyMode } from '../middleware/apiKeyMode';
import { evaluateValidityDecision } from '../../utils/imageValidity';
import {
  createValidityConfirmationToken,
  createValidityReceipt,
  digestValidityImage,
  verifyValidityConfirmationToken,
  type ValidityReceiptBinding,
} from '../services/validityReceipt';
import { discoverAvailableVisionModels, getOrCreateAssessmentSnapshot } from '../services/modelManager';

const router = Router();

function bindingFromRequest(req: Request): ValidityReceiptBinding | null {
  const rawFdi = req.body.toothFdi || req.body.tooth?.fdiNumber || req.body.tooth;
  const toothFdi = typeof rawFdi === 'number' ? String(rawFdi) : String(rawFdi || '').trim();
  const assessmentId = typeof req.body.assessmentId === 'string' ? req.body.assessmentId.trim() : '';
  const imageDigest = digestValidityImage(req.body.imageBase64 || req.body.image);
  const technique = req.body.technique;
  const receptorType = req.body.receptorType;
  if (!isValidFdi(toothFdi) || !assessmentId || assessmentId.length > 160 || !imageDigest
    || !isValidTechnique(technique) || !isValidReceptor(receptorType)) {
    return null;
  }
  return { imageDigest, toothFdi, technique, receptorType, assessmentId };
}

/**
 * POST /api/validate-image
 * Lightweight pre-analysis image suitability and FDI verification gate.
 */
router.post('/api/validate-image', requireUsableApiKeyMode, analyzeLimiter, async (req: Request, res: Response) => {
  const deadlineAt = Date.now() + 35000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000); // 35s pre-flight deadline

  res.on('finish', () => {
    clearTimeout(timeout);
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  try {
    const binding = bindingFromRequest(req);
    if (!binding) {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid receipt binding fields',
        userMessage: 'Thiếu hoặc không hợp lệ thông tin phiên, kỹ thuật chụp hoặc bộ nhận ảnh.',
      });
    }
    const fdiString = binding.toothFdi;

    if (!isValidFdi(fdiString)) {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing canonical tooth FDI number',
        userMessage: 'Số răng FDI không hợp lệ.',
      });
    }

    const canonicalTooth = getCanonicalToothByFdi(fdiString);
    if (!canonicalTooth) {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: 'Unknown tooth for valid FDI number',
        userMessage: 'Không tìm thấy thông tin răng hợp lệ.',
      });
    }

    const rawImage = req.body.imageBase64 || req.body.image;
    if (!rawImage || typeof rawImage !== 'string') {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: 'Missing imageBase64 payload',
        userMessage: 'Thiếu dữ liệu hình ảnh.',
      });
    }

    const imageInfo = extractAndValidateImage(rawImage, req.body.mimeType);
    if (!imageInfo) {
      clearTimeout(timeout);
      return res.status(400).json({
        success: false,
        error: 'Corrupted or invalid Base64 image encoding or mismatched MIME type',
        userMessage: 'Dữ liệu ảnh bị hỏng hoặc không đúng định dạng.',
      });
    }

    const { cleanBase64, mimeType } = imageInfo;

    const { apiKeyOption, customApiKey } = res.locals.apiKeyMode;
    const effectiveCustomKey = apiKeyOption === 'custom' ? customApiKey : undefined;

    const rawLang = String(req.body.language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const language = isEn ? 'EN' : 'VI';

    // Per-assessment frozen snapshot resolution
    await discoverAvailableVisionModels(effectiveCustomKey);
    const preferredInput = req.body.preferredModel || req.body.selectedModelA;
    const snapshot = getOrCreateAssessmentSnapshot(
      binding.assessmentId,
      preferredInput ? { validity: preferredInput } : undefined,
      effectiveCustomKey
    );
    const validityRole = snapshot.roles.validity;
    const preferredModel = validityRole.primaryModel;

    const result = await validateImageWithGemini({
      cleanBase64,
      mimeType,
      tooth: canonicalTooth,
      language,
      customApiKey: effectiveCustomKey,
      preferredModel,
      signal: controller.signal,
      deadlineAt,
      modelLadder: validityRole.modelLadder,
      configRevision: validityRole.compatibilityConfigIdentity,
      credentialAffinity: validityRole.credentialPreference,
      assessmentId: binding.assessmentId,
    });

    const decision = evaluateValidityDecision(result.validity);
    const receiptFields = decision.state === 'valid'
      ? { validityReceipt: createValidityReceipt(binding, 'valid') }
      : decision.state === 'warning' && decision.issue === 'uncertain'
        ? { validityConfirmationToken: createValidityConfirmationToken(binding) }
        : {};

    clearTimeout(timeout);
    return res.json({
      success: true,
      validity: result.validity,
      usedModel: result.usedModel,
      matrixRevision: snapshot.matrixRevision,
      ladderRevision: snapshot.ladderRevision,
      resolverPlanType: snapshot.resolverPlanType,
      durationMs: result.durationMs,
      ...receiptFields,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (isTerminalExecutionError(err)) {
      if (!res.destroyed) res.status(err.code === 'EXECUTION_DEADLINE' ? 504 : 499).json({ success: false, isUnavailable: true, errorType: err.code || 'CANCELLED' });
      return;
    }
    serverLog('ERROR', 'ValidityGate', 'Error in /api/validate-image:', err?.message || err);

    const isCustomKeyFailed = Boolean(err.isCustomKeyFailed);
    const isQuotaExhausted = Boolean(err.isQuotaExhausted);
    const isMalformed = Boolean(err.isMalformed);
    const isTransient = Boolean(err.isTransient);

    const httpStatus = isQuotaExhausted ? 429 : (isCustomKeyFailed || isMalformed ? 400 : 503);
    return res.status(httpStatus).json({
      success: false,
      isUnavailable: true,
      errorType: isCustomKeyFailed
        ? 'CUSTOM_KEY_FAILED'
        : isQuotaExhausted
        ? 'QUOTA_EXHAUSTED'
        : isMalformed
        ? 'MALFORMED_OUTPUT'
        : isTransient
        ? 'TRANSIENT_FAILURE'
        : 'VALIDITY_SERVICE_UNAVAILABLE',
      error: 'Validity service error',
      userMessage: isCustomKeyFailed
        ? 'Khóa API cá nhân không thể xác thực kiểm tra ảnh.'
        : 'Không thể kết nối dịch vụ kiểm tra độ phù hợp của ảnh lúc này.',
    });
  }
});

/**
 * Exchanges an uncertain server decision for a proceeding receipt after the
 * user explicitly confirms it. No validity model call occurs here.
 */
router.post('/api/confirm-validity', (req: Request, res: Response) => {
  const binding = bindingFromRequest(req);
  if (!binding) {
    return res.status(400).json({ success: false, errorType: 'VALIDITY_RECEIPT_BINDING_INVALID' });
  }
  const action = req.body.action;
  if (action === 'user_confirmed') {
    const verified = verifyValidityConfirmationToken(req.body.validityConfirmationToken, binding);
    if (!verified.ok) {
      return res.status(400).json({ success: false, errorType: 'VALIDITY_CONFIRMATION_INVALID' });
    }
    return res.json({ success: true, validityReceipt: createValidityReceipt(binding, 'user_confirmed', { issue: 'uncertain' }) });
  }
  if (action === 'prototype_override' && process.env.ALLOW_VALIDITY_PROTOTYPE_OVERRIDE === 'true') {
    return res.json({ success: true, validityReceipt: createValidityReceipt(binding, 'prototype_override') });
  }
  return res.status(403).json({ success: false, errorType: 'VALIDITY_CONFIRMATION_NOT_PERMITTED' });
});

export default router;
