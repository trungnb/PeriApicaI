import { Firestore } from 'firebase-admin/firestore';
import { serverLog } from '../config/env';
import {
  executeIdempotentStatsWrite,
  executeAtomicStatsBulkDelete,
  reportContributions,
  bugContributions,
  pathologyContributions,
} from './systemStatsService';

export interface AtomicOperationResult {
  success: boolean;
  docId?: string;
  collection: 'reports' | 'bugs' | 'seg_reports';
  deletedCount?: number;
  error?: string;
}

/**
 * ─── 1. ATOMIC WRITE / UPDATE: 'reports' COLLECTION (Luồng A) ───
 */
export async function executeAtomicReportWrite(
  db: Firestore,
  docId: string,
  reportData: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !reportData) {
    return { success: false, docId, collection: 'reports', error: 'Missing db instance, docId, or report payload' };
  }

  try {
    await executeIdempotentStatsWrite(db, 'reports', docId, reportData, reportContributions);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic report write succeeded for ${docId}`);
    return { success: true, docId, collection: 'reports' };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic report write failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'reports', error: err?.message || String(err) };
  }
}

/**
 * ─── 2. ATOMIC DELETE: 'reports' COLLECTION ───
 */
export async function executeAtomicReportDelete(
  db: Firestore,
  docId: string,
  reportData?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId) {
    return { success: false, docId, collection: 'reports', error: 'Missing db or docId' };
  }

  try {
    const res = await executeAtomicStatsBulkDelete(db, 'reports', [{ id: docId, data: reportData }]);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic report delete succeeded for ${docId}`);
    return { success: res.success, docId, collection: 'reports', deletedCount: res.deletedCount, error: res.error };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic report delete failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'reports', error: err?.message || String(err) };
  }
}

/**
 * ─── 3. ATOMIC WRITE / UPDATE: 'bugs' COLLECTION (Luồng C) ───
 */
export async function executeAtomicBugWrite(
  db: Firestore,
  docId: string,
  bugData: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !bugData) {
    return { success: false, docId, collection: 'bugs', error: 'Missing db instance, docId, or bug payload' };
  }

  try {
    await executeIdempotentStatsWrite(db, 'bugs', docId, bugData, bugContributions);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic bug write succeeded for ${docId}`);
    return { success: true, docId, collection: 'bugs' };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic bug write failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'bugs', error: err?.message || String(err) };
  }
}

/**
 * ─── 4. ATOMIC DELETE: 'bugs' COLLECTION ───
 */
export async function executeAtomicBugDelete(
  db: Firestore,
  docId: string,
  bugData?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId) {
    return { success: false, docId, collection: 'bugs', error: 'Missing db or docId' };
  }

  try {
    const res = await executeAtomicStatsBulkDelete(db, 'bugs', [{ id: docId, data: bugData }]);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic bug delete succeeded for ${docId}`);
    return { success: res.success, docId, collection: 'bugs', deletedCount: res.deletedCount, error: res.error };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic bug delete failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'bugs', error: err?.message || String(err) };
  }
}

/**
 * ─── 5. ATOMIC WRITE / UPDATE: 'seg_reports' (SESSIONS / PATHOLOGY) COLLECTION (Luồng B) ───
 */
export async function executeAtomicPathologyWrite(
  db: Firestore,
  docId: string,
  logData: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !logData) {
    return { success: false, docId, collection: 'seg_reports', error: 'Missing db, docId, or payload' };
  }

  try {
    await executeIdempotentStatsWrite(db, 'seg_reports', docId, logData, pathologyContributions);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic pathology session write succeeded for ${docId}`);
    return { success: true, docId, collection: 'seg_reports' };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic pathology session write failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'seg_reports', error: err?.message || String(err) };
  }
}

/**
 * ─── 6. ATOMIC DELETE: 'seg_reports' COLLECTION ───
 */
export async function executeAtomicPathologyDelete(
  db: Firestore,
  docId: string,
  logData?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId) {
    return { success: false, docId, collection: 'seg_reports', error: 'Missing db or docId' };
  }

  try {
    const res = await executeAtomicStatsBulkDelete(db, 'seg_reports', [{ id: docId, data: logData }]);
    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic pathology delete succeeded for ${docId}`);
    return { success: res.success, docId, collection: 'seg_reports', deletedCount: res.deletedCount, error: res.error };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic pathology delete failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'seg_reports', error: err?.message || String(err) };
  }
}

/**
 * ─── 7. ATOMIC BULK DELETE ───
 */
export async function executeAtomicBulkDelete(
  db: Firestore,
  collectionName: 'reports' | 'bugs' | 'seg_reports',
  itemsToDelete: Array<{ id: string; data?: any }>
): Promise<AtomicOperationResult> {
  if (!db || !itemsToDelete || itemsToDelete.length === 0) {
    return { success: true, collection: collectionName, deletedCount: 0 };
  }

  try {
    const res = await executeAtomicStatsBulkDelete(db, collectionName, itemsToDelete);
    return { success: res.success, collection: collectionName, deletedCount: res.deletedCount, error: res.error };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic bulk delete failed for ${collectionName}: ${err?.message || err}`);
    return { success: false, collection: collectionName, error: err?.message || String(err) };
  }
}
