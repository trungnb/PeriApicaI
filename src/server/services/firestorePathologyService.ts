/**
 * Firestore Pathology Service
 * CRUD for the separate `seg_reports` collection.
 */
import { getFirestoreInstance } from './firebaseService';
import { saveAndOptimizeImageFile, serverLog } from '../config/env';
import { getOrInitServerCache, markServerCacheDirty, saveServerCacheToDisk } from './storageAdapter';
import { executeAtomicPathologyWrite, executeAtomicBulkDelete } from './atomicUpdateService';
import {
  appendPathologyReview,
  materializePathologyEvaluationLesionIds,
  readPathologyEvaluation,
} from '../../utils/pathologyEvaluation';
import { preserveImmutableInferenceLineage } from './inferenceLineage';

const COLLECTION = 'seg_reports';

/**
 * Transforms nested array tuples (e.g. polygonPoints: [[x1, y1], [x2, y2]])
 * into objects ({ x: x1, y: y1 }) before writing to Firestore,
 * because Cloud Firestore rejects nested arrays in Array properties with
 * '3 INVALID_ARGUMENT: Property array contains an invalid nested entity'.
 */
export function formatPathologyDocForFirestore(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;

  const convertPathologyList = (list: any[]) => {
    if (!Array.isArray(list)) return list;
    return list.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const itemClone = { ...item };
      if (Array.isArray(itemClone.polygonPoints)) {
        itemClone.polygonPoints = itemClone.polygonPoints.map((pt: any) => {
          if (Array.isArray(pt) && pt.length >= 2) {
            return { x: Number(pt[0]), y: Number(pt[1]) };
          }
          return pt;
        });
      }
      return itemClone;
    });
  };

  const clone = { ...doc };
  if (Array.isArray(clone.detectedPathologies)) {
    clone.detectedPathologies = convertPathologyList(clone.detectedPathologies);
  }
  if (Array.isArray(clone.confirmedPathologies)) {
    clone.confirmedPathologies = convertPathologyList(clone.confirmedPathologies);
  }
  if (Array.isArray(clone.finalConfirmedPathologies)) {
    clone.finalConfirmedPathologies = convertPathologyList(clone.finalConfirmedPathologies);
  }
  if (clone.pathologyEvaluation) {
    clone.pathologyEvaluation = { ...clone.pathologyEvaluation };
    if (Array.isArray(clone.pathologyEvaluation.aiPredictionSnapshot)) {
      clone.pathologyEvaluation.aiPredictionSnapshot = convertPathologyList(clone.pathologyEvaluation.aiPredictionSnapshot);
    }
    const convertReview = (review: any) => review && typeof review === 'object'
      ? { ...review, finalFindings: convertPathologyList(review.finalFindings) }
      : review;
    if (clone.pathologyEvaluation.currentReview) clone.pathologyEvaluation.currentReview = convertReview(clone.pathologyEvaluation.currentReview);
    if (Array.isArray(clone.pathologyEvaluation.reviewHistory)) clone.pathologyEvaluation.reviewHistory = clone.pathologyEvaluation.reviewHistory.map(convertReview);
  }

  return clone;
}

/**
 * Restores objects ({ x: x1, y: y1 }) back to array tuples ([x1, y1])
 * when reading documents from Firestore.
 */
