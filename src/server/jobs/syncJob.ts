import { getFirestoreInstance } from '../services/firebaseService';
import { getOrInitServerCache, saveServerCacheToDisk } from '../services/storageAdapter';
import { formatPathologyDocForFirestore } from '../services/firestorePathologyService';
import {
  executeAtomicReportWrite,
  executeAtomicPathologyWrite,
  executeAtomicBugWrite,
} from '../services/atomicUpdateService';
import { serverLog } from '../config/env';

let isAutoSyncRunning = false;

export async function runAutoSyncJob() {
  if (isAutoSyncRunning) return;

  const cache = getOrInitServerCache();
  // Phase 1 I/O Bottleneck Optimization: Skip sync if cache is clean
  if (!cache.isCacheDirty) {
    return;
  }

  isAutoSyncRunning = true;

  try {
    const db = getFirestoreInstance();
    if (!db) {
      isAutoSyncRunning = false;
      return;
    }

    let syncedReportsCount = 0;
    let syncedSegReportsCount = 0;
    let syncedBugsCount = 0;

    // 1. Sync Unsynced Classic Reports (Luồng A -> reports)
    for (const report of cache.reports) {
      if (report && report.assessmentId && report.firestoreSynced !== true) {
        try {
          const nowIso = new Date().toISOString();
          const payloadToSync = {
            ...report,
            firestoreSynced: true,
            lastSyncedAt: nowIso,
          };
          const res = await executeAtomicReportWrite(db, report.assessmentId, payloadToSync, true);
          if (res.success) {
            report.firestoreSynced = true;
            report.lastSyncedAt = nowIso;
            syncedReportsCount++;
          }
        } catch (err: any) {
          serverLog('WARN', 'AutoSyncJob', `Không thể đồng bộ report ${report.assessmentId}`, err?.message || err);
        }
      }
    }

    // 2. Sync Unsynced Pathology Reports (Luồng B -> seg_reports)
    if (Array.isArray(cache.seg_reports)) {
      for (const segReport of cache.seg_reports) {
        if (segReport && segReport.assessmentId && segReport.firestoreSynced !== true) {
          try {
            const nowIso = new Date().toISOString();
            const payloadToSync = {
              ...segReport,
              firestoreSynced: true,
              lastSyncedAt: nowIso,
            };
            const firestorePayload = formatPathologyDocForFirestore(payloadToSync);
            const res = await executeAtomicPathologyWrite(db, segReport.assessmentId, firestorePayload, true);
            if (res.success) {
              segReport.firestoreSynced = true;
              segReport.lastSyncedAt = nowIso;
              syncedSegReportsCount++;
            }
          } catch (err: any) {
            serverLog('WARN', 'AutoSyncJob', `Không thể đồng bộ seg_report ${segReport.assessmentId}`, err?.message || err);
          }
        }
      }
    }

    // 3. Sync Unsynced Bugs
    for (const bug of cache.bugs) {
      if (bug && bug.bugId && bug.firestoreSynced !== true) {
        try {
          const nowIso = new Date().toISOString();
          const bugToSync = {
            ...bug,
            firestoreSynced: true,
            lastSyncedAt: nowIso,
          };
          const res = await executeAtomicBugWrite(db, bug.bugId, bugToSync, true);
          if (res.success) {
            bug.firestoreSynced = true;
            bug.lastSyncedAt = nowIso;
            syncedBugsCount++;
          }
        } catch (err: any) {
          serverLog('WARN', 'AutoSyncJob', `Không thể đồng bộ bug ${bug.bugId}`, err?.message || err);
        }
      }
    }

    if (syncedReportsCount > 0 || syncedSegReportsCount > 0 || syncedBugsCount > 0) {
      serverLog('INFO', 'AutoSyncJob', `Đồng bộ thành công: ${syncedReportsCount} Classic reports, ${syncedSegReportsCount} Pathology reports, ${syncedBugsCount} bugs lên Firestore.`);
    }

    cache.isCacheDirty = false;
    saveServerCacheToDisk(true);
  } catch (err: any) {
    serverLog('ERROR', 'AutoSyncJob', 'Lỗi trong quá trình chạy AutoSyncJob', err?.message || err);
  } finally {
    isAutoSyncRunning = false;
  }
}

export function startAutoSyncJob() {
  setInterval(runAutoSyncJob, 15000);
}

export function getIsAutoSyncRunning(): boolean {
  return isAutoSyncRunning;
}
