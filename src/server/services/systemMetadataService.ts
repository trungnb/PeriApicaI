/**
 * Unified System Metadata & Metrics Service
 * Manages the single 'system_metadata' document in Firestore with atomic increments/decrements
 * across all write operations to reports, bugs, and sessions (seg_reports).
 */
import { determineAccuracyCategory, isLogIncompleteHelper, isLogErrorHelper, parseTimestampToMsHelper, getDateKeyFromLog } from '../utils/metadataHelpers';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from './firebaseService';
import { serverLog } from '../config/env';
import { SystemMetadata } from '../../types/dental';

export const METADATA_COLLECTION = 'system_metadata';
export const METADATA_DOC_ID = 'dashboard';
export const LEGACY_COLLECTION = 'system_metrics';

/**
 * Categorize report accuracy based on accuracy score text or user validation
 */





/**
 * Synchronous calculation of full system metadata from array lists
 */
export function computeSystemMetadata(
  reports: any[] = [],
  segReports: any[] = [],
  bugs: any[] = []
): SystemMetadata {
  const dailyStats: Record<string, any> = {};

  const getOrCreateDaily = (dateKey: string) => {
    if (!dailyStats[dateKey]) {
      dailyStats[dateKey] = {
        reports: {
          totalSessions: 0,
          completedCount: 0,
          incompleteCount: 0,
          invalidImageCount: 0,
          accuracyCounts: { EXACT_MATCH: 0, MOSTLY_ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 },
          errorDistribution: {},
        },
        pathology: {
          totalPathologyLogs: 0,
          completedCount: 0,
          incompleteCount: 0,
          invalidImageCount: 0,
          verifiedCount: 0,
          unverifiedCount: 0,
          pathologyDistribution: {},
        },
        bugs: {
          totalBugs: 0,
          severityDistribution: { low: 0, medium: 0, high: 0, critical: 0, info: 0 },
          sourceDistribution: { USER_SUBMITTED: 0, SYSTEM_AUTO: 0 },
          statusDistribution: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 },
        },
      };
    }
    return dailyStats[dateKey];
  };

  // ─── STREAM A: Image Quality Reports ──────────────────────
  const totalSessions = reports.length;
  let completedCount = 0;
  let incompleteCount = 0;
  let invalidImageCount = 0;
  const accuracyCounts = {
    EXACT_MATCH: 0,
    MOSTLY_ACCURATE: 0,
    PARTIALLY_ACCURATE: 0,
    INACCURATE: 0,
  };
  const errorDistribution: Record<string, number> = {};
  const userMap: Record<string, { totalSessions: number; completedSessions: number; lastActive: string; lastTooth: string; rawMs: number }> = {};
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let todayUsersCount = 0;
  const seenTodayUsers = new Set<string>();

  reports.forEach((log) => {
    const isInvalid = isLogErrorHelper(log);
    const isIncomplete = isLogIncompleteHelper(log);
    const isCompleted = !isInvalid && !isIncomplete;

    const dateKey = getDateKeyFromLog(log);
    const daily = getOrCreateDaily(dateKey);
    daily.reports.totalSessions++;

    if (isInvalid) {
      invalidImageCount++;
      daily.reports.invalidImageCount++;
    } else if (isIncomplete) {
      incompleteCount++;
      daily.reports.incompleteCount++;
    } else {
      completedCount++;
      daily.reports.completedCount++;
    }

    if (isCompleted) {
      const category = determineAccuracyCategory(log);
      accuracyCounts[category]++;
      daily.reports.accuracyCounts[category]++;

      (log.finalConfirmedErrors || []).forEach((key: string) => {
        if (key && key !== 'not_periapical') {
          errorDistribution[key] = (errorDistribution[key] || 0) + 1;
          daily.reports.errorDistribution[key] = (daily.reports.errorDistribution[key] || 0) + 1;
        }
      });
    }

    const uid = log.userId || 'Người dùng ẩn danh';
    const toothDisplay = log.tooth?.fdiNumber ? `Răng ${log.tooth.fdiNumber}` : 'N/A';
    const logMs = parseTimestampToMsHelper(log.timestamp, log.updatedAt, log.createdAt);

    if (!userMap[uid]) {
      userMap[uid] = {
        totalSessions: 0,
        completedSessions: 0,
        lastActive: log.timestamp || '',
        lastTooth: toothDisplay,
        rawMs: logMs,
      };
    }
    userMap[uid].totalSessions += 1;
    if (isCompleted) userMap[uid].completedSessions += 1;
    if (logMs > userMap[uid].rawMs) {
      userMap[uid].rawMs = logMs;
      userMap[uid].lastActive = log.timestamp || '';
      userMap[uid].lastTooth = toothDisplay;
    }
    if (logMs >= todayStart && !seenTodayUsers.has(uid)) {
      seenTodayUsers.add(uid);
      todayUsersCount++;
    }
  });

  const uniqueUsersList = Object.entries(userMap).map(([userId, data]) => ({
    userId,
    ...data,
  }));

  // ─── STREAM B: Pathology Reports ──────────────────────────
  const totalPathologyLogs = segReports.length;
  let pathologyCompleted = 0;
  let pathologyIncomplete = 0;
  let pathologyInvalid = 0;
  let verifiedCount = 0;
  let unverifiedCount = 0;
  const pathologyDistribution: Record<string, number> = {};
  const toothDistribution: Record<string, number> = {};
  const pathologyUserMap = new Map<string, { deviceId: string; totalUploads: number; lastActive: string; firstActive: string }>();

  segReports.forEach((l) => {
    const isCompleted = l.sessionStatus === 'COMPLETED' || l.lastCompletedStep === 5 || (l.stage || '').includes('Bước 5');
    const isInvalid = l.sessionStatus === 'FAILED_NON_DENTAL';

    const dateKey = getDateKeyFromLog(l);
    const daily = getOrCreateDaily(dateKey);
    daily.pathology.totalPathologyLogs++;

    if (isInvalid) {
      pathologyInvalid++;
      daily.pathology.invalidImageCount++;
    } else if (isCompleted) {
      pathologyCompleted++;
      daily.pathology.completedCount++;
    } else {
      pathologyIncomplete++;
      daily.pathology.incompleteCount++;
    }

    const isVerified = Boolean(l.isReviewedByAdmin || l.verifiedBy);
    if (isVerified) {
      verifiedCount++;
      daily.pathology.verifiedCount++;
    } else {
      unverifiedCount++;
      daily.pathology.unverifiedCount++;
    }

    const paths = l.finalConfirmedPathologies || l.confirmedPathologies || l.detectedPathologies || [];
    paths.forEach((p: any) => {
      const key = p.key || p.label;
      if (key) {
        pathologyDistribution[key] = (pathologyDistribution[key] || 0) + 1;
        daily.pathology.pathologyDistribution[key] = (daily.pathology.pathologyDistribution[key] || 0) + 1;
      }
    });

    if (l.tooth?.fdiNumber) {
      const fdi = String(l.tooth.fdiNumber);
      toothDistribution[fdi] = (toothDistribution[fdi] || 0) + 1;
    }

    const devId = l.deviceId || l.userId || (l.assessmentId ? l.assessmentId.substring(0, 8) : 'N/A');
    const existing = pathologyUserMap.get(devId);
    if (existing) {
      existing.totalUploads += 1;
      if (l.timestamp > existing.lastActive) existing.lastActive = l.timestamp;
      if (l.timestamp < existing.firstActive) existing.firstActive = l.timestamp;
    } else {
      pathologyUserMap.set(devId, {
        deviceId: devId,
        totalUploads: 1,
        lastActive: l.timestamp || '',
        firstActive: l.timestamp || '',
      });
    }
  });

  // ─── STREAM C: Bug Reports ────────────────────────────────
  const totalBugs = bugs.length;
  const severityDistribution: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
    info: 0,
  };
  const sourceDistribution = {
    USER_SUBMITTED: 0,
    SYSTEM_AUTO: 0,
  };
  const statusDistribution = {
    OPEN: 0,
    IN_PROGRESS: 0,
    RESOLVED: 0,
    CLOSED: 0,
  };

  bugs.forEach((b) => {
    const dateKey = getDateKeyFromLog(b);
    const daily = getOrCreateDaily(dateKey);
    daily.bugs.totalBugs++;

    const sev = (b.severity || 'medium').toLowerCase();
    if (sev in severityDistribution) {
      severityDistribution[sev]++;
      daily.bugs.severityDistribution[sev] = (daily.bugs.severityDistribution[sev] || 0) + 1;
    } else {
      severityDistribution.medium++;
      daily.bugs.severityDistribution.medium = (daily.bugs.severityDistribution.medium || 0) + 1;
    }

    const src = (b.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
    sourceDistribution[src]++;
    daily.bugs.sourceDistribution[src]++;

    const st = (b.status || 'OPEN').toUpperCase();
    if (st in statusDistribution) {
      (statusDistribution as any)[st]++;
      daily.bugs.statusDistribution[st] = (daily.bugs.statusDistribution[st] || 0) + 1;
    } else {
      statusDistribution.OPEN++;
      daily.bugs.statusDistribution.OPEN = (daily.bugs.statusDistribution.OPEN || 0) + 1;
    }
  });

  return {
    reports: {
      totalSessions,
      completedCount,
      incompleteCount,
      invalidImageCount,
      accuracyCounts,
      errorDistribution,
      uniqueUsersCount: uniqueUsersList.length,
      todayUsersCount,
      userList: uniqueUsersList.slice(0, 100),
    },
    pathology: {
      totalPathologyLogs,
      completedCount: pathologyCompleted,
      incompleteCount: pathologyIncomplete,
      invalidImageCount: pathologyInvalid,
      verifiedCount,
      unverifiedCount,
      pathologyDistribution,
      toothDistribution,
      uniqueUsersCount: pathologyUserMap.size,
      todayUsersCount: 0,
      userList: Array.from(pathologyUserMap.values()).slice(0, 100),
    },
    bugs: {
      totalBugs,
      severityDistribution: severityDistribution as any,
      sourceDistribution,
      statusDistribution,
    },
    dailyStats,
    lastRecalculatedAt: new Date().toISOString(),
  };
}


