/**
 * Firestore Pathology Service
 * CRUD for the separate `seg_reports` collection.
 */
import { getFirestoreInstance } from './firebaseService';
import { saveAndOptimizeImageFile, serverLog } from '../config/env';
import { getOrInitServerCache, saveServerCacheToDisk } from './storageAdapter';
import { executeAtomicPathologyWrite, executeAtomicBulkDelete } from './atomicUpdateService';

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

  return clone;
}

// ─── In-Memory RAM Cache (integrated with ServerCache & disk temp_cache.json) ─────
let ramCache: any[] = [];
let lastSyncTime = 0;
let unsubscribeSnapshot: (() => void) | null = null;

export function startPathologySnapshot(): void {
  const db = getFirestoreInstance();
  if (!db || unsubscribeSnapshot) return;

  try {
    const col = db.collection(COLLECTION).orderBy('timestamp', 'desc').limit(500);
    unsubscribeSnapshot = col.onSnapshot(
      (snapshot: any) => {
        const cache = getOrInitServerCache();
        const docs = snapshot.docs.map((doc: any) =>
          restorePathologyDocFromFirestore({ _id: doc.id, ...doc.data() })
        );
        cache.seg_reports = docs;
        ramCache = docs;
        lastSyncTime = Date.now();
      },
      (err: any) => {
        serverLog('ERROR', 'PathologySnapshot', `Error: ${err?.message}`);
      },
    );
    serverLog('INFO', 'PathologySnapshot', 'Real-time listener started on seg_reports');
  } catch (unknownError: unknown) {
    const e = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'PathologySnapshot', `Failed to start: ${e?.message}`);
  }
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

  let finalImageUrl: string | undefined = payload.imageUrl;

  // Optimize and persist image locally if dataUrl is provided
  if (imageDataUrl && imageDataUrl.startsWith('data:image')) {
    try {
      const optimized = await saveAndOptimizeImageFile(assessmentId, imageDataUrl);
      finalImageUrl = optimized.localUrl;
    } catch (imgErr) {
      serverLog('WARN', 'PathologyService', 'Could not optimize pathology image', imgErr);
    }
  }

  const docData = {
    ...payload,
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
  const existingIdx = cache.seg_reports.findIndex((r: any) => r.assessmentId === assessmentId);
  if (existingIdx >= 0) {
    cache.seg_reports[existingIdx] = {
      ...cache.seg_reports[existingIdx],
      ...docData,
    };
  } else {
    cache.seg_reports.unshift(docData);
  }
  ramCache = cache.seg_reports;
  cache.isCacheDirty = true;
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
        firestorePayload,
        existingIdx < 0,
        existingIdx >= 0 ? cache.seg_reports[existingIdx] : undefined
      );

      firestoreSynced = atomicRes.success;
      const target = cache.seg_reports.find((r: any) => r.assessmentId === assessmentId);
      if (target && atomicRes.success) target.firestoreSynced = true;

      serverLog('INFO', 'PathologyService', `Saved to seg_reports atomically: ${assessmentId}`);
    } catch (unknownError: unknown) {
      const e = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      serverLog('ERROR', 'PathologyService', `Firestore save failed: ${e?.message}`);
    }
  }

  return { success: true, assessmentId, imageUrl: finalImageUrl, firestoreSynced };
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
    lastSyncTime = Date.now();
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
  cache.isCacheDirty = true;
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
