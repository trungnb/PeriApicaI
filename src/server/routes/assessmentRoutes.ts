import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { analyzeLimiter, generalActionLimiter, validateKeyLimiter } from '../config/limiter';
import { uploadsDir, serverLog, verifySignedImageUrl } from '../config/env';
import { getStorageAdapter } from '../services/storageAdapter';
import {
  analysisCache,
  getApiKeySources,
  createAiClient,
  getAvailableVisionModels,
  executeWithFailover,
  DENTAL_ANALYSIS_SCHEMA,
  buildSystemInstruction,
  synthesizeConsensusResults,
  mapOptimizedResultToLegacy,
  isRateLimitOrQuotaError,
  isTransientError,
  isInvalidApiKeyError,
} from '../services/geminiService';
import { adminAuth } from './authRoutes';
import { validateRadiographAnalysis } from '../middleware/validation';

const router = Router();

// Dynamic Endpoint: Get available models for dropdown selection (System or BYOK)
router.post('/api/available-models', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const customApiKey = req.body.customApiKey ? String(req.body.customApiKey).trim() : undefined;
    const models = await getAvailableVisionModels(customApiKey);
    return res.json({ success: true, models });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AvailableModels', 'Error fetching available models:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch models' });
  }
});

// Primary Endpoint: Radiograph Analysis via Gemini Vision API
router.post('/api/analyze-radiograph', validateRadiographAnalysis, analyzeLimiter, async (req: Request, res: Response) => {
  try {
    const tooth = typeof req.body.tooth === 'string' ? JSON.parse(req.body.tooth) : req.body.tooth;
    const technique = req.body.technique;
    const receptorType = req.body.receptorType;
    const rawLang = String(req.body.language || req.body.outputLanguage || '');
    const isEn = rawLang.toUpperCase() === 'EN' || rawLang.toLowerCase() === 'english';
    const outputLanguage = isEn ? 'EN' : 'VI';
    const analysisMode = req.body.analysisMode === 'consensus' ? 'consensus' : 'single';

    let customApiKey = req.body.customApiKey ? String(req.body.customApiKey).trim() : '';
    if ((customApiKey.startsWith("'") && customApiKey.endsWith("'")) || (customApiKey.startsWith('"') && customApiKey.endsWith('"'))) {
      customApiKey = customApiKey.slice(1, -1).trim();
    }
    const apiKeyOption = req.body.apiKeyOption || (customApiKey ? 'custom' : 'system');

    const selectedModelA = req.body.selectedModelA || req.body.selectedModel || 'gemini-flash-latest';
    const selectedModelB = req.body.selectedModelB || 'gemini-flash-lite-latest';

    if (!tooth || !technique || !receptorType) {
      return res.status(400).json({ error: 'Missing required parameters: tooth, technique, receptorType' });
    }

    let cleanBase64 = '';
    let mimeType = 'image/jpeg';

    if (req.body.imageBase64) {
      const b64 = req.body.imageBase64;
      if (b64.startsWith('data:')) {
        const match = b64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          cleanBase64 = match[2];
        } else {
          cleanBase64 = b64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
        }
      } else {
        cleanBase64 = b64;
      }
    }

    if (!cleanBase64) {
      return res.status(400).json({ error: 'Missing image data (imageBase64 required in JSON body)' });
    }

    const cacheKey = crypto
      .createHash('sha256')
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
      const cached = analysisCache.get(cacheKey);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ text: JSON.stringify(cached), isCached: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    if (mimeType.includes('svg')) {
      mimeType = 'image/png';
    }

    const systemInstruction = buildSystemInstruction(tooth, technique, receptorType, outputLanguage);
    const promptText = `Analyze radiograph for FDI ${tooth.fdiNumber}.`;

    const imagePart = {
      inlineData: {
        mimeType: mimeType === 'image/svg+xml' ? 'image/jpeg' : mimeType,
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

    if (analysisMode === 'consensus') {
      updateStatus(isEn ? '👥 Initializing Dual-Model Consensus...' : '👥 Đang khởi tạo Hội chẩn Song song...');

      const [resA, resB] = await Promise.allSettled([
        executeWithFailover(async (aiClient, modelName) => {
            updateStatus(isEn ? `🔬 Querying AI Model 1 (${modelName})...` : `🔬 Đang phân tích Mô hình AI 1 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: DENTAL_ANALYSIS_SCHEMA,
              },
            });
            if (!response.text) throw new Error('Empty response from AI Model 1');
            return validateClassicOutput(JSON.parse(response.text));
          }, selectedModelA, isUsingCustomKey ? customApiKey : undefined, updateStatus, budget),
        executeWithFailover(async (aiClient, modelName) => {
            updateStatus(isEn ? `🔬 Querying AI Model 2 (${modelName})...` : `🔬 Đang phân tích Mô hình AI 2 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: DENTAL_ANALYSIS_SCHEMA,
              },
            });
            if (!response.text) throw new Error('Empty response from AI Model 2');
            return validateClassicOutput(JSON.parse(response.text));
          }, selectedModelB, isUsingCustomKey ? customApiKey : undefined, updateStatus, budget)
      ]);

      const rawResultA = resA.status === 'fulfilled' ? resA.value.result : null;
      const rawResultB = resB.status === 'fulfilled' ? resB.value.result : null;

      const resultA = rawResultA ? mapOptimizedResultToLegacy(rawResultA, outputLanguage) : null;
      const resultB = rawResultB ? mapOptimizedResultToLegacy(rawResultB, outputLanguage) : null;

      if (!resultA && !resultB) {
        const errA: any = resA.status === 'rejected' ? resA.reason : null;
        const errB: any = resB.status === 'rejected' ? resB.reason : null;
        const rejectionErr: any = new Error(errA?.message || errB?.message || 'Dual models failed');
        rejectionErr.isCustomKeyFailed = Boolean(errA?.isCustomKeyFailed || errB?.isCustomKeyFailed);
        rejectionErr.isQuotaExhausted = Boolean(errA?.isQuotaExhausted || errB?.isQuotaExhausted);
        rejectionErr.isTransient = Boolean(errA?.isTransient || errB?.isTransient);
        rejectionErr.originalError = errA || errB;
        throw rejectionErr;
      }

      updateStatus(isEn ? '✅ Synthesizing clinical consensus findings...' : '✅ Đang tổng hợp kết quả hội chẩn lâm sàng...');
      const finalResult = (resultA && resultB)
        ? synthesizeConsensusResults(
            resultA,
            resultB,
            outputLanguage,
            resA.status === 'fulfilled' ? resA.value.usedModel : selectedModelA,
            resB.status === 'fulfilled' ? resB.value.usedModel : selectedModelB
          )
        : (resultA || resultB);

      analysisCache.set(cacheKey, finalResult);
      res.write(`data: ${JSON.stringify({ text: JSON.stringify(finalResult) })}\n\n`);
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
              systemInstruction,
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: DENTAL_ANALYSIS_SCHEMA,
            },
          });
          if (!response.text) throw new Error('Empty response from AI');
          return validateClassicOutput(JSON.parse(response.text));
        },
        selectedModelA,
        isUsingCustomKey ? customApiKey : undefined,
        updateStatus,
        budget
      );

      const mappedResult = mapOptimizedResultToLegacy(singleRes.result, outputLanguage);
      analysisCache.set(cacheKey, mappedResult);
      res.write(`data: ${JSON.stringify({ text: JSON.stringify(mappedResult) })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
  } catch (unknownError: unknown) {
    const err = unknownError as any;
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
            stackTrace: err?.stack,
            statusCode: 500,
          },
        });
      } catch (logErr) {
        serverLog('ERROR', 'AssessmentAPI', 'Failed to auto-log bug', logErr);
      }
    }

    if (res.headersSent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ errorType, userMessage, isCustomKeyFailed, isQuotaExhausted })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    } else if (!res.writableEnded) {
      return res.status(isQuotaExhausted ? 429 : 500).json({
        success: false,
        errorType,
        userMessage,
        isCustomKeyFailed,
        isQuotaExhausted,
      });
    }
  }
});

// Endpoint: Save assessment payload via Storage Adapter
router.post('/api/log-assessment', generalActionLimiter, async (req: Request, res: Response) => {
  try {
    const { payload, imageDataUrl } = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu payload đánh giá hợp lệ.' });
    }
    const storageAdapter = getStorageAdapter();
    const result = await storageAdapter.saveLog(payload, imageDataUrl);
    return res.json(result);
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to log assessment', details: err?.message });
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

    const result = await storageAdapter.verifyAssessment(assessmentId, verifiedErrors, verifiedNotes);
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

  const filePath = path.join(uploadsDir, safeFilename);

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
    });

    if (testResult && testResult.text) {
      return res.json({ valid: true, message: 'API Key hợp lệ.' });
    }
    return res.status(400).json({ valid: false, message: 'Không thể xác thực API Key.' });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(400).json({
      valid: false,
      message: err?.message || 'API Key không hợp lệ hoặc đã hết lượt dùng.',
    });
  }
});

export default router;
