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
    id = `PA-USR-${globalThis.crypto.randomUUID()}`;
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