/**
 * Apply atomic updates to the single 'system_metadata' document (and legacy system_metrics)
 */
async function applyAtomicUpdates(db: any, updates: Record<string, any>): Promise<void> {
  if (!db || Object.keys(updates).length === 0) return;
  try {
    const nowIso = new Date().toISOString();
    const finalUpdates = {
      ...updates,
      lastRecalculatedAt: nowIso,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    // 1. Primary document in system_metadata/dashboard
    const primaryRef = db.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID);
    await primaryRef.set(finalUpdates, { merge: true });

    // 2. Mirror to system_metrics/dashboard for full backwards compatibility
    const legacyRef = db.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID);
    await legacyRef.set(finalUpdates, { merge: true });
  } catch (err: any) {
    serverLog('WARN', 'SystemMetadata', 'Lỗi khi cập nhật atomic increments trên Firestore', err?.message || err);
  }
}

/**
 * ATOMIC WRITE: Image Quality Report (Luồng A -> reports)
 */
export async function recordReportWrite(db: any, log: any, isNew: boolean, prevLog?: any): Promise<void> {
  if (!db || !log) return;
  const updates: Record<string, any> = {};

  if (isNew) {
    updates['reports.totalSessions'] = FieldValue.increment(1);

    const isInvalid = isLogErrorHelper(log);
    const isIncomplete = isLogIncompleteHelper(log);
    const isCompleted = !isInvalid && !isIncomplete;

    if (isInvalid) {
      updates['reports.invalidImageCount'] = FieldValue.increment(1);
    } else if (isIncomplete) {
      updates['reports.incompleteCount'] = FieldValue.increment(1);
    } else if (isCompleted) {
      updates['reports.completedCount'] = FieldValue.increment(1);
      const accCategory = determineAccuracyCategory(log);
      updates[`reports.accuracyCounts.${accCategory}`] = FieldValue.increment(1);

      (log.finalConfirmedErrors || []).forEach((key: string) => {
        if (key && key !== 'not_periapical') {
          updates[`reports.errorDistribution.${key}`] = FieldValue.increment(1);
        }
      });
    }
  } else if (prevLog) {
    // Existing log update (e.g. Verification or Step Progression)
    const prevInvalid = isLogErrorHelper(prevLog);
    const prevIncomplete = isLogIncompleteHelper(prevLog);
    const prevCompleted = !prevInvalid && !prevIncomplete;

    const currInvalid = isLogErrorHelper(log);
    const currIncomplete = isLogIncompleteHelper(log);
    const currCompleted = !currInvalid && !currIncomplete;

    // Status transition adjustments
    if (prevInvalid !== currInvalid) {
      updates['reports.invalidImageCount'] = FieldValue.increment(currInvalid ? 1 : -1);
    }
    if (prevIncomplete !== currIncomplete) {
      updates['reports.incompleteCount'] = FieldValue.increment(currIncomplete ? 1 : -1);
    }
    if (prevCompleted !== currCompleted) {
      updates['reports.completedCount'] = FieldValue.increment(currCompleted ? 1 : -1);
    }

    // Accuracy score adjustments
    const prevAcc = determineAccuracyCategory(prevLog);
    const currAcc = determineAccuracyCategory(log);
    if (prevAcc !== currAcc) {
      if (prevCompleted) updates[`reports.accuracyCounts.${prevAcc}`] = FieldValue.increment(-1);
      if (currCompleted) updates[`reports.accuracyCounts.${currAcc}`] = FieldValue.increment(1);
    }

    // Error distribution adjustments
    const prevErrors = new Set(prevLog.finalConfirmedErrors || []);
    const currErrors = new Set(log.finalConfirmedErrors || []);

    prevErrors.forEach((k: any) => {
      if (!currErrors.has(k) && k !== 'not_periapical') {
        updates[`reports.errorDistribution.${k}`] = FieldValue.increment(-1);
      }
    });
    currErrors.forEach((k: any) => {
      if (!prevErrors.has(k) && k !== 'not_periapical') {
        updates[`reports.errorDistribution.${k}`] = FieldValue.increment(1);
      }
    });
  }

  await applyAtomicUpdates(db, updates);
}

