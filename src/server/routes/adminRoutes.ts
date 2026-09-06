import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { adminAuth } from './authRoutes';
import { adminDeleteLimiter, adminSyncLimiter } from '../config/limiter';
import { serverLog } from '../config/env';
import { getStorageAdapter, getOrInitServerCache, FirebaseStorageAdapter, computeSystemMetrics } from '../services/storageAdapter';
import { rebuildSystemStats, aggregateStatsForDateRange, STATS_COLLECTION, USER_STATS_COLLECTION } from '../services/systemStatsService';
import {
  filterRecordsByDateRange,
  determineAccuracyCategory,
  isLogErrorHelper,
  isLogIncompleteHelper,
} from '../utils/metadataHelpers';
import { getTaxonomyLabel, getTechniqueDisplayName } from '../../data/taxonomyData';
import { getPathologyLabel, getTreatmentText } from '../../data/pathologyTaxonomyData';
import { isLogAdminVerified } from '../../utils/reportUtils';

import { runAutoSyncJob, getIsAutoSyncRunning } from '../jobs/syncJob';
import { getFirestoreInstance } from '../services/firebaseService';
import { restorePathologyDocFromFirestore } from '../services/firestorePathologyService';
import { FieldPath } from 'firebase-admin/firestore';
import {
  getSanitizedRegistrySummary,
  refreshModelRegistry,
} from '../services/modelRegistryService';
import { resolveControlPlaneState } from '../services/modelResolverService';
import { getAllHealthRecords } from '../services/modelHealthService';
import { getGlobalPolicyTimestamp } from '../services/modelPolicyService';
import { getAllCompatibilityRecords } from '../services/modelCompatibilityGate';
import { getAllModelOperationalAvailabilityRecords } from '../services/modelAvailabilityService';

const router = Router();

// Sync status inspection endpoint
router.get('/api/admin/sync-status', adminAuth, (_req: Request, res: Response) => {
  const cache = getOrInitServerCache();
  const totalReports = cache.reports.length;
  const unsyncedReports = cache.reports.filter(r => r.firestoreSynced !== true).length;
  const totalBugs = cache.bugs.length;
  const unsyncedBugs = cache.bugs.filter(b => b.firestoreSynced !== true).length;

  res.json({
    success: true,
    totalReports,
    unsyncedReports,
    syncedReports: totalReports - unsyncedReports,
    totalBugs,
    unsyncedBugs,
    syncedBugs: totalBugs - unsyncedBugs,
    lastUpdated: cache.lastUpdated,
    isSyncRunning: getIsAutoSyncRunning(),
  });
});

// Model discovery registry inspection endpoint
router.get('/api/admin/models/registry', adminAuth, (_req: Request, res: Response) => {
  const summary = getSanitizedRegistrySummary();
  const controlPlane = resolveControlPlaneState();
  res.json({ success: true, ...summary, controlPlane });
});

// Full adaptive control-plane inspection endpoint
router.get('/api/admin/models/control-plane', adminAuth, (_req: Request, res: Response) => {
  const controlPlane = resolveControlPlaneState();
  const registrySummary = getSanitizedRegistrySummary();
  const healthRecords = getAllHealthRecords();
  const policyTimestamp = getGlobalPolicyTimestamp();

  res.json({
    success: true,
    policyMode: controlPlane.policyMode,
    cohortId: controlPlane.cohortId,
    matrixRevision: controlPlane.matrixRevision,
    ladderRevision: controlPlane.ladderRevision,
    analysisConfigVersion: controlPlane.analysisConfigVersion,
    activeMatrix: controlPlane.activeMatrix,
    roleAssignments: controlPlane.roleAssignments,
    roleLadders: controlPlane.roleLadders,
    selectionRationales: controlPlane.selectionRationales,
    controlPlane,
    discoveryTimestamps: {
      lastCheckedAt: registrySummary.lastCheckedAt,
      primaryLastSuccess: registrySummary.sources.system_primary.lastSuccessfulCheckAt,
      backupLastSuccess: registrySummary.sources.system_backup.lastSuccessfulCheckAt,
    },
    policyTimestamps: {
      lastPolicyCheckAt: policyTimestamp,
    },
    candidates: controlPlane.candidates,
    runtimeHealthSummary: healthRecords,
    compatibility: getAllCompatibilityRecords(),
    availability: getAllModelOperationalAvailabilityRecords(),
  });
});

// Manual model discovery refresh endpoint
router.post('/api/admin/models/refresh', adminAuth, async (_req: Request, res: Response) => {
  try {
    await refreshModelRegistry({ force: true, triggeredBy: 'admin_manual' });
    const summary = getSanitizedRegistrySummary();
    const controlPlane = resolveControlPlaneState();
    res.json({ success: true, ...summary, controlPlane });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    res.status(500).json({ success: false, error: err.message || 'Lỗi làm mới danh mục model' });
  }
});

