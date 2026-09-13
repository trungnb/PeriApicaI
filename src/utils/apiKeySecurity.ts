/**
 * Utility functions for BYOK API Key security and memory-only lifecycle management.
 * 
 * Remediation R5 Mandate:
 * Personal / BYOK Gemini API keys must be strictly memory-only.
 * They MUST NOT be stored in localStorage, sessionStorage, IndexedDB, cookies,
 * databases, filesystem, URLs, query parameters, or logs.
 */

export const LEGACY_API_KEY_STORAGE_KEY = 'periapical_user_api_key';
export const LEGACY_REMEMBER_KEY_STORAGE_KEY = 'periapical_remember_custom_api_key';

export const LEGACY_PERSISTENT_KEYS = [
  LEGACY_API_KEY_STORAGE_KEY,
  LEGACY_REMEMBER_KEY_STORAGE_KEY,
] as const;

const CREDENTIAL_FIELD_PATTERN =
  '(?:key|api[_-]?key|custom[_-]?api[_-]?key|access[_-]?token|token|secret|authorization)';

// Keep only the field/separator and optional Bearer scheme in captures. The
// credential value is deliberately matched by non-capturing text so a
// replacement cannot accidentally re-emit it.
const QUOTED_CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:^|[\\s?&,;{(\\[])["']?${CREDENTIAL_FIELD_PATTERN}["']?\\s*[:=]\\s*)(["'])((?:Bearer\\s+)?)[^"'\\r\\n]*\\2`,
  'gi',
);

const UNQUOTED_CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:^|[\\s?&,;{(\\[])["']?${CREDENTIAL_FIELD_PATTERN}["']?\\s*[:=]\\s*)((?:Bearer\\s+)?)[^\\s&,;}"']+`,
  'gi',
);

const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+/%:=\-]+/gi;

/**
 * Safely and idempotently removes any legacy personal API key entries found in browser persistent storage.
 * 
 * Critical security invariants:
 * - Does NOT read or copy the value to runtime state.
 * - Does NOT log the value.
 * - Does NOT transmit the value.
 * - Does NOT copy the value to sessionStorage.
 */
export function purgeLegacyApiKeyStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    for (const key of LEGACY_PERSISTENT_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Fail-safe against private browsing or sandboxed iframe security exceptions
  }
}

/**
 * Sanitizes any raw string to redact Gemini API keys (AIza...) or potential token assignments
 * to prevent accidental exposure in console outputs, server logs, or bug reports.
 */
export function sanitizeCredentialString(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***REDACTED***')
    .replace(
      QUOTED_CREDENTIAL_ASSIGNMENT,
      (_match, safePrefix: string, quote: string, bearerScheme: string) =>
        `${safePrefix}${quote}${bearerScheme}***REDACTED***${quote}`,
    )
    .replace(
      UNQUOTED_CREDENTIAL_ASSIGNMENT,
      (_match, safePrefix: string, bearerScheme: string) =>
        `${safePrefix}${bearerScheme}***REDACTED***`,
    )
    .replace(BEARER_CREDENTIAL, '$1***REDACTED***');
}

const MAX_REDACT_DEPTH = 5;
const MAX_REDACT_KEYS = 50;
const MAX_REDACT_ARRAY_LENGTH = 50;
const MAX_REDACT_STRING_LENGTH = 2000;

/**
 * Recursively deep-redacts sensitive credential fields and values in objects before logging or saving,
 * bounded by strict depth, key-count, and array-length limits.
 */
export function redactObjectSecrets<T = any>(obj: T, depth = 0): T {
  if (obj === null || obj === undefined) return obj;
  if (depth > MAX_REDACT_DEPTH) {
    return '[Truncated: Depth Limit]' as unknown as T;
  }
  if (typeof obj === 'string') {
    const capped = obj.length > MAX_REDACT_STRING_LENGTH ? obj.slice(0, MAX_REDACT_STRING_LENGTH) + '...[Truncated]' : obj;
    return sanitizeCredentialString(capped) as unknown as T;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }
  if (Array.isArray(obj)) {
    const sliced = obj.length > MAX_REDACT_ARRAY_LENGTH ? obj.slice(0, MAX_REDACT_ARRAY_LENGTH) : obj;
    return sliced.map(item => redactObjectSecrets(item, depth + 1)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const sensitiveKeys = ['apikey', 'customapikey', 'token', 'secret', 'password', 'authorization'];
    const result: Record<string, any> = {};
    const entries = Object.entries(obj as Record<string, any>);
    const cappedEntries = entries.length > MAX_REDACT_KEYS ? entries.slice(0, MAX_REDACT_KEYS) : entries;

    for (const [k, v] of cappedEntries) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        continue;
      }
      const lowerKey = k.toLowerCase();
      if (lowerKey === 'key' || sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        result[k] = '***REDACTED***';
      } else {
        result[k] = redactObjectSecrets(v, depth + 1);
      }
    }
    return result as T;
  }
  return obj;
}
