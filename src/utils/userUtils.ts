/**
 * Helper utility to manage unique persistent Client User IDs.
 */

const USER_ID_KEY = 'pa_user_id';

/**
 * Returns or generates a persistent Unique User Identifier for this device/browser.
 */
export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return 'PA-USR-SERVER';
  
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const timestampStr = Date.now().toString(36).toUpperCase();
    id = `PA-USR-${timestampStr}-${randomSuffix}`;
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