// Manual trigger sync endpoint
router.post('/api/admin/trigger-sync', adminAuth, async (_req: Request, res: Response) => {
  try {
    const initialCache = getOrInitServerCache();
    const beforeUnsyncedReports = initialCache.reports.filter(r => r.firestoreSynced !== true).length;
    const beforeUnsyncedBugs = initialCache.bugs.filter(b => b.firestoreSynced !== true).length;

    await runAutoSyncJob();

    const updatedCache = getOrInitServerCache();
    const afterUnsyncedReports = updatedCache.reports.filter(r => r.firestoreSynced !== true).length;
    const afterUnsyncedBugs = updatedCache.bugs.filter(b => b.firestoreSynced !== true).length;

    res.json({
      success: true,
      syncedReports: beforeUnsyncedReports - afterUnsyncedReports,
      syncedBugs: beforeUnsyncedBugs - afterUnsyncedBugs,
      remainingUnsyncedReports: afterUnsyncedReports,
      remainingUnsyncedBugs: afterUnsyncedBugs,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    res.status(500).json({ success: false, error: err?.message || 'Lỗi kích hoạt đồng bộ' });
  }
});

// Firestore / RAM data inspection endpoint
router.get('/api/firestore-data', adminAuth, async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  if (force) {
    return adminSyncLimiter(req, res, () => handleFirestoreData(req, res, true));
  }
  return handleFirestoreData(req, res, false);
});

type AdminCaseScope = 'reports' | 'pathology' | 'bugs';

const ADMIN_CASE_COLLECTIONS: Record<AdminCaseScope, 'reports' | 'seg_reports' | 'bugs'> = {
  reports: 'reports',
  pathology: 'seg_reports',
  bugs: 'bugs',
};

function getAdminScopeId(scope: AdminCaseScope, record: any): string {
  return String(scope === 'bugs'
    ? record.bugId || record.id || record._id || ''
    : record.assessmentId || record.id || record._id || '');
}

function getAdminScopeTimestamp(record: any): string {
  const value = record?.timestamp || record?.updatedAt || record?.createdAt || '';
  return typeof value === 'string' ? value : String(value || '');
}

function encodeAdminCursor(scope: AdminCaseScope, record: any): string {
  return Buffer.from(JSON.stringify({ scope, timestamp: getAdminScopeTimestamp(record), id: getAdminScopeId(scope, record) })).toString('base64url');
}

function decodeAdminCursor(scope: AdminCaseScope, raw: unknown): { timestamp: string; id: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (value?.scope !== scope || typeof value.timestamp !== 'string' || typeof value.id !== 'string') return null;
    return { timestamp: value.timestamp, id: value.id };
  } catch {
    return null;
  }
}

function sortAdminScopeRecords(scope: AdminCaseScope, records: any[]): any[] {
  return [...records].sort((left, right) => {
    const timestampDelta = getAdminScopeTimestamp(right).localeCompare(getAdminScopeTimestamp(left));
    return timestampDelta || getAdminScopeId(scope, right).localeCompare(getAdminScopeId(scope, left));
  });
}

function recordsAfterAdminCursor(scope: AdminCaseScope, records: any[], cursor: { timestamp: string; id: string } | null): any[] {
  if (!cursor) return records;
  return records.filter((record) => {
    const timestamp = getAdminScopeTimestamp(record);
    if (timestamp < cursor.timestamp) return true;
    return timestamp === cursor.timestamp && getAdminScopeId(scope, record) < cursor.id;
  });
}