/**
 * ATOMIC DELETE: Image Quality Reports
 */
export async function recordReportDelete(db: any, logOrLogs: any | any[]): Promise<void> {
  if (!db || !logOrLogs) return;
  const logs = Array.isArray(logOrLogs) ? logOrLogs : [logOrLogs];
  if (logs.length === 0) return;

  const updates: Record<string, any> = {
    'reports.totalSessions': FieldValue.increment(-logs.length),
  };

  logs.forEach((log) => {
    if (!log) return;
    const isInvalid = isLogErrorHelper(log);
    const isIncomplete = isLogIncompleteHelper(log);
    const isCompleted = !isInvalid && !isIncomplete;

    if (isInvalid) {
      updates['reports.invalidImageCount'] = FieldValue.increment(-1);
    } else if (isIncomplete) {
      updates['reports.incompleteCount'] = FieldValue.increment(-1);
    } else if (isCompleted) {
      updates['reports.completedCount'] = FieldValue.increment(-1);
      const accCategory = determineAccuracyCategory(log);
      updates[`reports.accuracyCounts.${accCategory}`] = FieldValue.increment(-1);

      (log.finalConfirmedErrors || []).forEach((key: string) => {
        if (key && key !== 'not_periapical') {
          updates[`reports.errorDistribution.${key}`] = FieldValue.increment(-1);
        }
      });
    }
  });

  await applyAtomicUpdates(db, updates);
}

