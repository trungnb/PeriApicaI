import { providerExecutionConfig, isTerminalExecutionError } from '../services/geminiService';
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { analyzeLimiter, generalActionLimiter, validateKeyLimiter } from '../config/limiter';
import { serverLog, verifySignedImageUrl } from '../config/env';
import { resolveUploadFilePath } from '../config/storagePaths';
import { getStorageAdapter } from '../services/storageAdapter';
import { bindCancellationLifecycle } from '../utils/lifecycle';
import {
  analysisCache,
  getApiKeySources,
  createAiClient,
  executeWithFailover,
  ExecutionBudget,
  DENTAL_ANALYSIS_SCHEMA,
  buildSystemInstruction,
  synthesizeConsensusResults,
  mapOptimizedResultToLegacy,
  isRateLimitOrQuotaError,
  isTransientError,
  isInvalidApiKeyError,
} from '../services/geminiService';
import { discoverAvailableVisionModels, getOrCreateAssessmentSnapshot } from '../services/modelManager';
import { adminAuth } from './authRoutes';
import { validateRadiographAnalysis, getCanonicalToothByFdi, isValidTechnique, isValidReceptor, extractAndValidateImage } from '../middleware/validation';
import { requireUsableApiKeyMode } from '../middleware/apiKeyMode';
import { requireValidityReceipt } from '../middleware/validityReceipt';
import { validateClassicOutput } from '../../utils/semanticValidation';
import {
  parsePublicTechnicalSaveDto,
  PublicPersistenceValidationError,
} from '../middleware/publicPersistenceDto';
import { createInferenceLineage, computeTechnicalResultDigest } from '../services/inferenceLineage';
import { digestValidityImage } from '../services/validityReceipt';

const router = Router();

// Lightweight capability endpoint for checking application credential availability safely
router.get('/api/system-capabilities', generalActionLimiter, (_req: Request, res: Response) => {
  return res.json({
    success: true,
    systemApiAvailable: getApiKeySources().length > 0,
  });
});

// Dynamic Endpoint: Get available models for dropdown selection (System or BYOK)
router.post('/api/available-models', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const customApiKey = req.body.customApiKey ? String(req.body.customApiKey).trim() : undefined;
    const models = await discoverAvailableVisionModels(customApiKey);
    const systemApiAvailable = getApiKeySources().length > 0;
    return res.json({ success: true, models, systemApiAvailable });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AvailableModels', 'Error fetching available models:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch models' });
  }
});