function getAdminDateBounds(options: { preset?: string; startDate?: string; endDate?: string }): { start?: string; end?: string } {
  if (options.startDate || options.endDate) {
    return {
      start: options.startDate ? new Date(`${options.startDate}T00:00:00.000Z`).toISOString() : undefined,
      end: options.endDate ? new Date(`${options.endDate}T23:59:59.999Z`).toISOString() : undefined,
    };
  }
  if (!options.preset || options.preset === 'all') return {};
  const now = new Date();
  if (options.preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (options.preset === '7days' || options.preset === '30days') {
    const start = new Date(now);
    start.setDate(start.getDate() - (options.preset === '7days' ? 7 : 30));
    return { start: start.toISOString(), end: now.toISOString() };
  }
  return {};
}

/**
 * Canonical bounded Admin case reader. It deliberately never syncs records or
 * rebuilds metadata: reads must remain reads. Firebase-backed requests query a
 * single collection by keyset cursor; the durable local cache is used only as
 * an offline/local-fallback source and to overlay unsynced local writes.
 */
router.get('/api/admin/cases/:scope', adminAuth, async (req: Request, res: Response) => {
  const scope = req.params.scope as AdminCaseScope;
  if (!(scope in ADMIN_CASE_COLLECTIONS)) {
    return res.status(400).json({ success: false, error: 'Unknown Admin case scope.' });
  }

  const requestedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const cursor = decodeAdminCursor(scope, req.query.cursor);
  if (req.query.cursor && !cursor) {
    return res.status(400).json({ success: false, error: 'Invalid Admin pagination cursor.' });
  }

  const filter = {
    preset: String(req.query.preset || 'all'),
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  };
  const cache = getOrInitServerCache();
  const cacheRecords = scope === 'reports'
    ? cache.reports
    : scope === 'pathology'
    ? cache.seg_reports || []
    : cache.bugs;
  const storageAdapter = getStorageAdapter();
  const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : null;

  try {
    let records: any[];
    let source: 'firestore' | 'cache' = 'cache';
    let hasMore = false;

    if (db) {
      source = 'firestore';
      let query: any = db.collection(ADMIN_CASE_COLLECTIONS[scope]);
      const bounds = getAdminDateBounds(filter);
      if (bounds.start) query = query.where('timestamp', '>=', bounds.start);
      if (bounds.end) query = query.where('timestamp', '<=', bounds.end);
      query = query.orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (cursor) query = query.startAfter(cursor.timestamp, cursor.id);
      const snapshot = await query.limit(limit + 1).get();
      const remote = snapshot.docs.map((doc: any) => {
        const data = doc.data();
        const normalized = scope === 'pathology'
          ? restorePathologyDocFromFirestore({ ...data, assessmentId: data.assessmentId || doc.id, _id: doc.id })
          : data;
        const idField = scope === 'bugs' ? 'bugId' : 'assessmentId';
        return { ...normalized, [idField]: normalized[idField] || doc.id, firestoreSynced: true };
      });
      const unsynced = (cacheRecords || []).filter((record: any) => record.firestoreSynced !== true);
      const merged = new Map<string, any>();
      remote.forEach((record: any) => merged.set(getAdminScopeId(scope, record), record));
      unsynced.forEach((record: any) => merged.set(getAdminScopeId(scope, record), record));
      const filtered = recordsAfterAdminCursor(scope, filterRecordsByDateRange(sortAdminScopeRecords(scope, Array.from(merged.values())), filter), cursor);
      records = filtered.slice(0, limit);
      hasMore = remote.length > limit || filtered.length > limit;
    } else {
      const filtered = recordsAfterAdminCursor(
        scope,
        filterRecordsByDateRange(sortAdminScopeRecords(scope, cacheRecords || []), filter),
        cursor,
      );
      records = filtered.slice(0, limit);
      hasMore = filtered.length > limit;
    }

    const last = records.at(-1);
    return res.json({
      success: true,
      scope,
      source,
      records,
      nextCursor: hasMore && last ? encodeAdminCursor(scope, last) : null,
      hasMore,
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    serverLog('WARN', 'AdminCases', `Unable to load ${scope} cases`, err.message);
    return res.status(500).json({ success: false, error: 'Unable to load Admin cases.' });
  }
});

// Admin paginated users directory endpoint (Cursor-based)
router.get('/api/admin/users', adminAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim() ? req.query.cursor.trim() : null;

    const storageAdapter = getStorageAdapter();
    if (storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      const db = storageAdapter.getDb()!;
      // Read total count in O(1) from system_stats/all_time (never scanning user_stats on initial load)
      let totalCount = 0;
      try {
        const allTimeSnap = await db.collection(STATS_COLLECTION).doc('all_time').get();
        if (allTimeSnap.exists) {
          totalCount = allTimeSnap.data()?.users?.uniqueUsersCount || 0;
        }
      } catch (e) {
        // Ignored
      }

      let query = db.collection(USER_STATS_COLLECTION)
        .orderBy('totalSessions', 'desc');

      if (cursor) {
        const cursorDoc = await db.collection(USER_STATS_COLLECTION).doc(cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Fetch limit + 1 to check if more items exist
      const snap = await query.limit(limit + 1).get();
      const hasMore = snap.docs.length > limit;
      const returnedDocs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
      const nextCursor = hasMore && returnedDocs.length > 0 ? returnedDocs[returnedDocs.length - 1].id : null;

      const users = returnedDocs.map(d => {
        const data = d.data();
        return {
          userId: data.userId || d.id,
          totalSessions: data.totalSessions || 0,
          completedSessions: data.completedSessions || 0,
          lastActive: data.lastActive || '',
          lastTooth: data.lastTooth || '',
          updatedAt: data.updatedAt || '',
        };
      });

      if (totalCount === 0 && users.length > 0) {
        totalCount = users.length;
      }

      return res.json({
        success: true,
        users,
        totalCount,
        hasMore,
        nextCursor,
      });
    } else {
      // Local RAM cache fallback with cursor simulation
      const cache = getOrInitServerCache();
      const userMap: Record<string, any> = {};
      const allLogs = [...(cache.reports || []), ...(cache.seg_reports || [])];
      for (const log of allLogs) {
        const uid = log.userId || log.deviceId || log.user_id || log.device_id;
        if (!uid || typeof uid !== 'string' || !uid.trim()) continue;
        const cleanUid = uid.trim();
        if (!userMap[cleanUid]) {
          userMap[cleanUid] = {
            userId: cleanUid,
            totalSessions: 0,
            completedSessions: 0,
            lastActive: log.timestamp || log.createdAt || '',
            lastTooth: log.tooth?.fdiNumber || '',
          };
        }
        userMap[cleanUid].totalSessions++;
        if (log.sessionStatus === 'COMPLETED' || log.lastCompletedStep === 5) {
          userMap[cleanUid].completedSessions++;
        }
      }
      const sortedUsers = Object.values(userMap).sort((a: any, b: any) => {
        if (b.totalSessions !== a.totalSessions) return b.totalSessions - a.totalSessions;
        return a.userId.localeCompare(b.userId);
      });

      let startIndex = 0;
      if (cursor) {
        const cursorIdx = sortedUsers.findIndex(u => u.userId === cursor);
        if (cursorIdx >= 0) {
          startIndex = cursorIdx + 1;
        }
      }

      const paginated = sortedUsers.slice(startIndex, startIndex + limit);
      const hasMore = (startIndex + limit) < sortedUsers.length;
      const nextCursor = hasMore && paginated.length > 0 ? paginated[paginated.length - 1].userId : null;

      return res.json({
        success: true,
        users: paginated,
        totalCount: sortedUsers.length,
        hasMore,
        nextCursor,
      });
    }
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    res.status(500).json({ success: false, error: err?.message || 'Lỗi nạp danh sách người dùng' });
  }
});

// Admin stats aggregation endpoint
router.get('/api/admin/summary-stats', adminAuth, async (_req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const cache = getOrInitServerCache();

    let totalSessions = 0;
    let totalConcurred = 0;
    const errorDistribution: Record<string, number> = {};

    if (storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      const stats = await aggregateStatsForDateRange(storageAdapter.getDb(), { preset: 'all' });
      totalSessions = stats?.reports?.totalSessions || 0;
      Object.assign(errorDistribution, stats?.reports?.errorDistribution || {});
    } else {
      const reports = cache.reports || [];
      totalSessions = reports.length;
      reports.forEach((log: any) => {
        if (log.userValidation?.concurred === true) {
          totalConcurred++;
        }
        (log.finalConfirmedErrors || []).forEach((errKey: string) => {
          errorDistribution[errKey] = (errorDistribution[errKey] || 0) + 1;
        });
      });
    }

    const overallAccuracy = totalSessions > 0 ? Math.round((totalConcurred / totalSessions) * 100) : 100;

    res.json({
      success: true,
      totalSessions,
      overallAccuracy,
      errorDistribution,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    res.status(500).json({ success: false, error: err?.message || 'Lỗi hệ thống' });
  }
});

async function handleFirestoreData(req: Request, res: Response, force: boolean) {
  try {
    const storageAdapter = getStorageAdapter();
    const isFirebase = storageAdapter.type === 'firebase';
    const cache = getOrInitServerCache();

    // Legacy compatibility endpoint: reads only the durable RAM/disk cache.
    // Sync jobs and Firestore collection reads are intentionally kept out of
    // Admin read paths. New UI code uses /api/admin/cases/:scope instead.

    const preset = (req.query.preset || req.query.datePreset || 'all') as string;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const rawLogs = cache.reports || [];
    const rawBugs = cache.bugs || [];
    const rawPathologyLogs = cache.seg_reports || [];

    const logs = filterRecordsByDateRange(rawLogs, { preset, startDate, endDate });
    const bugs = filterRecordsByDateRange(rawBugs, { preset, startDate, endDate });
    const pathologyLogs = filterRecordsByDateRange(rawPathologyLogs, { preset, startDate, endDate });

    const parseTimestamp = (item: any) => {
      const ts = item.timestamp || item.updatedAt || item.createdAt;
      if (!ts) return 0;
      const parsed = new Date(ts).getTime();
      return isNaN(parsed) ? 0 : parsed;
    };

    // Sort descending by timestamp (latest first) to ensure the client gets the most relevant logs
    const sortedLogs = [...logs].sort((a, b) => parseTimestamp(b) - parseTimestamp(a));
    const sortedBugs = [...bugs].sort((a, b) => parseTimestamp(b) - parseTimestamp(a));
    const sortedPathologyLogs = [...pathologyLogs].sort((a, b) => parseTimestamp(b) - parseTimestamp(a));

    // Extract pagination parameters
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const slicedLogs = sortedLogs.slice(offset, offset + limit);
    const slicedBugs = sortedBugs.slice(offset, offset + limit);
    const slicedPathologyLogs = sortedPathologyLogs.slice(offset, offset + limit);

    const lightweightLogs = slicedLogs.map((log: any) => {
      const { imageUrl, imageDataUrl, ...rest } = log;
      if (typeof imageUrl === 'string' && imageUrl.startsWith('/api/images/')) {
        return { ...rest, imageUrl };
      }
      return rest;
    });

    const lightweightPathologyLogs = slicedPathologyLogs.map((log: any) => {
      const { imageUrl, imageDataUrl, ...rest } = log;
      if (typeof imageUrl === 'string' && imageUrl.startsWith('/api/images/')) {
        return { ...rest, imageUrl };
      }
      return rest;
    });

    let paginatedLogs = lightweightLogs;
    let paginatedPathologyLogs = lightweightPathologyLogs;
    let paginatedBugs = slicedBugs;

    let systemMetrics = cache.systemMetrics;

    if (isFirebase && storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      const db = storageAdapter.getDb();
      try {
        const stats = await aggregateStatsForDateRange(db, { preset, startDate, endDate });
        if (stats) {
          systemMetrics = stats;
          cache.systemMetrics = systemMetrics;
        }
      } catch (e) {
        serverLog('WARN', 'MetricsFetchError', 'Could not fetch system_stats document', (e as any)?.message || e);
      }
    }

    if (!systemMetrics) {
      systemMetrics = computeSystemMetrics(cache.reports || [], cache.seg_reports || [], cache.bugs || []);
      cache.systemMetrics = systemMetrics;
    }

    const filteredSystemMetrics = systemMetrics;

    const totalLogsCount = filteredSystemMetrics?.reports?.totalSessions ?? lightweightLogs.length;
    const totalBugsCount = filteredSystemMetrics?.bugs?.totalBugs ?? bugs.length;
    const totalPathologyLogsCount = filteredSystemMetrics?.pathology?.totalPathologyLogs ?? lightweightPathologyLogs.length;

    return res.json({
      success: true,
      isFirebase,
      isCached: !force,
      lastUpdated: cache.lastUpdated,
      systemMetrics: filteredSystemMetrics,
      logsCount: totalLogsCount,
      bugsCount: totalBugsCount,
      pathologyLogsCount: totalPathologyLogsCount,
      logs: paginatedLogs,
      bugs: paginatedBugs,
      pathologyLogs: paginatedPathologyLogs,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.json({ success: false, error: err?.message || 'Lỗi nạp dữ liệu' });
  }
}


// Endpoint to fetch aggregated system stats for specific date ranges directly from system_stats collection
router.get('/api/admin/metadata', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : getFirestoreInstance();

    const preset = (req.query.preset || req.query.datePreset || 'all') as string;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const filteredMetadata = await aggregateStatsForDateRange(db, {
      preset,
      startDate,
      endDate,
    });

    return res.json({
      success: true,
      systemMetrics: filteredMetadata,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi lấy metadata' });
  }
});

// Diagnostic & drift analysis endpoint
router.get('/api/admin/diagnose-drift', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : getFirestoreInstance();
    if (!db) {
      return res.status(400).json({ success: false, error: 'Firestore is not initialized' });
    }

    // Use aggregation count() for efficient 0-document-payload counter if available, or lightweight size
    const [reportsCountSnap, segCountSnap, bugsCountSnap] = await Promise.all([
      db.collection('reports').count().get().catch(() => null),
      db.collection('seg_reports').count().get().catch(() => null),
      db.collection('bugs').count().get().catch(() => null),
    ]);

    let rawCounts = {
      reports: reportsCountSnap ? reportsCountSnap.data().count : 0,
      seg_reports: segCountSnap ? segCountSnap.data().count : 0,
      bugs: bugsCountSnap ? bugsCountSnap.data().count : 0,
    };

    // Fallback if count() API is not supported on the instance: use capped limit(500)
    if (!reportsCountSnap || !segCountSnap || !bugsCountSnap) {
      const [reportsSnap, segSnap, bugsSnap] = await Promise.all([
        db.collection('reports').orderBy('timestamp', 'desc').limit(500).get(),
        db.collection('seg_reports').orderBy('timestamp', 'desc').limit(500).get(),
        db.collection('bugs').orderBy('timestamp', 'desc').limit(500).get(),
      ]);
      rawCounts = {
        reports: reportsSnap.size,
        seg_reports: segSnap.size,
        bugs: bugsSnap.size,
      };
    }

    const allTimeStats = await aggregateStatsForDateRange(db, { preset: 'all' });
    const metadataCounts = {
      reports: allTimeStats?.reports?.totalSessions ?? 0,
      seg_reports: allTimeStats?.pathology?.totalPathologyLogs ?? 0,
      bugs: allTimeStats?.bugs?.totalBugs ?? 0,
    };

    const cache = getOrInitServerCache();
    const cacheCounts = {
      reports: cache.reports?.length ?? 0,
      seg_reports: cache.seg_reports?.length ?? 0,
      bugs: cache.bugs?.length ?? 0,
    };

    const drift = {
      reports: rawCounts.reports - metadataCounts.reports,
      seg_reports: rawCounts.seg_reports - metadataCounts.seg_reports,
      bugs: rawCounts.bugs - metadataCounts.bugs,
    };

    let repairedMetadata = null;
    if (req.query.fix === 'true') {
      repairedMetadata = await rebuildSystemStats(db);
      cache.systemMetrics = repairedMetadata;
    }

    return res.json({
      success: true,
      rawCounts,
      metadataCounts,
      cacheCounts,
      drift,
      hasDrift: drift.reports !== 0 || drift.seg_reports !== 0 || drift.bugs !== 0,
      repairedMetadata: repairedMetadata || allTimeStats,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(500).json({ success: false, error: err?.message || 'Error diagnosing drift' });
  }
});


// Single report endpoint (supports both reports & seg_reports)
router.get('/api/reports/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const assessmentId = req.params.id;
    if (!assessmentId) {
      return res.status(400).json({ success: false, error: 'Thiếu assessmentId' });
    }
    const cache = getOrInitServerCache();
    let log = cache.reports.find(r => r.assessmentId === assessmentId) ||
              (cache.seg_reports || []).find(r => r.assessmentId === assessmentId);
    
    if (!log) {
      const storageAdapter = getStorageAdapter();
      log = await storageAdapter.getLogById(assessmentId);
    }

    if (!log) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi' });
    }
    return res.json({ success: true, log });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi hệ thống' });
  }
});

// Admin log detail endpoint (handles both query param ?assessmentId= and body)
router.get('/api/admin/log-detail', adminAuth, async (req: Request, res: Response) => {
  try {
    const assessmentId = String(req.query.assessmentId || req.query.id || '').trim();
    if (!assessmentId) {
      return res.status(400).json({ success: false, error: 'Thiếu assessmentId' });
    }
    const cache = getOrInitServerCache();
    let log = (cache.seg_reports || []).find(r => r.assessmentId === assessmentId) ||
              cache.reports.find(r => r.assessmentId === assessmentId);

    if (!log) {
      const storageAdapter = getStorageAdapter();
      log = await storageAdapter.getLogById(assessmentId);
    }

    if (!log) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi' });
    }
    return res.json({ success: true, log });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi hệ thống' });
  }
});

function verifyDelPassword(password: any, clientIp: string): { valid: boolean; status?: number; error?: string } {
  let expectedPassword = process.env.DEL_PASSWORD ? process.env.DEL_PASSWORD.trim() : '';
  if ((expectedPassword.startsWith("'") && expectedPassword.endsWith("'")) || (expectedPassword.startsWith('"') && expectedPassword.endsWith('"'))) {
    expectedPassword = expectedPassword.slice(1, -1).trim();
  }

  if (!expectedPassword) {
    serverLog('ERROR', 'AUDIT_DELETE_FAILED', 'DEL_PASSWORD environment variable is not configured in secrets.');
    return { valid: false, status: 500, error: 'Chưa cấu hình biến môi trường DEL_PASSWORD trong hệ thống (Secrets).' };
  }

  const inputPassword = typeof password === 'string' ? password.trim() : '';
  if (!inputPassword) {
    return { valid: false, status: 400, error: 'Vui lòng nhập mật khẩu xoá dữ liệu.' };
  }

  // Hard limit to prevent Denial of Service (DoS) attacks via crypto hashing
  if (inputPassword.length > 100) {
    serverLog('WARN', 'AUDIT_DELETE_FAILED', `Failed delete attempt (password exceeds length limit) from IP: ${clientIp}`);
    return { valid: false, status: 400, error: 'Mật khẩu không hợp lệ (vượt quá độ dài cho phép).' };
  }

  // Constant-time timingSafeEqual comparison with SHA-256 hash
  const inputHash = crypto.createHash('sha256').update(inputPassword).digest();
  const expectedHash = crypto.createHash('sha256').update(expectedPassword).digest();
  const isMatch = crypto.timingSafeEqual(inputHash, expectedHash);

  if (!isMatch) {
    serverLog('WARN', 'AUDIT_DELETE_FAILED', `Failed delete attempt (invalid password) from IP: ${clientIp}`);
    return { valid: false, status: 401, error: 'Mật khẩu xoá dữ liệu không chính xác.' };
  }

  return { valid: true };
}

// Admin delete single document from Firestore and local cache
router.post('/api/admin/delete-doc', adminAuth, adminDeleteLimiter, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const { docId, collection, password } = req.body;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const authCheck = verifyDelPassword(password, clientIp);
    if (!authCheck.valid) {
      return res.status(authCheck.status || 400).json({ success: false, error: authCheck.error });
    }

    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({ success: false, error: 'Thiếu hoặc sai định dạng mã bản ghi (docId).' });
    }

    const validCollections = ['reports', 'bugs', 'seg_reports'];
    const targetCollection = (collection === 'pathology_reports' ? 'seg_reports' : collection) as 'reports' | 'bugs' | 'seg_reports';
    if (!targetCollection || !validCollections.includes(targetCollection)) {
      return res.status(400).json({ success: false, error: 'Loại danh mục (collection) không hợp lệ.' });
    }

    serverLog('WARN', 'AUDIT_DELETE_SUCCESS', `Admin single document deletion executed for ${targetCollection}/${docId} from IP: ${clientIp}`);

    const result = await storageAdapter.deleteDocument(targetCollection, docId.trim());
    return res.json({
      success: result.success,
      deletedDocId: docId.trim(),
      collection: targetCollection,
      deletedCount: result.deletedCount,
      message: result.message,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AdminRoute', '[Delete Document Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi hệ thống khi xoá bản ghi' });
  }
});

// Admin delete data (batch/filtered)
router.post('/api/admin/delete-data', adminAuth, adminDeleteLimiter, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const { timeConfig, deleteTypes, password } = req.body;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const authCheck = verifyDelPassword(password, clientIp);
    if (!authCheck.valid) {
      return res.status(authCheck.status || 400).json({ success: false, error: authCheck.error });
    }

    if (!timeConfig || !deleteTypes || !Array.isArray(deleteTypes)) {
      return res.status(400).json({ success: false, error: 'Thiếu thông số timeConfig hoặc deleteTypes' });
    }

    serverLog('WARN', 'AUDIT_DELETE_SUCCESS', `Admin batch data deletion executed from IP: ${clientIp}`, {
      timeConfig,
      deleteTypes,
    });

    const result = await storageAdapter.deleteData({ timeConfig, deleteTypes });
    return res.json(result);
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AdminRoute', '[Delete Data Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi hệ thống khi xoá dữ liệu' });
  }
});

// Export backup (Protected by adminAuth)
router.get('/api/admin/export-backup', adminAuth, async (_req: Request, res: Response) => {
  try {
    const backupFilePath = path.join(process.cwd(), 'database_backup.json');
    if (fs.existsSync(backupFilePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="database_backup.json"');
      return res.sendFile(backupFilePath);
    }
    const publicBackupPath = path.join(process.cwd(), 'public', 'database_backup.json');
    if (fs.existsSync(publicBackupPath)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="database_backup.json"');
      return res.sendFile(publicBackupPath);
    }
    return res.status(404).json({ success: false, error: 'File backup chưa sẵn sàng.' });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi xuất file backup' });
  }
});

function getLogStatusServer(l: any): 'COMPLETED' | 'INCOMPLETE' | 'FAILED_NON_DENTAL' {
  if (isLogErrorHelper(l)) return 'FAILED_NON_DENTAL';
  if (isLogIncompleteHelper(l)) return 'INCOMPLETE';
  return 'COMPLETED';
}

function buildAdminExportBundle(
  scope: AdminCaseScope,
  records: any[],
  lang: 'VI' | 'EN'
): { title: string; headers: string[]; rows: (string | number)[][] } {
  const now = new Date();
  const formattedDate = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;

  if (scope === 'reports') {
    const headers = [
      'Assessment ID',
      'Timestamp',
      'Tooth FDI',
      'Tooth Name',
      'Technique',
      'Status',
      'Stage',
      'AI Overall Quality',
      'AI Errors Detected',
      'User Concurred',
      'Final Confirmed Errors',
      'Accuracy Score',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes',
    ];

    const rows = records.map((l: any) => {
      const status = getLogStatusServer(l);
      const isCompleted = status === 'COMPLETED';
      const isInvalid = status === 'FAILED_NON_DENTAL';
      const accuracyCategory = (!isCompleted || isInvalid) ? 'N/A' : determineAccuracyCategory(l);

      const aiErrors: string[] = [];
      if (l.aiAnalysis?.findings && Array.isArray(l.aiAnalysis.findings)) {
        l.aiAnalysis.findings.forEach((f: any) => {
          if (Array.isArray(f.detectedErrors)) {
            f.detectedErrors.forEach((e: any) => {
              if (e.errorKey) {
                const label = getTaxonomyLabel(e.errorKey, lang) || e.errorKey;
                aiErrors.push(label);
              }
            });
          }
        });
      }

      const finalErrors = (l.finalConfirmedErrors || []).map((e: string) => getTaxonomyLabel(e, lang) || e);
      const isAdmin = isLogAdminVerified(l);

      return [
        l.assessmentId || '',
        l.timestamp || '',
        l.tooth?.fdiNumber || '',
        l.tooth?.name || '',
        getTechniqueDisplayName(l.technique || '', lang) || l.technique || '',
        status,
        l.stage || '',
        l.aiAnalysis?.overallQuality || '',
        aiErrors.join('; '),
        l.userValidation?.concurred !== undefined ? (l.userValidation.concurred ? 'YES' : 'NO') : '',
        finalErrors.join('; '),
        accuracyCategory,
        l.userValidation?.userNotes || l.userNotes || '',
        l.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        l.verifiedNotes || '',
      ];
    });

    return {
      title: `PeriApical_AI_Assessment_Logs_${formattedDate}`,
      headers,
      rows,
    };
  }

  if (scope === 'pathology') {
    const headers = [
      'Case ID',
      'Timestamp',
      'Status',
      'Tooth FDI',
      'Tooth Area',
      'Technique',
      'Receptor',
      'Anomalies Count',
      'Detected Anomalies',
      'Treatment Guidance',
      'User Notes',
      'Image URL',
      'Admin Verified',
      'Admin Notes',
    ];

    const rows = records.map((log: any) => {
      const statusStr = getLogStatusServer(log);
      const toothFdi = log.tooth?.fdiNumber || '';
      const arch = log.tooth?.arch === 'Maxilla' ? 'Maxilla' : (log.tooth?.arch === 'Mandible' ? 'Mandible' : '');

      const pathList = (log.confirmedPathologies || [])
        .map((p: any) => `${getPathologyLabel(p.pathologyKey, lang) || p.pathologyKey}${typeof p.confidence === 'number' ? ` (${p.confidence}%)` : ''}`)
        .join('; ');
      const treatList = (log.confirmedPathologies || [])
        .map((p: any) => `${getPathologyLabel(p.pathologyKey, lang) || p.pathologyKey}: ${getTreatmentText(p.pathologyKey, lang) || ''}`)
        .join(' | ');

      const isAdmin = Boolean(log.isReviewedByAdmin || log.verifiedBy === 'Admin' || log.verifiedNotes?.includes('Admin'));

      return [
        log.assessmentId || '',
        log.timestamp || '',
        statusStr,
        toothFdi,
        arch,
        log.technique || '',
        log.receptorType || '',
        (log.confirmedPathologies?.length || 0).toString(),
        pathList,
        treatList,
        log.userNotes || '',
        log.imageUrl || '',
        isAdmin ? 'YES' : 'NO',
        log.verifiedNotes || '',
      ];
    });

    return {
      title: `PeriApical_Pathology_Logs_${formattedDate}`,
      headers,
      rows,
    };
  }

  // bugs
  const headers = ['Thời Gian (Timestamp)', 'Nguồn Bug (Source)', 'Mức Độ (Severity)', 'Đường Dẫn (Path)', 'Mô Tả Lỗi (Description)'];
  const rows = records.map((b: any) => [
    b.timestamp || b.createdAt || '',
    b.source === 'SYSTEM_AUTO' ? 'Hệ thống tự ghi' : 'Người dùng báo lỗi',
    b.severity || 'INFO',
    b.path || '',
    b.description || '',
  ]);

  return {
    title: `PeriApical_AI_Bug_Reports_${formattedDate}`,
    headers,
    rows,
  };
}

// Dedicated full-scope export endpoint with cursor pagination
router.post('/api/admin/export', adminAuth, async (req: Request, res: Response) => {
  try {
    const scope = (req.body?.scope || 'reports') as AdminCaseScope;
    if (!['reports', 'pathology', 'bugs'].includes(scope)) {
      return res.status(400).json({ success: false, error: 'Scope không hợp lệ.' });
    }

    const preset = String(req.body?.preset || 'all');
    const startDate = typeof req.body?.startDate === 'string' ? req.body.startDate : undefined;
    const endDate = typeof req.body?.endDate === 'string' ? req.body.endDate : undefined;
    const status = typeof req.body?.status === 'string' ? req.body.status : 'ALL';
    const sourceFilter = typeof req.body?.source === 'string' ? req.body.source : 'all';
    const lang = (req.body?.language === 'EN' ? 'EN' : 'VI') as 'VI' | 'EN';

    const filter = { preset, startDate, endDate };
    const storageAdapter = getStorageAdapter();
    const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : null;
    const cache = getOrInitServerCache();

    // Snapshot start timestamp to prevent infinite loops if new writes happen during export loop
    const exportStartedAt = new Date().toISOString();

    let fetchedDocs: any[] = [];

    if (db) {
      const collectionName = ADMIN_CASE_COLLECTIONS[scope];
      let baseQuery: any = db.collection(collectionName);

      const bounds = getAdminDateBounds(filter);
      if (bounds.start) baseQuery = baseQuery.where('timestamp', '>=', bounds.start);
      if (bounds.end) baseQuery = baseQuery.where('timestamp', '<=', bounds.end);
      baseQuery = baseQuery.where('timestamp', '<=', exportStartedAt);

      baseQuery = baseQuery.orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc');

      const EXPORT_BATCH_SIZE = 250;
      let lastDocSnap: any = null;
      let hasMore = true;

      while (hasMore) {
        let pageQuery = baseQuery.limit(EXPORT_BATCH_SIZE);
        if (lastDocSnap) {
          pageQuery = pageQuery.startAfter(lastDocSnap);
        }
        const snapshot = await pageQuery.get();
        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batchRecords = snapshot.docs.map((doc: any) => {
          const data = doc.data();
          const normalized = scope === 'pathology'
            ? restorePathologyDocFromFirestore({ ...data, assessmentId: data.assessmentId || doc.id, _id: doc.id })
            : data;
          const idField = scope === 'bugs' ? 'bugId' : 'assessmentId';
          return { ...normalized, [idField]: normalized[idField] || doc.id };
        });

        fetchedDocs.push(...batchRecords);

        if (snapshot.docs.length < EXPORT_BATCH_SIZE) {
          hasMore = false;
        } else {
          lastDocSnap = snapshot.docs[snapshot.docs.length - 1];
        }
      }
    } else {
      // Local RAM cache fallback
      const cacheRecords = scope === 'reports'
        ? cache.reports
        : scope === 'pathology'
        ? cache.seg_reports || []
        : cache.bugs;
      fetchedDocs = filterRecordsByDateRange(cacheRecords || [], filter);
      fetchedDocs = sortAdminScopeRecords(scope, fetchedDocs);
    }

    // Apply exact canonical date range filter in memory
    fetchedDocs = filterRecordsByDateRange(fetchedDocs, filter);

    // Apply secondary status or source filter
    let filteredRecords = fetchedDocs;

    if (scope === 'reports' || scope === 'pathology') {
      if (status && status !== 'ALL') {
        filteredRecords = filteredRecords.filter((log: any) => {
          const st = getLogStatusServer(log);
          return st === status;
        });
      }
    } else if (scope === 'bugs') {
      if (sourceFilter && sourceFilter !== 'all') {
        filteredRecords = filteredRecords.filter((bug: any) => {
          const bugSource = bug.source || 'USER_SUBMITTED';
          return bugSource === sourceFilter;
        });
      }
    }

    // Build standard export dataset
    const bundle = buildAdminExportBundle(scope, filteredRecords, lang);

    return res.json({
      success: true,
      scope,
      totalCount: bundle.rows.length,
      title: bundle.title,
      headers: bundle.headers,
      rows: bundle.rows,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AdminExport', `Export query failed: ${err.message}`, err);
    return res.status(500).json({ success: false, error: err?.message || 'Export failed' });
  }
});

// Restore backup
router.post('/api/admin/restore-backup', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const backupData = req.body;
    
    if (!backupData || typeof backupData !== 'object') {
      return res.status(400).json({ success: false, error: 'Dữ liệu backup không hợp lệ' });
    }

    const collectionsData = backupData.data || backupData;
    
    if (!collectionsData || typeof collectionsData !== 'object') {
      return res.status(400).json({ success: false, error: 'Cấu trúc file backup bị lỗi' });
    }

    let restoredReportsCount = 0;
    let restoredBugsCount = 0;

    // Restore backup with batching to prevent OOM / connection exhaustion
    const BATCH_SIZE = 50;

    if (Array.isArray(collectionsData.reports)) {
      for (let i = 0; i < collectionsData.reports.length; i += BATCH_SIZE) {
        const batch = collectionsData.reports.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (item: any) => {
            const { _id, ...cleanReport } = item;
            await storageAdapter.saveLog(cleanReport, cleanReport.imageUrl);
          })
        );
      }
      restoredReportsCount = collectionsData.reports.length;
    }

    if (Array.isArray(collectionsData.bugs)) {
      for (let i = 0; i < collectionsData.bugs.length; i += BATCH_SIZE) {
        const batch = collectionsData.bugs.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (item: any) => {
            const { _id, ...cleanBug } = item;
            await storageAdapter.saveBug(cleanBug);
          })
        );
      }
      restoredBugsCount = collectionsData.bugs.length;
    }

    return res.json({
      success: true,
      message: `Khôi phục thành công ${restoredReportsCount} đánh giá và ${restoredBugsCount} báo cáo lỗi!`,
      restoredReportsCount,
      restoredBugsCount,
    });
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('ERROR', 'AdminRoute', '[Restore Backup Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Lỗi khi khôi phục dữ liệu' });
  }
});

router.post('/api/admin/rebuild-stats', adminAuth, async (_req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : getFirestoreInstance();
    if (!db) {
      return res.status(400).json({ success: false, error: 'Firestore is not initialized' });
    }
    const result = await rebuildSystemStats(db);
    return res.json({ success: true, result });
  } catch (error: any) {
    serverLog('ERROR', 'AdminRoute', '[Rebuild Stats Error]:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Lỗi hệ thống khi rebuild stats' });
  }
});

export default router;