export function restorePathologyDocFromFirestore(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;

  const convertPathologyList = (list: any[]) => {
    if (!Array.isArray(list)) return list;
    return list.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const itemClone = { ...item };
      if (Array.isArray(itemClone.polygonPoints)) {
        itemClone.polygonPoints = itemClone.polygonPoints.map((pt: any) => {
          if (pt && typeof pt === 'object' && !Array.isArray(pt) && 'x' in pt && 'y' in pt) {
            return [Number(pt.x), Number(pt.y)];
          }
          return pt;
        });
      }
      return itemClone;
    });
  };

  const clone = { ...doc };
  if (Array.isArray(clone.detectedPathologies)) {
    clone.detectedPathologies = convertPathologyList(clone.detectedPathologies);
  }
  if (Array.isArray(clone.confirmedPathologies)) {
    clone.confirmedPathologies = convertPathologyList(clone.confirmedPathologies);
  }
  if (Array.isArray(clone.finalConfirmedPathologies)) {
    clone.finalConfirmedPathologies = convertPathologyList(clone.finalConfirmedPathologies);
  }
  if (clone.pathologyEvaluation) {
    clone.pathologyEvaluation = { ...clone.pathologyEvaluation };
    if (Array.isArray(clone.pathologyEvaluation.aiPredictionSnapshot)) {
      clone.pathologyEvaluation.aiPredictionSnapshot = convertPathologyList(clone.pathologyEvaluation.aiPredictionSnapshot);
    }
    const convertReview = (review: any) => review && typeof review === 'object'
      ? { ...review, finalFindings: convertPathologyList(review.finalFindings) }
      : review;
    if (clone.pathologyEvaluation.currentReview) clone.pathologyEvaluation.currentReview = convertReview(clone.pathologyEvaluation.currentReview);
    if (Array.isArray(clone.pathologyEvaluation.reviewHistory)) clone.pathologyEvaluation.reviewHistory = clone.pathologyEvaluation.reviewHistory.map(convertReview);
  }

  return clone;
}

// ─── In-Memory RAM Cache (integrated with ServerCache & disk temp_cache.json) ─────
let ramCache: any[] = [];

export function startPathologySnapshot(): void {
  serverLog('INFO', 'PathologySnapshot', 'Realtime snapshot listener disabled to save Firestore read quota. Using on-demand storage cache.');
}

export function getPathologyRamCache(): any[] {
  const cache = getOrInitServerCache();
  if (cache.seg_reports && cache.seg_reports.length > 0) {
    return cache.seg_reports;
  }
  return ramCache;
}