// Primary Endpoint: Radiograph Analysis via Gemini Vision API
router.post('/api/analyze-radiograph', requireUsableApiKeyMode, validateRadiographAnalysis, requireValidityReceipt, analyzeLimiter, async (req: Request, res: Response) => {
  const prepStart = Date.now();
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => {
    controller.abort();
  }, 60000); // 60s deadline requirement

  bindCancellationLifecycle(res, controller, deadlineTimer);

  try {
    const rawTooth = typeof req.body.tooth === 'string' ? JSON.parse(req.body.tooth) : req.body.tooth;
    const fdiNumber = rawTooth?.fdiNumber !== undefined ? rawTooth.fdiNumber : (typeof rawTooth === 'string' ? rawTooth : undefined);
    const canonicalTooth = getCanonicalToothByFdi(fdiNumber) || res.locals.canonicalTooth || (rawTooth?.fdiNumber && req.body.tooth?.nameVi ? req.body.tooth : null);
    const technique = req.body.technique;
    const receptorType = req.body.receptorType !== undefined ? req.body.receptorType : req.body.receptor;
    const rawLang = String(req.body.language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const outputLanguage = isEn ? 'EN' : 'VI';
    const analysisMode = req.body.analysisMode === 'consensus' ? 'consensus' : 'single';

    let customApiKey = req.body.customApiKey ? String(req.body.customApiKey).trim() : '';
    if ((customApiKey.startsWith("'") && customApiKey.endsWith("'")) || (customApiKey.startsWith('"') && customApiKey.endsWith('"'))) {
      customApiKey = customApiKey.slice(1, -1).trim();
    }
    const apiKeyOption = req.body.apiKeyOption || (customApiKey ? 'custom' : 'system');
    const effectiveCustomKey = apiKeyOption === 'custom' ? customApiKey : undefined;

    await discoverAvailableVisionModels(effectiveCustomKey);

    const assessmentId = req.body.assessmentId || res.locals.validityReceipt?.assessmentId;
    const preferredA = req.body.selectedModelA || req.body.selectedModel;
    const preferredB = req.body.selectedModelB;
    const snapshot = getOrCreateAssessmentSnapshot(
      assessmentId,
      (preferredA || preferredB)
        ? {
            technical_branch_a: preferredA,
            technical_branch_b: preferredB,
          }
        : undefined,
      effectiveCustomKey
    );

    const roleA = snapshot.roles.technical_branch_a;
    const roleB = snapshot.roles.technical_branch_b;
    const selectedModelA = roleA.primaryModel;
    const selectedModelB = roleB.primaryModel;

    if (!canonicalTooth || !isValidTechnique(technique) || !isValidReceptor(receptorType)) {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Missing or invalid parameters: tooth, technique, receptorType' });
    }

    const tooth = canonicalTooth;

    const rawImage = req.body.imageBase64;
    if (!rawImage || typeof rawImage !== 'string') {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Missing image data (imageBase64 required in JSON body)' });
    }

    const imageInfo = extractAndValidateImage(rawImage, req.body.mimeType);
    if (!imageInfo) {
      clearTimeout(deadlineTimer);
      return res.status(400).json({ error: 'Corrupted or invalid Base64 image encoding or mismatched MIME type' });
    }

    const { cleanBase64, mimeType } = imageInfo;

    const cacheKey = crypto
      .createHash('sha256')
      .update(String(assessmentId || ''))
      .update(String(snapshot.ladderRevision || ''))
      .update(cleanBase64)
      .update(String(tooth?.fdiNumber || ''))
      .update(String(technique || ''))
      .update(String(receptorType || ''))
      .update(String(outputLanguage || ''))
      .update(String(analysisMode || ''))
      .update(String(selectedModelA || ''))
      .update(String(selectedModelB || ''))
      .update(apiKeyOption === 'custom' ? `custom_${customApiKey}` : 'system')
      .digest('hex');

    if (analysisCache.has(cacheKey)) {
      clearTimeout(deadlineTimer);
      const cached = analysisCache.get(cacheKey);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ text: JSON.stringify({ ...cached, validityAudit: res.locals.validityAudit }), isCached: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const systemInstruction = buildSystemInstruction(tooth, technique, receptorType, outputLanguage);
    const promptText = `Analyze radiograph for FDI ${tooth.fdiNumber}.`;

    const imagePart = {
      inlineData: {
        mimeType,
        data: cleanBase64,
      },
    };

    let isUsingCustomKey = false;
    let apiKeySources: { key: string; isBackup: boolean; isCustom?: boolean }[] = [];

    if (apiKeyOption === 'custom' && customApiKey) {
      isUsingCustomKey = true;
      apiKeySources = [{ key: customApiKey, isBackup: false, isCustom: true }];
    } else {
      apiKeySources = getApiKeySources();
    }

    if (apiKeySources.length === 0) {
      clearTimeout(deadlineTimer);
      if (isUsingCustomKey) {
        return res.status(400).json({ error: 'Vui lòng nhập API Key cá nhân hợp lệ.' });
      }
      const storageAdapter = getStorageAdapter();
      const nowStr = new Date().toISOString();
      await storageAdapter.saveBug({
        timestamp: nowStr,
        description: '[Tự động Log] Chưa cấu hình API Key trên máy chủ',
        path: '/api/analyze-radiograph (Missing Key)',
        source: 'SYSTEM_AUTO',
        severity: 'CRITICAL',
        errorDetails: {
          endpoint: '/api/analyze-radiograph',
          errorMessage: 'Chưa cấu hình API Key trên máy chủ. Vui lòng cấu hình biến môi trường GEMINI_API_KEY hoặc zknjght_key.',
          statusCode: 500,
        },
      });
      return res.status(500).json({ error: 'Chưa cấu hình API Key trên máy chủ. Vui lòng cấu hình biến môi trường.' });
    }

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

    if (analysisMode === 'consensus') {
      updateStatus(isEn ? '👥 Initializing Dual-Model Consensus...' : '👥 Đang khởi tạo Hội chẩn Song song...');

      const [resA, resB] = await Promise.allSettled([
        executeWithFailover(
          async (aiClient, modelName) => {
            updateStatus(isEn ? `🔬 Querying AI Model 1 (${modelName})...` : `🔬 Đang phân tích Mô hình AI 1 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                ...providerExecutionConfig(budget),
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: DENTAL_ANALYSIS_SCHEMA,
              },
            });
            budget.checkSignal();
            if (!response.text) throw new Error('Empty response from AI Model 1');
            return validateClassicOutput(JSON.parse(response.text));
          },
          selectedModelA,
          isUsingCustomKey ? customApiKey : undefined,
          updateStatus,
          budget,
          'branchA',
          roleA.credentialPreference,
          {
            role: 'technical_branch_a',
            modelLadder: roleA.modelLadder,
            configRevision: roleA.compatibilityConfigIdentity,
            credentialAffinity: roleA.credentialPreference,
            assessmentId,
          }
        ),
        executeWithFailover(
          async (aiClient, modelName) => {
            updateStatus(isEn ? `🔬 Querying AI Model 2 (${modelName})...` : `🔬 Đang phân tích Mô hình AI 2 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                ...providerExecutionConfig(budget),
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: DENTAL_ANALYSIS_SCHEMA,
              },
            });
            budget.checkSignal();
            if (!response.text) throw new Error('Empty response from AI Model 2');
            return validateClassicOutput(JSON.parse(response.text));
          },
          selectedModelB,
          isUsingCustomKey ? customApiKey : undefined,
          updateStatus,
          budget,
          'branchB',
          roleB.credentialPreference,
          {
            role: 'technical_branch_b',
            modelLadder: roleB.modelLadder,
            configRevision: roleB.compatibilityConfigIdentity,
            credentialAffinity: roleB.credentialPreference,
            assessmentId,
          }
        ),
      ]);

      budget.checkSignal();
      const rawResultA = resA.status === 'fulfilled' ? resA.value.result : null;
      const rawResultB = resB.status === 'fulfilled' ? resB.value.result : null;

      const resultA = rawResultA ? mapOptimizedResultToLegacy(rawResultA, outputLanguage) : null;
      const resultB = rawResultB ? mapOptimizedResultToLegacy(rawResultB, outputLanguage) : null;

      if (!resultA && !resultB) {
        const errA: any = resA.status === 'rejected' ? resA.reason : null;
        const errB: any = resB.status === 'rejected' ? resB.reason : null;
        if (isTerminalExecutionError(errA)) throw errA;
        if (isTerminalExecutionError(errB)) throw errB;
        const rejectionErr: any = new Error(errA?.message || errB?.message || 'Dual models failed');
        rejectionErr.isCustomKeyFailed = Boolean(errA?.isCustomKeyFailed || errB?.isCustomKeyFailed);
        rejectionErr.isQuotaExhausted = Boolean(errA?.isQuotaExhausted || errB?.isQuotaExhausted);
        rejectionErr.isTransient = Boolean(errA?.isTransient || errB?.isTransient);
        rejectionErr.originalError = errA || errB;
        throw rejectionErr;
      }

      const modelAUsed = resA.status === 'fulfilled' ? resA.value.usedModel : selectedModelA;
      const modelBUsed = resB.status === 'fulfilled' ? resB.value.usedModel : selectedModelB;
      const diversityStatus = (resA.status === 'fulfilled' && resB.status === 'fulfilled' && modelAUsed === modelBUsed)
        ? 'DEGRADED_DIVERSITY'
        : 'DIVERSE';

      updateStatus(isEn ? '✅ Synthesizing clinical consensus findings...' : '✅ Đang tổng hợp kết quả hội chẩn lâm sàng...');
      const finalResult = (resultA && resultB)
        ? synthesizeConsensusResults(
            resultA,
            resultB,
            outputLanguage,
            modelAUsed,
            modelBUsed
          )
        : (resultA || resultB);
      const imageDigest = res.locals.validityReceipt?.imageDigest || digestValidityImage(cleanBase64) || undefined;
      const resultDigest = computeTechnicalResultDigest(finalResult.findings, finalResult.overallQuality);
      const inferenceLineage = createInferenceLineage({
        modality: 'technical',
        executionMode: 'dual',
        assessmentId,
        sourceImageDigest: imageDigest,
        resultDigest,
        branches: [
          ...(resultA && resA.status === 'fulfilled' ? [{
            branch: 'model_a' as const,
            requestedModel: selectedModelA,
            actualModel: resA.value.usedModel,
            usedKeyType: resA.value.usedKeyType,
          }] : []),
          ...(resultB && resB.status === 'fulfilled' ? [{
            branch: 'model_b' as const,
            requestedModel: selectedModelB,
            actualModel: resB.value.usedModel,
            usedKeyType: resB.value.usedKeyType,
          }] : []),
        ],
        consensusStatus: resultA && resultB ? 'consensus_synthesized' : 'partial_fallback',
      });
      const finalResultWithLineage = {
        ...finalResult,
        matrixRevision: snapshot.matrixRevision,
        ladderRevision: snapshot.ladderRevision,
      resolverPlanType: snapshot.resolverPlanType,
        diversityStatus,
        inferenceLineage,
      };
      const finalResultWithAudit = { ...finalResultWithLineage, validityAudit: res.locals.validityAudit };

      const apiDurationMs = Date.now() - apiStart;
      clearTimeout(deadlineTimer);
      serverLog('INFO', 'Telemetry', 'Classic Analysis Completed', {
        preparationTimeMs,
        apiDurationMs,
        totalTimeMs: preparationTimeMs + apiDurationMs,
        mode: 'consensus',
      });

      analysisCache.set(cacheKey, finalResultWithLineage);
      res.write(`data: ${JSON.stringify({ text: JSON.stringify(finalResultWithAudit), telemetry: { preparationTimeMs, apiDurationMs } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    } else {
      // Single Model Mode
      updateStatus(isEn ? `🔬 Analyzing with selected model (${selectedModelA})...` : `🔬 Đang phân tích với model đã chọn (${selectedModelA})...`);

      const singleRes = await executeWithFailover(
        async (aiClient, modelName) => {
          const response = await aiClient.models.generateContent({
            model: modelName,
            contents: { parts: [imagePart, { text: promptText }] },
            config: {
        ...providerExecutionConfig(budget),
              systemInstruction,
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: DENTAL_ANALYSIS_SCHEMA,
            },
          });
    budget.checkSignal();
          if (!response.text) throw new Error('Empty response from AI');
          return validateClassicOutput(JSON.parse(response.text));
        },
        selectedModelA,
        isUsingCustomKey ? customApiKey : undefined,
        updateStatus,
        budget,
        'branchSingle',
        roleA.credentialPreference,
        {
          role: 'technical_branch_a',
          modelLadder: roleA.modelLadder,
          configRevision: roleA.compatibilityConfigIdentity,
          credentialAffinity: roleA.credentialPreference,
          assessmentId,
        }
      );

      const mappedResult = mapOptimizedResultToLegacy(singleRes.result, outputLanguage);
      const imageDigest = res.locals.validityReceipt?.imageDigest || digestValidityImage(cleanBase64) || undefined;
      const resultDigest = computeTechnicalResultDigest(mappedResult.findings, mappedResult.overallQuality);
      const inferenceLineage = createInferenceLineage({
        modality: 'technical',
        executionMode: 'single',
        assessmentId,
        sourceImageDigest: imageDigest,
        resultDigest,
        branches: [{
          branch: 'single',
          requestedModel: selectedModelA,
          actualModel: singleRes.usedModel,
          usedKeyType: singleRes.usedKeyType,
        }],
        consensusStatus: 'not_applicable',
      });
      const mappedResultWithLineage = {
        ...mappedResult,
        matrixRevision: snapshot.matrixRevision,
        ladderRevision: snapshot.ladderRevision,
      resolverPlanType: snapshot.resolverPlanType,
        inferenceLineage,
      };
      const mappedResultWithAudit = { ...mappedResultWithLineage, validityAudit: res.locals.validityAudit };
      const apiDurationMs = Date.now() - apiStart;
      clearTimeout(deadlineTimer);
      serverLog('INFO', 'Telemetry', 'Classic Analysis Completed', {
        preparationTimeMs,
        apiDurationMs,
        totalTimeMs: preparationTimeMs + apiDurationMs,
        mode: 'single',
      });

      analysisCache.set(cacheKey, mappedResultWithLineage);
      res.write(`data: ${JSON.stringify({ text: JSON.stringify(mappedResultWithAudit), telemetry: { preparationTimeMs, apiDurationMs } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
  } catch (unknownError: unknown) {
    clearTimeout(deadlineTimer);
    const err = unknownError as any;
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
    const rawLang = String(req.body.language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const storageAdapter = getStorageAdapter();

    const isUsingCustomKey = Boolean(req.body.apiKeyOption === 'custom' && req.body.customApiKey && String(req.body.customApiKey).trim());
    const isInvalidKey = isInvalidApiKeyError(err) || isInvalidApiKeyError(err?.originalError) || err?.isInvalidKey === true;
    const isQuota = isRateLimitOrQuotaError(err) || isRateLimitOrQuotaError(err?.originalError) || err?.isQuotaExhausted === true || err?.message?.includes('QUOTA_EXHAUSTED');
    const isTransient = isTransientError(err) || isTransientError(err?.originalError) || err?.isTransient === true;

    // A custom key failure must have concrete evidence: explicit invalid key, quota exhaustion on custom key, or isCustomKeyFailed flag
    const isCustomKeyFailed = isUsingCustomKey && (err?.isCustomKeyFailed === true || isInvalidKey || isQuota || err?.message?.includes('CUSTOM_KEY_INVALID') || err?.message?.includes('CUSTOM_KEY_QUOTA_EXHAUSTED'));

    let errorType = 'ALL_EXHAUSTED';
    let isQuotaExhausted = false;
    let userMessage = '';

    if (isCustomKeyFailed) {
      errorType = 'CUSTOM_KEY_FAILED';
      isQuotaExhausted = isQuota;
      userMessage = isInvalidKey
        ? (isEn ? 'Your custom API key is invalid or unauthorized.' : 'API Key cá nhân của bạn không hợp lệ hoặc chưa được kích hoạt.')
        : (isEn ? 'Your custom API key has exceeded its quota limit or is invalid.' : 'API Key cá nhân của bạn không hợp lệ hoặc đã vượt quá hạn mức sử dụng.');
    } else if (isQuota || err?.isAllExhausted) {
      errorType = 'ALL_EXHAUSTED';
      isQuotaExhausted = true;
      userMessage = isEn
        ? 'The system trial quota is currently exhausted. Please try again later or enter your own Gemini API Key (BYOK).'
        : 'Hạn mức thử nghiệm của hệ thống hiện tại đã hết hoặc đang quá tải.\nVui lòng quay lại sau ít phút hoặc nhập API Key cá nhân (BYOK) để tiếp tục!';
    } else if (isTransient) {
      errorType = 'TRANSIENT';
      isQuotaExhausted = false;
      userMessage = isEn
        ? 'The AI service timed out or is temporarily busy. Please try again.'
        : 'Dịch vụ AI tạm thời bị gián đoạn hoặc quá thời gian phản hồi (Timeout). Vui lòng thử lại.';
    } else {
      errorType = 'TRANSIENT';
      isQuotaExhausted = false;
      userMessage = isEn
        ? 'An error occurred during AI analysis. Please try again.'
        : 'Có lỗi xảy ra trong quá trình phân tích AI. Vui lòng thử lại.';
    }

    const systemApiAvailable = getApiKeySources().length > 0;
    if (!res.destroyed && !res.writableEnded) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ success: false, errorType, userMessage, isCustomKeyFailed, isQuotaExhausted, systemApiAvailable })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(isQuotaExhausted ? 429 : 500).json({
          success: false,
          errorType,
          userMessage,
          isCustomKeyFailed,
          isQuotaExhausted,
          systemApiAvailable,
        });
      }
    }

    if (!isCustomKeyFailed && !isQuotaExhausted && errorType !== 'ALL_EXHAUSTED') {
      try {
        const nowStr = new Date().toISOString();
        await storageAdapter.saveBug({
          timestamp: nowStr,
          description: `[Tự động Log] Lỗi xử lý Gemini API (${errorType}): ${err?.message || 'Unknown server error'}`,
          path: '/api/analyze-radiograph',
          source: 'SYSTEM_AUTO',
          severity: 'ERROR',
          errorDetails: {
            endpoint: '/api/analyze-radiograph',
            errorType,
            errorMessage: err?.message || String(err),
            statusCode: 500,
          },
        });
      } catch (logErr) {
        serverLog('ERROR', 'AssessmentAPI', 'Failed to auto-log bug', logErr);
      }
    }
  }
});

// Endpoint: Save assessment payload via Storage Adapter
router.post('/api/log-assessment', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const { record, imageDataUrl } = parsePublicTechnicalSaveDto(req.body);
    const storageAdapter = getStorageAdapter();
    const result = await storageAdapter.saveLog(record, imageDataUrl);
    return res.json(result);
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    if (err instanceof PublicPersistenceValidationError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to log assessment' });
    }
  }
});

