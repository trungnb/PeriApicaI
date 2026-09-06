import type { NextFunction, Request, Response } from 'express';

export type ApiKeyMode = 'custom' | 'system';

export interface ResolvedApiKeyMode {
  apiKeyOption: ApiKeyMode;
  customApiKey?: string;
}

function normalizeCustomApiKey(value: unknown): string {
  let key = typeof value === 'string' ? value.trim() : '';
  if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

export function resolveApiKeyMode(body: Record<string, unknown>): ResolvedApiKeyMode {
  const customApiKey = normalizeCustomApiKey(body.customApiKey);
  const requestedMode = typeof body.apiKeyOption === 'string'
    ? body.apiKeyOption.trim().toLowerCase()
    : '';

  if (requestedMode === 'custom') {
    if (!customApiKey) {
      throw new Error('CUSTOM_API_KEY_REQUIRED');
    }
    return { apiKeyOption: 'custom', customApiKey };
  }

  if (requestedMode === 'system') return { apiKeyOption: 'system' };
  return customApiKey
    ? { apiKeyOption: 'custom', customApiKey }
    : { apiKeyOption: 'system' };
}

/**
 * Explicit BYOK mode is a security boundary: a blank key must never be
 * converted into a system-mode request by downstream provider selection.
 */
export function requireUsableApiKeyMode(req: Request, res: Response, next: NextFunction): void {
  try {
    const resolved = resolveApiKeyMode(req.body || {});
    req.body.apiKeyOption = resolved.apiKeyOption;
    req.body.customApiKey = resolved.customApiKey || '';
    res.locals.apiKeyMode = resolved;
    next();
  } catch (error) {
    if (error instanceof Error && error.message === 'CUSTOM_API_KEY_REQUIRED') {
      res.status(400).json({
        success: false,
        error: 'A non-empty custom API key is required when custom mode is selected.',
        errorType: 'CUSTOM_API_KEY_REQUIRED',
      });
      return;
    }
    next(error);
  }
}
