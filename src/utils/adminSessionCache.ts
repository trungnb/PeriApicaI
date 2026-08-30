/**
 * Shared Admin Session Cache Utility
 * Provides safe sessionStorage read/write operations with item count capping,
 * payload stripping of heavy image/data URLs, and resilient QuotaExceeded error handling.
 */

export const ADMIN_CACHE_KEYS = {
  LOGS: 'admin_cached_logs',
  BUGS: 'admin_cached_bugs',
  PATHOLOGY_LOGS: 'admin_cached_pathology_logs',
} as const;

/**
 * Strips heavy base64 and data URLs from object before session persistence
 */
function cleanItemForSession<T>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  const clone: any = { ...item };
  if ('imageDataUrl' in clone) {
    delete clone.imageDataUrl;
  }
  for (const key of Object.keys(clone)) {
    if (typeof clone[key] === 'string' && clone[key].startsWith('data:image')) {
      delete clone[key];
    }
  }
  return clone as T;
}

/**
 * Safely reads and parses an array from sessionStorage.
 */
export function safeGetAdminSessionItem<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.debug(`[adminSessionCache] Read failed for ${key}:`, err);
    return [];
  }
}

/**
 * Safely writes an array to sessionStorage with size/item capping and QuotaExceeded resilience.
 */
export function safeSetAdminSessionItem<T>(key: string, items: T[], maxItems: number = 100): void {
  if (typeof window === 'undefined' || !Array.isArray(items)) return;
  try {
    const capped = items.slice(0, maxItems).map(cleanItemForSession);
    sessionStorage.setItem(key, JSON.stringify(capped));
  } catch (err) {
    console.warn(`[adminSessionCache] Write failed for ${key} (storage quota exceeded or unavailable):`, err);
    // On QuotaExceeded, attempt to store a smaller slice (top 20)
    try {
      const minCapped = items.slice(0, 20).map(cleanItemForSession);
      sessionStorage.setItem(key, JSON.stringify(minCapped));
    } catch {
      // If even 20 fails, silently ignore to avoid breaking UI flow
    }
  }
}

/**
 * Clears all admin-related session cache entries.
 */
export function clearAdminSessionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ADMIN_CACHE_KEYS.LOGS);
    sessionStorage.removeItem(ADMIN_CACHE_KEYS.BUGS);
    sessionStorage.removeItem(ADMIN_CACHE_KEYS.PATHOLOGY_LOGS);
  } catch (err) {
    console.debug('[adminSessionCache] Clear failed:', err);
  }
}
