import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { adminAuth } from './authRoutes';
import { adminDeleteLimiter, adminSyncLimiter } from '../config/limiter';
import { serverLog } from '../config/env';
import { getStorageAdapter, getOrInitServerCache, FirebaseStorageAdapter, computeSystemMetrics } from '../services/storageAdapter';
import { getSystemMetadata, recalculateAndPersistSystemMetadata, aggregateMetadataForDateRange, filterRecordsByDateRange } from '../services/systemMetadataService';
import { runAutoSyncJob, getIsAutoSyncRunning } from '../jobs/syncJob';
import { getFirestoreInstance } from '../services/firebaseService';
import { restorePathologyDocFromFirestore } from '../services/firestorePathologyService';

const router = Router();

// Sync status inspection endpoint
router.get('/api/admin/sync-status', adminAuth, (req: Request, res: Response) => {
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

// Manual trigger sync endpoint
router.post('/api/admin/trigger-sync', adminAuth, async (req: Request, res: Response) => {
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

// Sync full cache from Firestore helper
let isSyncingCache = false;

async function syncFullCacheFromFirestore(db: any) {
  if (isSyncingCache) return; // Prevent concurrent sync calls
  isSyncingCache = true;
  try {
    const cache = getOrInitServerCache();
    
    // Fetch all collections and system metadata concurrently in parallel to speed up sync
    const [reportsSnapshot, bugsSnapshot, segSnapshot, metricsData] = await Promise.all([
      db.collection('reports').orderBy('timestamp', 'desc').limit(100).get(),
      db.collection('bugs').orderBy('timestamp', 'desc').limit(100).get(),
      db.collection('seg_reports').orderBy('timestamp', 'desc').limit(100).get(),
      getSystemMetadata(db),
    ]);
    
    // 1. Sync Reports (Luồng A)
    if (!reportsSnapshot.empty) {
      const mergedMap = new Map();
      // Load Firestore source of truth
      reportsSnapshot.forEach((doc: any) => {
        const data = doc.data();
        const id = data.assessmentId || data.id || doc.id;
        if (id) {
          mergedMap.set(id, { ...data, assessmentId: id, firestoreSynced: true });
        }
      });
      // Overlay local unsynced (newer) data to avoid overwriting recent updates
      cache.reports.filter(r => r.firestoreSynced !== true).forEach(r => {
        const id = r.assessmentId || r.id;
        if (id) mergedMap.set(id, r);
      });
      cache.reports = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.updatedAt || a.timestamp || 0).getTime();
        const tB = new Date(b.updatedAt || b.timestamp || 0).getTime();
        return tB - tA;
      });
    }

    // 2. Sync Bugs
    if (!bugsSnapshot.empty) {
      const mergedMap = new Map();
      bugsSnapshot.forEach((doc: any) => {
        const data = doc.data();
        const id = data.bugId || data.id || doc.id;
        if (id) {
          mergedMap.set(id, { ...data, bugId: id, firestoreSynced: true });
        }
      });
      cache.bugs.filter(b => b.firestoreSynced !== true).forEach(b => {
        const id = b.bugId || b.id;
        if (id) mergedMap.set(id, b);
      });
      cache.bugs = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tB - tA;
      });
    }

    // 3. Sync Seg_Reports (Luồng B - Pathology)
    if (!segSnapshot.empty) {
      const mergedMap = new Map();
      segSnapshot.forEach((doc: any) => {
        const data = doc.data();
        const id = data.assessmentId || data.id || doc.id;
        if (id) {
          const restored = restorePathologyDocFromFirestore({ ...data, assessmentId: id, _id: doc.id });
          mergedMap.set(id, { ...restored, assessmentId: id, firestoreSynced: true });
        }
      });
      (cache.seg_reports || []).filter(r => r.firestoreSynced !== true).forEach(r => {
        const id = r.assessmentId || r.id;
        if (id) mergedMap.set(id, r);
      });
      cache.seg_reports = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.updatedAt || a.timestamp || 0).getTime();
        const tB = new Date(b.updatedAt || b.timestamp || 0).getTime();
        return tB - tA;
      });
    }

    // 4. Sync System Metadata Document (dashboard)
    if (metricsData) {
      cache.systemMetrics = metricsData;
    }

    cache.lastUpdated = new Date().toISOString();
  } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
    serverLog('WARN', 'SyncCache', 'Không thể sync từ Firestore', err?.message || err);
  } finally {
    isSyncingCache = false;
  }
}

// Firestore / RAM data inspection endpoint
router.get('/api/firestore-data', adminAuth, async (req: Request, res: Response) => {
  const force = req.query.force === 'true';
  if (force) {
    return adminSyncLimiter(req, res, () => handleFirestoreData(req, res, true));
  }
  return handleFirestoreData(req, res, false);
});