export async function savePathologyLog(
  payload: any,
  imageDataUrl?: string,
): Promise<{ success: boolean; assessmentId: string; imageUrl?: string; firestoreSynced: boolean }> {
  const db = getFirestoreInstance();
  const cache = getOrInitServerCache();
  const assessmentId = payload.assessmentId ?? `pathology-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const existingIdx = cache.seg_reports.findIndex((r: any) => r.assessmentId === assessmentId);
  const previousRecord = existingIdx >= 0
    ? structuredClone(cache.seg_reports[existingIdx])
    : undefined;
  const immutableLineage = preserveImmutableInferenceLineage(previousRecord?.inferenceLineage, payload.inferenceLineage);

  let finalImageUrl: string | undefined = '';
  const userAgreedSharing = payload.shareConsent === true;

  if (userAgreedSharing) {
    if (imageDataUrl && imageDataUrl.startsWith('data:image')) {
      try {
        const optimized = await saveAndOptimizeImageFile(assessmentId, imageDataUrl);
        finalImageUrl = optimized.localUrl;
      } catch (imgErr) {
        serverLog('WARN', 'PathologyService', 'Could not optimize pathology image', imgErr);
      }
    } else {
      finalImageUrl = payload.imageUrl || '';
    }
  }

  const docData = {
    ...payload,
    ...(immutableLineage ? { inferenceLineage: immutableLineage } : {}),
    shareConsent: userAgreedSharing,
    assessmentId,
    imageUrl: finalImageUrl,
    updatedAt: new Date().toISOString(),
    savedAt: payload.savedAt || new Date().toISOString(),
    collectionVersion: 2,
    firestoreSynced: false,
  };

  // Remove bulky base64 dataUrl from stored payload
  delete (docData as any).imageDataUrl;

  // Update in-memory cache
  if (existingIdx >= 0) {
    cache.seg_reports[existingIdx] = {
      ...previousRecord,
      ...docData,
    };
  } else {
    cache.seg_reports.unshift(docData);
  }
  ramCache = cache.seg_reports;
  markServerCacheDirty(cache);
  saveServerCacheToDisk();

  let firestoreSynced = false;

  if (db) {
    try {
      const firestorePayload = formatPathologyDocForFirestore({
        ...docData,
        firestoreSynced: true,
        lastSyncedAt: new Date().toISOString(),
      });

      const atomicRes = await executeAtomicPathologyWrite(
        db,
        assessmentId,
        firestorePayload
      );

      firestoreSynced = atomicRes.success;
      const target = cache.seg_reports.find((r: any) => r.assessmentId === assessmentId);
      if (target && atomicRes.success) {
        target.firestoreSynced = true;
        markServerCacheDirty(cache);
        saveServerCacheToDisk();
      }

      serverLog('INFO', 'PathologyService', `Saved to seg_reports atomically: ${assessmentId}`);
    } catch (unknownError: unknown) {
      const e = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      serverLog('ERROR', 'PathologyService', `Firestore save failed: ${e?.message}`);
    }
  }

  return { success: true, assessmentId, imageUrl: finalImageUrl, firestoreSynced };
}

/** Records a new admin truth version while retaining the immutable AI prediction snapshot. */
export async function saveAdminPathologyReview(input: {
  assessmentId: string;
  finalFindings: any[];
  reviewerId: string;
  reviewedAt: string;
  notes?: string;
}): Promise<{ success: boolean; assessmentId: string; imageUrl?: string; firestoreSynced: boolean }> {
  const cache = getOrInitServerCache();
  const existing = cache.seg_reports.find((record: any) => record.assessmentId === input.assessmentId);
  if (!existing) throw new Error('Pathology assessment was not found.');

  const evaluation = appendPathologyReview(materializePathologyEvaluationLesionIds(readPathologyEvaluation(existing)), {
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    finalFindings: input.finalFindings,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  });

  return savePathologyLog({
    assessmentId: input.assessmentId,
    shareConsent: existing.shareConsent === true,
    imageUrl: existing.imageUrl,
    detectedPathologies: structuredClone(evaluation.aiPredictionSnapshot),
    pathologyEvaluation: evaluation,
    finalConfirmedPathologies: structuredClone(input.finalFindings),
    verifiedNotes: input.notes || '',
    verifiedAt: input.reviewedAt,
    verifiedBy: input.reviewerId,
    isReviewedByAdmin: true,
  });
}

export async function getPathologyLogs(limitCount: number = 100): Promise<any[]> {
  const cache = getOrInitServerCache();
  if (cache.seg_reports && cache.seg_reports.length > 0) {
    return cache.seg_reports.slice(0, limitCount);
  }

  const db = getFirestoreInstance();
  if (!db) return cache.seg_reports.slice(0, limitCount);

  try {
    const snapshot = await db
      .collection(COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(limitCount)
      .get();

    const docs = snapshot.docs.map((doc: any) =>
      restorePathologyDocFromFirestore({ _id: doc.id, ...doc.data() })
    );
    cache.seg_reports = docs;
    ramCache = docs;
    return docs;
  } catch (unknownError: unknown) {
    const e = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'PathologyService', `getLogs error: ${e?.message}`);
    return cache.seg_reports.slice(0, limitCount);
  }
}

export async function deletePathologyLogs(options: {
  startDate?: string;
  endDate?: string;
}): Promise<{ success: boolean; deletedCount: number }> {
  const cache = getOrInitServerCache();
  const db = getFirestoreInstance();

  const initialCount = cache.seg_reports.length;
  cache.seg_reports = cache.seg_reports.filter((entry: any) => {
    if (options.startDate && entry.timestamp < options.startDate) return true;
    if (options.endDate && entry.timestamp > options.endDate) return true;
    return false;
  });
  const deletedCount = initialCount - cache.seg_reports.length;
  ramCache = cache.seg_reports;
  markServerCacheDirty(cache);
  saveServerCacheToDisk(true);

  if (db) {
    try {
      let query: any = db.collection(COLLECTION);
      if (options.startDate) query = query.where('timestamp', '>=', options.startDate);
      if (options.endDate) query = query.where('timestamp', '<=', options.endDate);

      const snapshot = await query.get();
      if (!snapshot.empty) {
        const items = snapshot.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
        await executeAtomicBulkDelete(db, 'seg_reports', items);
      }
    } catch (unknownError: unknown) {
      const e = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      serverLog('ERROR', 'PathologyService', `deletePathologyLogs error: ${e?.message}`);
    }
  }

  return { success: true, deletedCount };
}
