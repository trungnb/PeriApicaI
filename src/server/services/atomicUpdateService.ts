export const LEGACY_COLLECTION = 'system_metrics';
import { recalculateAndPersistSystemMetadata } from './systemMetadataService';
import { Firestore } from 'firebase-admin/firestore';
import { serverLog } from "../config/env";
import { FieldValue } from "firebase-admin/firestore";
/**
 * Centralized Atomic Update Utility Service for Firestore
 * Forces an atomic update pattern (using Firestore batched writes)
 * for any operation affecting 'reports', 'bugs', or 'seg_reports' (sessions),
 * ensuring the 'system_metadata/dashboard' document is always perfectly
 * synchronized with the true state of the collections.
 */
import { METADATA_COLLECTION, METADATA_DOC_ID } from './systemMetadataService';
import { determineAccuracyCategory, isLogIncompleteHelper, isLogErrorHelper, getDateKeyFromLog } from '../utils/metadataHelpers';

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
  logData: any,
  isNew: boolean = true,
  prevLog?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !logData) {
    return { success: false, docId, collection: 'reports', error: 'Missing database instance, docId, or log payload' };
  }

  const dateKey = getDateKeyFromLog(logData);
  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const reportRef = db.collection('reports').doc(docId);

  try {
    const metaUpdates: Record<string, any> = {};

    if (isNew) {
      metaUpdates['reports.totalSessions'] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.reports.totalSessions`] = FieldValue.increment(1);

      const isInvalid = isLogErrorHelper(logData);
      const isIncomplete = isLogIncompleteHelper(logData);
      const isCompleted = !isInvalid && !isIncomplete;

      if (isInvalid) {
        metaUpdates['reports.invalidImageCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.reports.invalidImageCount`] = FieldValue.increment(1);
      } else if (isIncomplete) {
        metaUpdates['reports.incompleteCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.reports.incompleteCount`] = FieldValue.increment(1);
      } else if (isCompleted) {
        metaUpdates['reports.completedCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.reports.completedCount`] = FieldValue.increment(1);

        const accCategory = determineAccuracyCategory(logData);
        metaUpdates[`reports.accuracyCounts.${accCategory}`] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.reports.accuracyCounts.${accCategory}`] = FieldValue.increment(1);

        (logData.finalConfirmedErrors || []).forEach((key: string) => {
          if (key && key !== 'not_periapical') {
            metaUpdates[`reports.errorDistribution.${key}`] = FieldValue.increment(1);
            metaUpdates[`dailyStats.${dateKey}.reports.errorDistribution.${key}`] = FieldValue.increment(1);
          }
        });
      }
    } else if (prevLog) {
      const prevInvalid = isLogErrorHelper(prevLog);
      const prevIncomplete = isLogIncompleteHelper(prevLog);
      const prevCompleted = !prevInvalid && !prevIncomplete;

      const currInvalid = isLogErrorHelper(logData);
      const currIncomplete = isLogIncompleteHelper(logData);
      const currCompleted = !currInvalid && !currIncomplete;

      if (prevInvalid !== currInvalid) {
        metaUpdates['reports.invalidImageCount'] = FieldValue.increment(currInvalid ? 1 : -1);
        metaUpdates[`dailyStats.${dateKey}.reports.invalidImageCount`] = FieldValue.increment(currInvalid ? 1 : -1);
      }
      if (prevIncomplete !== currIncomplete) {
        metaUpdates['reports.incompleteCount'] = FieldValue.increment(currIncomplete ? 1 : -1);
        metaUpdates[`dailyStats.${dateKey}.reports.incompleteCount`] = FieldValue.increment(currIncomplete ? 1 : -1);
      }
      if (prevCompleted !== currCompleted) {
        metaUpdates['reports.completedCount'] = FieldValue.increment(currCompleted ? 1 : -1);
        metaUpdates[`dailyStats.${dateKey}.reports.completedCount`] = FieldValue.increment(currCompleted ? 1 : -1);
      }

      const prevAcc = determineAccuracyCategory(prevLog);
      const currAcc = determineAccuracyCategory(logData);
      if (prevAcc !== currAcc) {
        if (prevCompleted) {
          metaUpdates[`reports.accuracyCounts.${prevAcc}`] = FieldValue.increment(-1);
          metaUpdates[`dailyStats.${dateKey}.reports.accuracyCounts.${prevAcc}`] = FieldValue.increment(-1);
        }
        if (currCompleted) {
          metaUpdates[`reports.accuracyCounts.${currAcc}`] = FieldValue.increment(1);
          metaUpdates[`dailyStats.${dateKey}.reports.accuracyCounts.${currAcc}`] = FieldValue.increment(1);
        }
      }

      const prevErrors = new Set(prevLog.finalConfirmedErrors || []);
      const currErrors = new Set(logData.finalConfirmedErrors || []);

      prevErrors.forEach((k: any) => {
        if (!currErrors.has(k) && k !== 'not_periapical') {
          metaUpdates[`reports.errorDistribution.${k}`] = FieldValue.increment(-1);
          metaUpdates[`dailyStats.${dateKey}.reports.errorDistribution.${k}`] = FieldValue.increment(-1);
        }
      });
      currErrors.forEach((k: any) => {
        if (!prevErrors.has(k) && k !== 'not_periapical') {
          metaUpdates[`reports.errorDistribution.${k}`] = FieldValue.increment(1);
          metaUpdates[`dailyStats.${dateKey}.reports.errorDistribution.${k}`] = FieldValue.increment(1);
        }
      });
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(reportRef, logData, { merge: true });
    if (Object.keys(metaUpdates).length > 0) {
      batch.set(metadataRef, metaUpdates, { merge: true });
      batch.set(legacyMetaRef, metaUpdates, { merge: true });
    }
    await batch.commit();

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
  logData?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId) {
    return { success: false, docId, collection: 'reports', error: 'Missing db or docId' };
  }

  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const reportRef = db.collection('reports').doc(docId);

  try {
    let log = logData;
    if (!log) {
      const snap = await reportRef.get();
      if (snap.exists) log = snap.data();
    }

    const metaUpdates: Record<string, any> = {
      'reports.totalSessions': FieldValue.increment(-1),
    };

    if (log) {
      const dateKey = getDateKeyFromLog(log);
      metaUpdates[`dailyStats.${dateKey}.reports.totalSessions`] = FieldValue.increment(-1);

      const isInvalid = isLogErrorHelper(log);
      const isIncomplete = isLogIncompleteHelper(log);
      const isCompleted = !isInvalid && !isIncomplete;

      if (isInvalid) {
        metaUpdates['reports.invalidImageCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.reports.invalidImageCount`] = FieldValue.increment(-1);
      } else if (isIncomplete) {
        metaUpdates['reports.incompleteCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.reports.incompleteCount`] = FieldValue.increment(-1);
      } else if (isCompleted) {
        metaUpdates['reports.completedCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.reports.completedCount`] = FieldValue.increment(-1);

        const accCategory = determineAccuracyCategory(log);
        metaUpdates[`reports.accuracyCounts.${accCategory}`] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.reports.accuracyCounts.${accCategory}`] = FieldValue.increment(-1);

        (log.finalConfirmedErrors || []).forEach((key: string) => {
          if (key && key !== 'not_periapical') {
            metaUpdates[`reports.errorDistribution.${key}`] = FieldValue.increment(-1);
            metaUpdates[`dailyStats.${dateKey}.reports.errorDistribution.${key}`] = FieldValue.increment(-1);
          }
        });
      }
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.delete(reportRef);
    batch.set(metadataRef, metaUpdates, { merge: true });
    batch.set(legacyMetaRef, metaUpdates, { merge: true });
    await batch.commit();

    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic report delete succeeded for ${docId}`);
    return { success: true, docId, collection: 'reports', deletedCount: 1 };
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
  bugData: any,
  isNew: boolean = true,
  prevBug?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !bugData) {
    return { success: false, docId, collection: 'bugs', error: 'Missing db instance, docId, or bug payload' };
  }

  const dateKey = getDateKeyFromLog(bugData);
  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const bugRef = db.collection('bugs').doc(docId);

  try {
    const metaUpdates: Record<string, any> = {};

    if (isNew) {
      metaUpdates['bugs.totalBugs'] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.bugs.totalBugs`] = FieldValue.increment(1);

      const sev = (bugData.severity || 'medium').toLowerCase();
      metaUpdates[`bugs.severityDistribution.${sev}`] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.bugs.severityDistribution.${sev}`] = FieldValue.increment(1);

      const src = (bugData.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
      metaUpdates[`bugs.sourceDistribution.${src}`] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.bugs.sourceDistribution.${src}`] = FieldValue.increment(1);

      const st = (bugData.status || 'OPEN').toUpperCase();
      metaUpdates[`bugs.statusDistribution.${st}`] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.bugs.statusDistribution.${st}`] = FieldValue.increment(1);
    } else if (prevBug) {
      const prevSev = (prevBug.severity || 'medium').toLowerCase();
      const currSev = (bugData.severity || 'medium').toLowerCase();
      if (prevSev !== currSev) {
        metaUpdates[`bugs.severityDistribution.${prevSev}`] = FieldValue.increment(-1);
        metaUpdates[`bugs.severityDistribution.${currSev}`] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.bugs.severityDistribution.${prevSev}`] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.bugs.severityDistribution.${currSev}`] = FieldValue.increment(1);
      }

      const prevSrc = (prevBug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
      const currSrc = (bugData.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
      if (prevSrc !== currSrc) {
        metaUpdates[`bugs.sourceDistribution.${prevSrc}`] = FieldValue.increment(-1);
        metaUpdates[`bugs.sourceDistribution.${currSrc}`] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.bugs.sourceDistribution.${prevSrc}`] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.bugs.sourceDistribution.${currSrc}`] = FieldValue.increment(1);
      }

      const prevSt = (prevBug.status || 'OPEN').toUpperCase();
      const currSt = (bugData.status || 'OPEN').toUpperCase();
      if (prevSt !== currSt) {
        metaUpdates[`bugs.statusDistribution.${prevSt}`] = FieldValue.increment(-1);
        metaUpdates[`bugs.statusDistribution.${currSt}`] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.bugs.statusDistribution.${prevSt}`] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.bugs.statusDistribution.${currSt}`] = FieldValue.increment(1);
      }
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(bugRef, bugData, { merge: true });
    if (Object.keys(metaUpdates).length > 0) {
      batch.set(metadataRef, metaUpdates, { merge: true });
      batch.set(legacyMetaRef, metaUpdates, { merge: true });
    }
    await batch.commit();

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

  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const bugRef = db.collection('bugs').doc(docId);

  try {
    let bug = bugData;
    if (!bug) {
      const snap = await bugRef.get();
      if (snap.exists) bug = snap.data();
    }

    const metaUpdates: Record<string, any> = {
      'bugs.totalBugs': FieldValue.increment(-1),
    };

    if (bug) {
      const dateKey = getDateKeyFromLog(bug);
      metaUpdates[`dailyStats.${dateKey}.bugs.totalBugs`] = FieldValue.increment(-1);

      const sev = (bug.severity || 'medium').toLowerCase();
      metaUpdates[`bugs.severityDistribution.${sev}`] = FieldValue.increment(-1);
      metaUpdates[`dailyStats.${dateKey}.bugs.severityDistribution.${sev}`] = FieldValue.increment(-1);

      const src = (bug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
      metaUpdates[`bugs.sourceDistribution.${src}`] = FieldValue.increment(-1);
      metaUpdates[`dailyStats.${dateKey}.bugs.sourceDistribution.${src}`] = FieldValue.increment(-1);

      const st = (bug.status || 'OPEN').toUpperCase();
      metaUpdates[`bugs.statusDistribution.${st}`] = FieldValue.increment(-1);
      metaUpdates[`dailyStats.${dateKey}.bugs.statusDistribution.${st}`] = FieldValue.increment(-1);
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.delete(bugRef);
    batch.set(metadataRef, metaUpdates, { merge: true });
    batch.set(legacyMetaRef, metaUpdates, { merge: true });
    await batch.commit();

    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic bug delete succeeded for ${docId}`);
    return { success: true, docId, collection: 'bugs', deletedCount: 1 };
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
  logData: any,
  isNew: boolean = true,
  prevLog?: any
): Promise<AtomicOperationResult> {
  if (!db || !docId || !logData) {
    return { success: false, docId, collection: 'seg_reports', error: 'Missing db, docId, or payload' };
  }

  const dateKey = getDateKeyFromLog(logData);
  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const pathRef = db.collection('seg_reports').doc(docId);

  try {
    const metaUpdates: Record<string, any> = {};

    if (isNew) {
      metaUpdates['pathology.totalPathologyLogs'] = FieldValue.increment(1);
      metaUpdates[`dailyStats.${dateKey}.pathology.totalPathologyLogs`] = FieldValue.increment(1);

      const isCompleted = logData.sessionStatus === 'COMPLETED' || logData.lastCompletedStep === 5 || (logData.stage || '').includes('Bước 5');
      const isInvalid = logData.sessionStatus === 'FAILED_NON_DENTAL';

      if (isInvalid) {
        metaUpdates['pathology.invalidImageCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.pathology.invalidImageCount`] = FieldValue.increment(1);
      } else if (isCompleted) {
        metaUpdates['pathology.completedCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.pathology.completedCount`] = FieldValue.increment(1);
      } else {
        metaUpdates['pathology.incompleteCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.pathology.incompleteCount`] = FieldValue.increment(1);
      }

      const isVerified = Boolean(logData.isReviewedByAdmin || logData.verifiedBy);
      if (isVerified) {
        metaUpdates['pathology.verifiedCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.pathology.verifiedCount`] = FieldValue.increment(1);
      } else {
        metaUpdates['pathology.unverifiedCount'] = FieldValue.increment(1);
        metaUpdates[`dailyStats.${dateKey}.pathology.unverifiedCount`] = FieldValue.increment(1);
      }

      const paths = logData.finalConfirmedPathologies || logData.confirmedPathologies || logData.detectedPathologies || [];
      paths.forEach((p: any) => {
        const key = p.key || p.label;
        if (key) {
          metaUpdates[`pathology.pathologyDistribution.${key}`] = FieldValue.increment(1);
          metaUpdates[`dailyStats.${dateKey}.pathology.pathologyDistribution.${key}`] = FieldValue.increment(1);
        }
      });

      if (logData.tooth?.fdiNumber) {
        const fdi = String(logData.tooth.fdiNumber);
        metaUpdates[`pathology.toothDistribution.${fdi}`] = FieldValue.increment(1);
      }
    } else if (prevLog) {
      const prevVerified = Boolean(prevLog.isReviewedByAdmin || prevLog.verifiedBy);
      const currVerified = Boolean(logData.isReviewedByAdmin || logData.verifiedBy);
      if (prevVerified !== currVerified) {
        metaUpdates['pathology.verifiedCount'] = FieldValue.increment(currVerified ? 1 : -1);
        metaUpdates['pathology.unverifiedCount'] = FieldValue.increment(currVerified ? -1 : 1);
        metaUpdates[`dailyStats.${dateKey}.pathology.verifiedCount`] = FieldValue.increment(currVerified ? 1 : -1);
        metaUpdates[`dailyStats.${dateKey}.pathology.unverifiedCount`] = FieldValue.increment(currVerified ? -1 : 1);
      }

      const prevCompleted = prevLog.sessionStatus === 'COMPLETED' || prevLog.lastCompletedStep === 5 || (prevLog.stage || '').includes('Bước 5');
      const currCompleted = logData.sessionStatus === 'COMPLETED' || logData.lastCompletedStep === 5 || (logData.stage || '').includes('Bước 5');
      if (prevCompleted !== currCompleted) {
        metaUpdates['pathology.completedCount'] = FieldValue.increment(currCompleted ? 1 : -1);
        metaUpdates['pathology.incompleteCount'] = FieldValue.increment(currCompleted ? -1 : 1);
        metaUpdates[`dailyStats.${dateKey}.pathology.completedCount`] = FieldValue.increment(currCompleted ? 1 : -1);
        metaUpdates[`dailyStats.${dateKey}.pathology.incompleteCount`] = FieldValue.increment(currCompleted ? -1 : 1);
      }
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(pathRef, logData, { merge: true });
    if (Object.keys(metaUpdates).length > 0) {
      batch.set(metadataRef, metaUpdates, { merge: true });
      batch.set(legacyMetaRef, metaUpdates, { merge: true });
    }
    await batch.commit();

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

  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
  const pathRef = db.collection('seg_reports').doc(docId);

  try {
    let log = logData;
    if (!log) {
      const snap = await pathRef.get();
      if (snap.exists) log = snap.data();
    }

    const metaUpdates: Record<string, any> = {
      'pathology.totalPathologyLogs': FieldValue.increment(-1),
    };

    if (log) {
      const dateKey = getDateKeyFromLog(log);
      metaUpdates[`dailyStats.${dateKey}.pathology.totalPathologyLogs`] = FieldValue.increment(-1);

      const isCompleted = log.sessionStatus === 'COMPLETED' || log.lastCompletedStep === 5 || (log.stage || '').includes('Bước 5');
      const isInvalid = log.sessionStatus === 'FAILED_NON_DENTAL';

      if (isInvalid) {
        metaUpdates['pathology.invalidImageCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.pathology.invalidImageCount`] = FieldValue.increment(-1);
      } else if (isCompleted) {
        metaUpdates['pathology.completedCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.pathology.completedCount`] = FieldValue.increment(-1);
      } else {
        metaUpdates['pathology.incompleteCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.pathology.incompleteCount`] = FieldValue.increment(-1);
      }

      const isVerified = Boolean(log.isReviewedByAdmin || log.verifiedBy);
      if (isVerified) {
        metaUpdates['pathology.verifiedCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.pathology.verifiedCount`] = FieldValue.increment(-1);
      } else {
        metaUpdates['pathology.unverifiedCount'] = FieldValue.increment(-1);
        metaUpdates[`dailyStats.${dateKey}.pathology.unverifiedCount`] = FieldValue.increment(-1);
      }

      const paths = log.finalConfirmedPathologies || log.confirmedPathologies || log.detectedPathologies || [];
      paths.forEach((p: any) => {
        const key = p.key || p.label;
        if (key) {
          metaUpdates[`pathology.pathologyDistribution.${key}`] = FieldValue.increment(-1);
          metaUpdates[`dailyStats.${dateKey}.pathology.pathologyDistribution.${key}`] = FieldValue.increment(-1);
        }
      });

      if (log.tooth?.fdiNumber) {
        const fdi = String(log.tooth.fdiNumber);
        metaUpdates[`pathology.toothDistribution.${fdi}`] = FieldValue.increment(-1);
      }
    }

    metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
    metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.delete(pathRef);
    batch.set(metadataRef, metaUpdates, { merge: true });
    batch.set(legacyMetaRef, metaUpdates, { merge: true });
    await batch.commit();

    serverLog('INFO', 'AtomicUpdateService', `✅ Atomic pathology session delete succeeded for ${docId}`);
    return { success: true, docId, collection: 'seg_reports', deletedCount: 1 };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Atomic pathology session delete failed for ${docId}: ${err?.message || err}`);
    return { success: false, docId, collection: 'seg_reports', error: err?.message || String(err) };
  }
}

/**
 * ─── 7. BULK ATOMIC DELETE FOR ANY COLLECTION ───
 */
export async function executeAtomicBulkDelete(
  db: Firestore,
  collectionName: 'reports' | 'bugs' | 'seg_reports',
  itemsToDelete: Array<{ id: string; data?: any }>
): Promise<AtomicOperationResult> {
  if (!db || !itemsToDelete || itemsToDelete.length === 0) {
    return { success: true, collection: collectionName, deletedCount: 0 };
  }

  const metadataRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
  const legacyMetaRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);

  try {
    // Process items in chunks of 450 to stay comfortably within Firestore 500 ops batch limit
    const chunkSize = 450;
    let deletedCount = 0;

    for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
      const chunk = itemsToDelete.slice(i, i + chunkSize);
      const batch = db.batch();
      const metaUpdates: Record<string, any> = {};

      if (collectionName === 'reports') {
        metaUpdates['reports.totalSessions'] = FieldValue.increment(-chunk.length);
        chunk.forEach(({ id, data }) => {
          batch.delete(db.collection('reports').doc(id));
          if (data) {
            const dateKey = getDateKeyFromLog(data);
            metaUpdates[`dailyStats.${dateKey}.reports.totalSessions`] = FieldValue.increment(-1);

            const isInvalid = isLogErrorHelper(data);
            const isIncomplete = isLogIncompleteHelper(data);
            const isCompleted = !isInvalid && !isIncomplete;

            if (isInvalid) {
              metaUpdates['reports.invalidImageCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.reports.invalidImageCount`] = FieldValue.increment(-1);
            } else if (isIncomplete) {
              metaUpdates['reports.incompleteCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.reports.incompleteCount`] = FieldValue.increment(-1);
            } else if (isCompleted) {
              metaUpdates['reports.completedCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.reports.completedCount`] = FieldValue.increment(-1);

              const accCategory = determineAccuracyCategory(data);
              metaUpdates[`reports.accuracyCounts.${accCategory}`] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.reports.accuracyCounts.${accCategory}`] = FieldValue.increment(-1);

              (data.finalConfirmedErrors || []).forEach((key: string) => {
                if (key && key !== 'not_periapical') {
                  metaUpdates[`reports.errorDistribution.${key}`] = FieldValue.increment(-1);
                  metaUpdates[`dailyStats.${dateKey}.reports.errorDistribution.${key}`] = FieldValue.increment(-1);
                }
              });
            }
          }
        });
      } else if (collectionName === 'bugs') {
        metaUpdates['bugs.totalBugs'] = FieldValue.increment(-chunk.length);
        chunk.forEach(({ id, data }) => {
          batch.delete(db.collection('bugs').doc(id));
          if (data) {
            const dateKey = getDateKeyFromLog(data);
            metaUpdates[`dailyStats.${dateKey}.bugs.totalBugs`] = FieldValue.increment(-1);

            const sev = (data.severity || 'medium').toLowerCase();
            metaUpdates[`bugs.severityDistribution.${sev}`] = FieldValue.increment(-1);
            metaUpdates[`dailyStats.${dateKey}.bugs.severityDistribution.${sev}`] = FieldValue.increment(-1);

            const src = (data.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
            metaUpdates[`bugs.sourceDistribution.${src}`] = FieldValue.increment(-1);
            metaUpdates[`dailyStats.${dateKey}.bugs.sourceDistribution.${src}`] = FieldValue.increment(-1);

            const st = (data.status || 'OPEN').toUpperCase();
            metaUpdates[`bugs.statusDistribution.${st}`] = FieldValue.increment(-1);
            metaUpdates[`dailyStats.${dateKey}.bugs.statusDistribution.${st}`] = FieldValue.increment(-1);
          }
        });
      } else if (collectionName === 'seg_reports') {
        metaUpdates['pathology.totalPathologyLogs'] = FieldValue.increment(-chunk.length);
        chunk.forEach(({ id, data }) => {
          batch.delete(db.collection('seg_reports').doc(id));
          if (data) {
            const dateKey = getDateKeyFromLog(data);
            metaUpdates[`dailyStats.${dateKey}.pathology.totalPathologyLogs`] = FieldValue.increment(-1);

            const isCompleted = data.sessionStatus === 'COMPLETED' || data.lastCompletedStep === 5 || (data.stage || '').includes('Bước 5');
            const isInvalid = data.sessionStatus === 'FAILED_NON_DENTAL';

            if (isInvalid) {
              metaUpdates['pathology.invalidImageCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.pathology.invalidImageCount`] = FieldValue.increment(-1);
            } else if (isCompleted) {
              metaUpdates['pathology.completedCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.pathology.completedCount`] = FieldValue.increment(-1);
            } else {
              metaUpdates['pathology.incompleteCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.pathology.incompleteCount`] = FieldValue.increment(-1);
            }

            const isVerified = Boolean(data.isReviewedByAdmin || data.verifiedBy);
            if (isVerified) {
              metaUpdates['pathology.verifiedCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.pathology.verifiedCount`] = FieldValue.increment(-1);
            } else {
              metaUpdates['pathology.unverifiedCount'] = FieldValue.increment(-1);
              metaUpdates[`dailyStats.${dateKey}.pathology.unverifiedCount`] = FieldValue.increment(-1);
            }

            const paths = data.finalConfirmedPathologies || data.confirmedPathologies || data.detectedPathologies || [];
            paths.forEach((p: any) => {
              const key = p.key || p.label;
              if (key) {
                metaUpdates[`pathology.pathologyDistribution.${key}`] = FieldValue.increment(-1);
                metaUpdates[`dailyStats.${dateKey}.pathology.pathologyDistribution.${key}`] = FieldValue.increment(-1);
              }
            });

            if (data.tooth?.fdiNumber) {
              const fdi = String(data.tooth.fdiNumber);
              metaUpdates[`pathology.toothDistribution.${fdi}`] = FieldValue.increment(-1);
            }
          }
        });
      }

      metaUpdates['lastRecalculatedAt'] = new Date().toISOString();
      metaUpdates['lastUpdatedAt'] = FieldValue.serverTimestamp();

      batch.set(metadataRef, metaUpdates, { merge: true });
      batch.set(legacyMetaRef, metaUpdates, { merge: true });

      await batch.commit();
      deletedCount += chunk.length;
    }

    serverLog('INFO', 'AtomicUpdateService', `✅ Bulk atomic delete completed for ${deletedCount} docs in ${collectionName}`);
    return { success: true, collection: collectionName, deletedCount };
  } catch (err: any) {
    serverLog('ERROR', 'AtomicUpdateService', `❌ Bulk atomic delete failed for ${collectionName}: ${err?.message || err}`);
    return { success: false, collection: collectionName, error: err?.message || String(err) };
  }
}

/**
 * ─── 8. SYNCHRONIZATION INTEGRITY CHECKER ───
 * Audits and ensures 100% synchronization between collection states and system_metadata
 */
export async function verifyAndEnsureMetadataSync(db: Firestore): Promise<void> {
  if (!db) return;
  try {
    await recalculateAndPersistSystemMetadata(db);
    serverLog('INFO', 'AtomicUpdateService', '✅ Sync verification completed — system_metadata document fully reconciled');
  } catch (err: any) {
    serverLog('WARN', 'AtomicUpdateService', 'Failed to verify metadata sync:', err?.message || err);
  }
}