/**
 * ATOMIC WRITE: Bug Reports (Luồng C -> bugs)
 */
export async function recordBugWrite(db: any, bug: any, isNew: boolean, prevBug?: any): Promise<void> {
  if (!db || !bug) return;
  const updates: Record<string, any> = {};

  if (isNew) {
    updates['bugs.totalBugs'] = FieldValue.increment(1);

    const sev = (bug.severity || 'medium').toLowerCase();
    updates[`bugs.severityDistribution.${sev}`] = FieldValue.increment(1);

    const src = (bug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
    updates[`bugs.sourceDistribution.${src}`] = FieldValue.increment(1);

    const st = (bug.status || 'OPEN').toUpperCase();
    updates[`bugs.statusDistribution.${st}`] = FieldValue.increment(1);
  } else if (prevBug) {
    const prevSev = (prevBug.severity || 'medium').toLowerCase();
    const currSev = (bug.severity || 'medium').toLowerCase();
    if (prevSev !== currSev) {
      updates[`bugs.severityDistribution.${prevSev}`] = FieldValue.increment(-1);
      updates[`bugs.severityDistribution.${currSev}`] = FieldValue.increment(1);
    }

    const prevSrc = (prevBug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
    const currSrc = (bug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
    if (prevSrc !== currSrc) {
      updates[`bugs.sourceDistribution.${prevSrc}`] = FieldValue.increment(-1);
      updates[`bugs.sourceDistribution.${currSrc}`] = FieldValue.increment(1);
    }

    const prevSt = (prevBug.status || 'OPEN').toUpperCase();
    const currSt = (bug.status || 'OPEN').toUpperCase();
    if (prevSt !== currSt) {
      updates[`bugs.statusDistribution.${prevSt}`] = FieldValue.increment(-1);
      updates[`bugs.statusDistribution.${currSt}`] = FieldValue.increment(1);
    }
  }

  await applyAtomicUpdates(db, updates);
}

/**
 * ATOMIC DELETE: Bug Reports
 */
export async function recordBugDelete(db: any, bugOrBugs: any | any[]): Promise<void> {
  if (!db || !bugOrBugs) return;
  const bugs = Array.isArray(bugOrBugs) ? bugOrBugs : [bugOrBugs];
  if (bugs.length === 0) return;

  const updates: Record<string, any> = {
    'bugs.totalBugs': FieldValue.increment(-bugs.length),
  };

  bugs.forEach((b) => {
    if (!b) return;
    const sev = (b.severity || 'medium').toLowerCase();
    updates[`bugs.severityDistribution.${sev}`] = FieldValue.increment(-1);

    const src = (b.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
    updates[`bugs.sourceDistribution.${src}`] = FieldValue.increment(-1);

    const st = (b.status || 'OPEN').toUpperCase();
    updates[`bugs.statusDistribution.${st}`] = FieldValue.increment(-1);
  });

  await applyAtomicUpdates(db, updates);
}

/**
 * ATOMIC WRITE: Pathology Reports (Luồng B -> seg_reports)
 */
export async function recordPathologyWrite(db: any, log: any, isNew: boolean, prevLog?: any): Promise<void> {
  if (!db || !log) return;
  const updates: Record<string, any> = {};

  if (isNew) {
    updates['pathology.totalPathologyLogs'] = FieldValue.increment(1);

    const isCompleted = log.sessionStatus === 'COMPLETED' || log.lastCompletedStep === 5 || (log.stage || '').includes('Bước 5');
    const isInvalid = log.sessionStatus === 'FAILED_NON_DENTAL';
    if (isInvalid) {
      updates['pathology.invalidImageCount'] = FieldValue.increment(1);
    } else if (isCompleted) {
      updates['pathology.completedCount'] = FieldValue.increment(1);
    } else {
      updates['pathology.incompleteCount'] = FieldValue.increment(1);
    }

    const isVerified = Boolean(log.isReviewedByAdmin || log.verifiedBy);
    if (isVerified) {
      updates['pathology.verifiedCount'] = FieldValue.increment(1);
    } else {
      updates['pathology.unverifiedCount'] = FieldValue.increment(1);
    }

    const paths = log.finalConfirmedPathologies || log.confirmedPathologies || log.detectedPathologies || [];
    paths.forEach((p: any) => {
      const key = p.key || p.label;
      if (key) {
        updates[`pathology.pathologyDistribution.${key}`] = FieldValue.increment(1);
      }
    });

    if (log.tooth?.fdiNumber) {
      const fdi = String(log.tooth.fdiNumber);
      updates[`pathology.toothDistribution.${fdi}`] = FieldValue.increment(1);
    }
  } else if (prevLog) {
    const prevVerified = Boolean(prevLog.isReviewedByAdmin || prevLog.verifiedBy);
    const currVerified = Boolean(log.isReviewedByAdmin || log.verifiedBy);
    if (prevVerified !== currVerified) {
      updates['pathology.verifiedCount'] = FieldValue.increment(currVerified ? 1 : -1);
      updates['pathology.unverifiedCount'] = FieldValue.increment(currVerified ? -1 : 1);
    }

    const prevCompleted = prevLog.sessionStatus === 'COMPLETED' || prevLog.lastCompletedStep === 5 || (prevLog.stage || '').includes('Bước 5');
    const currCompleted = log.sessionStatus === 'COMPLETED' || log.lastCompletedStep === 5 || (log.stage || '').includes('Bước 5');
    if (prevCompleted !== currCompleted) {
      updates['pathology.completedCount'] = FieldValue.increment(currCompleted ? 1 : -1);
      updates['pathology.incompleteCount'] = FieldValue.increment(currCompleted ? -1 : 1);
    }
  }

  await applyAtomicUpdates(db, updates);
}

/**
 * ATOMIC DELETE: Pathology Reports
 */
export async function recordPathologyDelete(db: any, logOrLogs: any | any[]): Promise<void> {
  if (!db || !logOrLogs) return;
  const logs = Array.isArray(logOrLogs) ? logOrLogs : [logOrLogs];
  if (logs.length === 0) return;

  const updates: Record<string, any> = {
    'pathology.totalPathologyLogs': FieldValue.increment(-logs.length),
  };

  logs.forEach((l) => {
    if (!l) return;
    const isCompleted = l.sessionStatus === 'COMPLETED' || l.lastCompletedStep === 5 || (l.stage || '').includes('Bước 5');
    const isInvalid = l.sessionStatus === 'FAILED_NON_DENTAL';
    if (isInvalid) {
      updates['pathology.invalidImageCount'] = FieldValue.increment(-1);
    } else if (isCompleted) {
      updates['pathology.completedCount'] = FieldValue.increment(-1);
    } else {
      updates['pathology.incompleteCount'] = FieldValue.increment(-1);
    }

    const isVerified = Boolean(l.isReviewedByAdmin || l.verifiedBy);
    if (isVerified) {
      updates['pathology.verifiedCount'] = FieldValue.increment(-1);
    } else {
      updates['pathology.unverifiedCount'] = FieldValue.increment(-1);
    }

    const paths = l.finalConfirmedPathologies || l.confirmedPathologies || l.detectedPathologies || [];
    paths.forEach((p: any) => {
      const key = p.key || p.label;
      if (key) {
        updates[`pathology.pathologyDistribution.${key}`] = FieldValue.increment(-1);
      }
    });

    if (l.tooth?.fdiNumber) {
      const fdi = String(l.tooth.fdiNumber);
      updates[`pathology.toothDistribution.${fdi}`] = FieldValue.increment(-1);
    }
  });

  await applyAtomicUpdates(db, updates);
}

/**
 * Recalculates full system metadata from cached/database collections and writes to Firestore.
 */
export async function recalculateAndPersistSystemMetadata(
  db?: any,
  cachedData?: { reports: any[]; seg_reports: any[]; bugs: any[] }
): Promise<SystemMetadata> {
  const targetDb = db || getFirestoreInstance();
  let reports: any[] = [];
  let segReports: any[] = [];
  let bugs: any[] = [];

  if (targetDb) {
    try {
      const [rSnap, pSnap, bSnap] = await Promise.all([
        targetDb.collection('reports').get(),
        targetDb.collection('seg_reports').get(),
        targetDb.collection('bugs').get(),
      ]);
      reports = rSnap.docs.map((d: any) => ({ ...d.data(), firestoreSynced: true }));
      segReports = pSnap.docs.map((d: any) => ({ ...d.data(), firestoreSynced: true }));
      bugs = bSnap.docs.map((d: any) => ({ ...d.data(), firestoreSynced: true }));

      // Overlay any local unsynced records from cachedData that haven't hit Firestore yet
      if (cachedData) {
        const reportMap = new Map(reports.map(r => [r.assessmentId || r.id, r]));
        (cachedData.reports || []).filter(r => r.firestoreSynced !== true).forEach(r => {
          const id = r.assessmentId || r.id;
          if (id) reportMap.set(id, r);
        });
        reports = Array.from(reportMap.values());

        const segMap = new Map(segReports.map(s => [s.assessmentId || s.id, s]));
        (cachedData.seg_reports || []).filter(s => s.firestoreSynced !== true).forEach(s => {
          const id = s.assessmentId || s.id;
          if (id) segMap.set(id, s);
        });
        segReports = Array.from(segMap.values());

        const bugMap = new Map(bugs.map(b => [b.bugId || b.id, b]));
        (cachedData.bugs || []).filter(b => b.firestoreSynced !== true).forEach(b => {
          const id = b.bugId || b.id;
          if (id) bugMap.set(id, b);
        });
        bugs = Array.from(bugMap.values());
      }
    } catch (e: any) {
      serverLog('WARN', 'SystemMetadata', 'Could not fetch full snapshots for recalculation, using cachedData', e?.message || e);
      reports = cachedData?.reports || [];
      segReports = cachedData?.seg_reports || [];
      bugs = cachedData?.bugs || [];
    }
  } else {
    reports = cachedData?.reports || [];
    segReports = cachedData?.seg_reports || [];
    bugs = cachedData?.bugs || [];
  }

  const metadata = computeSystemMetadata(reports, segReports, bugs);

  if (targetDb) {
    try {
      await Promise.all([
        targetDb.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID).set(metadata, { merge: true }),
        targetDb.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID).set(metadata, { merge: true }),
      ]);
      serverLog('INFO', 'SystemMetadata', `✅ Đã tính toán và đồng bộ toàn bộ system_metadata/${METADATA_DOC_ID}`);
    } catch (e: any) {
      serverLog('WARN', 'SystemMetadata', 'Không thể lưu system_metadata lên Firestore', e?.message || e);
    }
  }

  return metadata;
}

/**
 * Reads the single system_metadata document from Firestore, with fallback to calculation
 */
export async function getSystemMetadata(db?: any): Promise<SystemMetadata | null> {
  const targetDb = db || getFirestoreInstance();
  if (!targetDb) return null;

  try {
    // 1. Try reading from system_metadata/dashboard
    const docSnap = await targetDb.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID).get();
    if (docSnap.exists) {
      return docSnap.data() as SystemMetadata;
    }

    // 2. Fallback check on legacy system_metrics/dashboard
    const legacySnap = await targetDb.collection(LEGACY_COLLECTION).doc(METADATA_DOC_ID).get();
    if (legacySnap.exists) {
      const data = legacySnap.data() as SystemMetadata;
      // Mirror to new location
      await targetDb.collection(METADATA_COLLECTION).doc(METADATA_DOC_ID).set(data, { merge: true });
      return data;
    }

    // 3. Document does not exist yet: Recalculate and persist
    return await recalculateAndPersistSystemMetadata(targetDb);
  } catch (err: any) {
    serverLog('WARN', 'SystemMetadata', 'Lỗi khi đọc system_metadata từ Firestore', err?.message || err);
    return null;
  }
}

/**
 * Aggregates system_metadata metrics specifically for a selected date window
 * by querying the dailyStats map inside the unified system_metadata document.
 */
export function filterRecordsByDateRange<T>(
  records: T[],
  options?: {
    startDate?: string;
    endDate?: string;
    preset?: 'all' | 'today' | '7days' | '30days' | 'custom' | string;
  }
): T[] {
  if (!records || records.length === 0) return [];
  const preset = options?.preset || 'all';
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  if (preset === 'all' && !startDate && !endDate) {
    return records;
  }

  const today = new Date();
  const formatYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  let startKey = startDate || '';
  let endKey = endDate || '';

  if (preset === 'today') {
    startKey = formatYmd(today);
    endKey = formatYmd(today);
  } else if (preset === '7days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  } else if (preset === '30days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  }

  if (!startKey && !endKey) {
    return records;
  }

  return records.filter((item) => {
    const dateKey = getDateKeyFromLog(item);
    if (startKey && dateKey < startKey) return false;
    if (endKey && dateKey > endKey) return false;
    return true;
  });
}

export function aggregateMetadataForDateRange(
  metadata: SystemMetadata | null,
  options?: {
    startDate?: string;
    endDate?: string;
    preset?: 'all' | 'today' | '7days' | '30days' | 'custom' | string;
  }
): SystemMetadata {
  if (!metadata) {
    return {
      reports: { totalSessions: 0, completedCount: 0, incompleteCount: 0, invalidImageCount: 0, accuracyCounts: { EXACT_MATCH: 0, MOSTLY_ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 }, errorDistribution: {}, uniqueUsersCount: 0, todayUsersCount: 0 },
      pathology: { totalPathologyLogs: 0, completedCount: 0, incompleteCount: 0, invalidImageCount: 0, verifiedCount: 0, unverifiedCount: 0, pathologyDistribution: {}, toothDistribution: {}, uniqueUsersCount: 0, todayUsersCount: 0 },
      bugs: { totalBugs: 0, severityDistribution: { low: 0, medium: 0, high: 0, critical: 0, info: 0 }, sourceDistribution: { USER_SUBMITTED: 0, SYSTEM_AUTO: 0 } },
      lastRecalculatedAt: new Date().toISOString(),
    };
  }

  const preset = options?.preset || 'all';
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  if (preset === 'all' && !startDate && !endDate) {
    return metadata;
  }

  const today = new Date();
  const formatYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  let startKey = startDate || '';
  let endKey = endDate || '';

  if (preset === 'today') {
    startKey = formatYmd(today);
    endKey = formatYmd(today);
  } else if (preset === '7days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  } else if (preset === '30days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  }

  if (!startKey && !endKey) {
    return metadata;
  }

  const dailyStats = metadata.dailyStats || {};
  const dailyEntries = Object.entries(dailyStats).filter(([dateKey]) => {
    if (startKey && dateKey < startKey) return false;
    if (endKey && dateKey > endKey) return false;
    return true;
  });

  if (dailyEntries.length === 0 && Object.keys(dailyStats).length > 0) {
    // Zero records found in date range
    return {
      ...metadata,
      reports: {
        totalSessions: 0,
        completedCount: 0,
        incompleteCount: 0,
        invalidImageCount: 0,
        accuracyCounts: { EXACT_MATCH: 0, MOSTLY_ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 },
        errorDistribution: {},
        uniqueUsersCount: 0,
        todayUsersCount: 0,
        userList: [],
      },
      pathology: {
        totalPathologyLogs: 0,
        completedCount: 0,
        incompleteCount: 0,
        invalidImageCount: 0,
        verifiedCount: 0,
        unverifiedCount: 0,
        pathologyDistribution: {},
        toothDistribution: {},
        uniqueUsersCount: 0,
        todayUsersCount: 0,
        userList: [],
      },
      bugs: {
        totalBugs: 0,
        severityDistribution: { low: 0, medium: 0, high: 0, critical: 0, info: 0 },
        sourceDistribution: { USER_SUBMITTED: 0, SYSTEM_AUTO: 0 },
        statusDistribution: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 },
      },
    };
  }

  if (Object.keys(dailyStats).length === 0) {
    return metadata;
  }

  const aggReports = {
    totalSessions: 0,
    completedCount: 0,
    incompleteCount: 0,
    invalidImageCount: 0,
    accuracyCounts: { EXACT_MATCH: 0, MOSTLY_ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 },
    errorDistribution: {} as Record<string, number>,
    uniqueUsersCount: metadata.reports?.uniqueUsersCount || 0,
    todayUsersCount: metadata.reports?.todayUsersCount || 0,
    userList: metadata.reports?.userList || [],
  };

  const aggPathology = {
    totalPathologyLogs: 0,
    completedCount: 0,
    incompleteCount: 0,
    invalidImageCount: 0,
    verifiedCount: 0,
    unverifiedCount: 0,
    pathologyDistribution: {} as Record<string, number>,
    toothDistribution: metadata.pathology?.toothDistribution || {},
    uniqueUsersCount: metadata.pathology?.uniqueUsersCount || 0,
    todayUsersCount: metadata.pathology?.todayUsersCount || 0,
    userList: metadata.pathology?.userList || [],
  };

  const aggBugs = {
    totalBugs: 0,
    severityDistribution: { low: 0, medium: 0, high: 0, critical: 0, info: 0 },
    sourceDistribution: { USER_SUBMITTED: 0, SYSTEM_AUTO: 0 },
    statusDistribution: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 },
  };

  dailyEntries.forEach(([, entry]) => {
    if (entry.reports) {
      aggReports.totalSessions += entry.reports.totalSessions || 0;
      aggReports.completedCount += entry.reports.completedCount || 0;
      aggReports.incompleteCount += entry.reports.incompleteCount || 0;
      aggReports.invalidImageCount += entry.reports.invalidImageCount || 0;
      if (entry.reports.accuracyCounts) {
        aggReports.accuracyCounts.EXACT_MATCH += entry.reports.accuracyCounts.EXACT_MATCH || 0;
        aggReports.accuracyCounts.MOSTLY_ACCURATE += entry.reports.accuracyCounts.MOSTLY_ACCURATE || 0;
        aggReports.accuracyCounts.PARTIALLY_ACCURATE += entry.reports.accuracyCounts.PARTIALLY_ACCURATE || 0;
        aggReports.accuracyCounts.INACCURATE += entry.reports.accuracyCounts.INACCURATE || 0;
      }
      Object.entries(entry.reports.errorDistribution || {}).forEach(([k, v]) => {
        aggReports.errorDistribution[k] = (aggReports.errorDistribution[k] || 0) + (v || 0);
      });
    }

    if (entry.pathology) {
      aggPathology.totalPathologyLogs += entry.pathology.totalPathologyLogs || 0;
      aggPathology.completedCount += entry.pathology.completedCount || 0;
      aggPathology.incompleteCount += entry.pathology.incompleteCount || 0;
      aggPathology.invalidImageCount += entry.pathology.invalidImageCount || 0;
      aggPathology.verifiedCount += entry.pathology.verifiedCount || 0;
      aggPathology.unverifiedCount += entry.pathology.unverifiedCount || 0;
      Object.entries(entry.pathology.pathologyDistribution || {}).forEach(([k, v]) => {
        aggPathology.pathologyDistribution[k] = (aggPathology.pathologyDistribution[k] || 0) + (v || 0);
      });
    }

    if (entry.bugs) {
      aggBugs.totalBugs += entry.bugs.totalBugs || 0;
      if (entry.bugs.severityDistribution) {
        Object.entries(entry.bugs.severityDistribution).forEach(([k, v]) => {
          const key = k as keyof typeof aggBugs.severityDistribution;
          if (key in aggBugs.severityDistribution) {
            aggBugs.severityDistribution[key] = (aggBugs.severityDistribution[key] || 0) + (v || 0);
          }
        });
      }
      if (entry.bugs.sourceDistribution) {
        aggBugs.sourceDistribution.USER_SUBMITTED += entry.bugs.sourceDistribution.USER_SUBMITTED || 0;
        aggBugs.sourceDistribution.SYSTEM_AUTO += entry.bugs.sourceDistribution.SYSTEM_AUTO || 0;
      }
      if (entry.bugs.statusDistribution) {
        Object.entries(entry.bugs.statusDistribution).forEach(([k, v]) => {
          const key = k as keyof typeof aggBugs.statusDistribution;
          if (key in aggBugs.statusDistribution) {
            aggBugs.statusDistribution[key] = (aggBugs.statusDistribution[key] || 0) + (v || 0);
          }
        });
      }
    }
  });

  return {
    ...metadata,
    reports: aggReports,
    pathology: aggPathology,
    bugs: aggBugs,
  };
}

