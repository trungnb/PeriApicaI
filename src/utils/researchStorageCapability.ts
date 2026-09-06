/**
 * Research Image Storage Capability Gate
 *
 * Current owner decision:
 * Research/training image storage repository is NOT implemented yet.
 * Therefore the Training JSON export must NOT currently be available
 * as if a complete training dataset can be produced.
 *
 * Policy:
 * 1. Training JSON export action is disabled/locked while research image persistence is unavailable.
 * 2. Handler must also reject execution; UI disable alone is insufficient.
 * 3. Do not generate training JSON that implies an image path/file/URL exists when the corresponding research image was never persisted.
 * 4. Research consent choices remain visible for future functionality.
 * 5. Do NOT claim images are never stored anywhere; only the research repository is currently not implemented.
 * 6. Consent=true alone does NOT unlock it.
 * 7. When capability is enabled in the future, it unlocks without UI redesign.
 */

export const TRAINING_EXPORT_LOCKED_MSG_VI =
  'Tạm thời chưa khả dụng vì hệ thống chưa lưu ảnh nghiên cứu.';

export const TRAINING_EXPORT_LOCKED_MSG_EN =
  'Temporarily unavailable because research image storage is not implemented.';

let capabilityOverride: boolean | null = null;

/**
 * Returns whether research image repository storage capability is active.
 * Currently returns false because research image repository is not yet implemented.
 */
export function isResearchImageStorageAvailable(): boolean {
  if (capabilityOverride !== null) {
    return capabilityOverride;
  }
  if (typeof process !== 'undefined' && process.env?.RESEARCH_IMAGE_STORAGE_ENABLED === 'true') {
    return true;
  }
  return false;
}

/**
 * For testing future capability unlock without redesigning UI.
 */
export function setResearchImageStorageCapabilityOverride(enabled: boolean | null): void {
  capabilityOverride = enabled;
}

/**
 * Returns the natural language explanation message for why training export is locked.
 */
export function getTrainingExportLockedMessage(lang?: string): string {
  const isEn = lang?.toLowerCase() === 'en';
  return isEn ? TRAINING_EXPORT_LOCKED_MSG_EN : TRAINING_EXPORT_LOCKED_MSG_VI;
}

/**
 * Throws an Error if research image storage capability is unavailable,
 * preventing any direct handler or script from generating incomplete training JSON.
 */
export function assertResearchImageStorageAvailable(lang?: string): void {
  if (!isResearchImageStorageAvailable()) {
    throw new Error(getTrainingExportLockedMessage(lang));
  }
}