// Endpoint: Admin verify & update log (Chốt lỗi) — admin-protected
router.post('/api/verify-assessment', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const { assessmentId, verifiedErrors, verifiedNotes } = req.body;
    if (!assessmentId) {
      return res.status(400).json({ success: false, error: 'Thiếu assessmentId' });
    }

    const result = await storageAdapter.verifyAssessment(
      assessmentId,
      verifiedErrors,
      verifiedNotes,
      res.locals.adminReviewerId,
    );
    return res.json({
      success: true,
      message: 'Đã chốt & lưu lỗi xác nhận của Admin thành công ⭐',
      log: result.log,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AssessmentAPI', 'Verify assessment error', err);
    return res.status(500).json({ success: false, error: 'Lỗi khi cập nhật xác minh' });
  }
});

// Endpoint: Retrieve research logs from Storage Adapter (admin-protected)
router.get('/api/assessment-logs', adminAuth, async (_req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const logs = await storageAdapter.getLogs();
    return res.json({
      success: true,
      source: storageAdapter.type,
      count: logs.length,
      logs,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AssessmentAPI', 'Assessment logs fetch error', err);
    return res.json({ success: false, error: 'Không thể truy xuất báo cáo' });
  }
});

// Endpoint: Serve temporarily saved radiograph images with HMAC signature verification
router.get('/api/images/:filename', async (req: Request, res: Response) => {
  const safeFilename = path.basename(req.params.filename);
  const ext = path.extname(safeFilename).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

  if (!allowedExtensions.includes(ext)) {
    return res.status(400).json({ error: 'Invalid or unsupported image file extension' });
  }

  // Validate HMAC signature and expiry for trial image access
  const expires = req.query.expires ? String(req.query.expires) : '';
  const sig = req.query.sig ? String(req.query.sig) : '';

  if (!expires || !sig || !verifySignedImageUrl(safeFilename, expires, sig)) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired signed image URL' });
  }

  const filePath = resolveUploadFilePath(safeFilename);

  if (fs.existsSync(filePath)) {
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.webp') contentType = 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(filePath);
  }

  return res.status(404).json({ error: 'Image not found' });
});

// Endpoint: Validate custom Gemini API Key
router.post('/api/validate-key', validateKeyLimiter, async (req: Request, res: Response) => {
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), 60000);
  bindCancellationLifecycle(res, controller, deadlineTimer);
  const budget = new ExecutionBudget(1, controller.signal);
  try {
    let key = req.body.apiKey ? String(req.body.apiKey).trim() : '';
    if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
      key = key.slice(1, -1).trim();
    }
    if (!key) {
      return res.status(400).json({ valid: false, message: 'API Key không được để trống.' });
    }

    const aiClient = createAiClient(key);
    const testResult = await aiClient.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: [{ text: 'Ping' }],
      config: providerExecutionConfig(budget),
    });

    budget.checkSignal();
    if (testResult && testResult.text) {
      return res.json({ valid: true, message: 'API Key hợp lệ.' });
    }
    return res.status(400).json({ valid: false, message: 'Không thể xác thực API Key.' });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(400).json({
      valid: false,
      message: 'API Key không hợp lệ hoặc đã hết lượt dùng.',
    });
  }
});

export default router;