// Admin stats aggregation endpoint
router.get('/api/admin/summary-stats', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const cache = getOrInitServerCache();

    if (cache.reports.length === 0 && storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      try {
        await syncFullCacheFromFirestore(storageAdapter.getDb());
      } catch (unknownError: unknown) {
    const syncErr = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
        console.warn('[Cache Auto-Init Sync Error on stats]:', syncErr?.message || syncErr);
      }
    }

    let totalSessions = 0;
    let totalConcurred = 0;
    const errorDistribution: Record<string, number> = {};

    if (storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      const db = storageAdapter.getDb();
      const statsDoc = await db.collection('system_metrics').doc('dashboard').get();
      if (statsDoc.exists) {
        const data = statsDoc.data();
        totalSessions = data?.totalSessions || 0;
        totalConcurred = data?.totalConcurred || 0;
        Object.assign(errorDistribution, data?.errorDistribution || {});
      } else {
        const countSnap = await db.collection('reports').count().get();
        totalSessions = countSnap.data().count;
      }
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

    // 1. If cache is dirty (has unsynced reports/bugs), flush to Firestore first
    if (cache.isCacheDirty && isFirebase) {
      try {
        await runAutoSyncJob();
      } catch (unknownError: unknown) {
    const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
        serverLog('WARN', 'AutoSyncOnOpen', 'Lỗi đồng bộ ngầm khi mở portal', err?.message || err);
      }
    }

    // 2. Ensure Realtime Snapshot Stream is active
    if (storageAdapter instanceof FirebaseStorageAdapter && storageAdapter.getDb()) {
      // Only do a manual full query if force refresh requested or cache is completely empty
      if ((force || cache.reports.length === 0)) {
        try {
          await syncFullCacheFromFirestore(storageAdapter.getDb());
        } catch (unknownError: unknown) {
    const syncErr = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
          serverLog('WARN', 'CacheSyncOnForce', 'Lỗi sync từ Firestore khi force refresh', syncErr?.message || syncErr);
        }
      }
    }

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
        if (force) {
          systemMetrics = await recalculateAndPersistSystemMetadata(db, cache);
          cache.systemMetrics = systemMetrics;
        } else {
          const metaData = await getSystemMetadata(db);
          if (metaData) {
            systemMetrics = metaData;
            cache.systemMetrics = systemMetrics;
          }
        }
      } catch (e) {
        serverLog('WARN', 'MetricsFetchError', 'Could not fetch system_metrics document', (e as any)?.message || e);
      }
    }

    if (!systemMetrics) {
      systemMetrics = computeSystemMetrics(cache.reports || [], cache.seg_reports || [], cache.bugs || []);
      cache.systemMetrics = systemMetrics;
    }

    const filteredSystemMetrics = aggregateMetadataForDateRange(systemMetrics, {
      preset,
      startDate,
      endDate,
    });

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

// Endpoint to fetch aggregated system metadata for specific date ranges directly from system_metadata document
router.get('/api/admin/metadata', adminAuth, async (req: Request, res: Response) => {
  try {
    const storageAdapter = getStorageAdapter();
    const db = storageAdapter instanceof FirebaseStorageAdapter ? storageAdapter.getDb() : getFirestoreInstance();
    
    let rawMetadata = await getSystemMetadata(db);
    if (!rawMetadata) {
      const cache = getOrInitServerCache();
      rawMetadata = cache.systemMetrics || computeSystemMetrics(cache.reports || [], cache.seg_reports || [], cache.bugs || []);
    }

    const preset = (req.query.preset || req.query.datePreset || 'all') as string;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const filteredMetadata = aggregateMetadataForDateRange(rawMetadata, {
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

    const metadataDoc = await getSystemMetadata(db);
    const metadataCounts = {
      reports: metadataDoc?.reports?.totalSessions ?? 0,
      seg_reports: metadataDoc?.pathology?.totalPathologyLogs ?? 0,
      bugs: metadataDoc?.bugs?.totalBugs ?? 0,
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
    if (drift.reports !== 0 || drift.seg_reports !== 0 || drift.bugs !== 0 || req.query.fix === 'true') {
      repairedMetadata = await recalculateAndPersistSystemMetadata(db);
      cache.systemMetrics = repairedMetadata;
    }

    return res.json({
      success: true,
      rawCounts,
      metadataCounts,
      cacheCounts,
      drift,
      hasDrift: drift.reports !== 0 || drift.seg_reports !== 0 || drift.bugs !== 0,
      repairedMetadata: repairedMetadata || metadataDoc,
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

export default router;
