import { isLogIncompleteHelper as isLogIncomplete, isLogErrorHelper as isLogError, parseTimestampToMsHelper } from '../utils/metadataHelpers';
import fs from 'fs';
import crypto from 'crypto';
import { saveAndOptimizeImageFile, deleteImageFile, serverLog } from '../config/env';
import {
  assertStoragePathSafe,
  getCacheFilePath,
  getStorageRoot,
  isStorageTestOfflineMode,
} from '../config/storagePaths';
import { getFirestoreInstance } from './firebaseService';
import {
  executeAtomicReportWrite,
  executeAtomicReportDelete,
  executeAtomicBugWrite,
  executeAtomicBugDelete,
  executeAtomicPathologyDelete,
  executeAtomicBulkDelete,
} from './atomicUpdateService';
import { preserveImmutableInferenceLineage } from './inferenceLineage';
import {
  appendTechnicalReview,
  mergeTechnicalEvaluation,
  readTechnicalEvaluation,
} from '../../utils/technicalEvaluation';

export interface IStorageAdapter {
  type: string;
  saveLog(payload: any, imageDataUrl?: string): Promise<{ success: boolean; assessmentId: string; imageUrl: string; shareConsent: boolean; firestoreSynced: boolean }>;
  getLogs(limitCount?: number): Promise<any[]>;
  getLogById(assessmentId: string): Promise<any | null>;
  saveBug(bugData: any): Promise<{ success: boolean }>;
  getBugs(limitCount?: number): Promise<any[]>;
  verifyAssessment(
    assessmentId: string,
    verifiedErrors: any,
    verifiedNotes?: string,
    reviewerId?: string,
    reviewedAt?: string,
  ): Promise<{ success: boolean; log: any }>;
  deleteData(options: {
    timeConfig?: string | { isAllTime?: boolean; startDate?: string; endDate?: string };
    startDate?: string;
    endDate?: string;
    deleteTypes?: string[];
  }): Promise<{ success: boolean; deletedCount: number; message: string }>;
  deleteDocument(collection: 'reports' | 'bugs' | 'seg_reports', docId: string): Promise<{ success: boolean; deletedCount: number; message: string }>;
}

export function calculateAccuracyScore(aiAnalysis: any, finalConfirmedErrors: string[]): { score: string; aiSummary: string; finalSummary: string } {
  if (!aiAnalysis || !aiAnalysis.findings) {
    return { score: 'Chưa đánh giá', aiSummary: 'Không có dữ liệu AI', finalSummary: 'Chưa chốt lỗi' };
  }

  const aiDetectedKeys = new Set<string>();
  aiAnalysis.findings.forEach((f: any) => {
    if (f.detectedErrors && Array.isArray(f.detectedErrors)) {
      f.detectedErrors.forEach((e: any) => {
        if (e.errorKey) aiDetectedKeys.add(e.errorKey);
      });
    }
  });

  const aiKeysArray = Array.from(aiDetectedKeys);
  const finalKeysArray = Array.from(new Set(finalConfirmedErrors || []));

  const aiSummary = aiKeysArray.length > 0 ? aiKeysArray.join(', ') : 'Không có lỗi';
  const finalSummary = finalKeysArray.length > 0 ? finalKeysArray.join(', ') : 'Không có lỗi';

  if (aiKeysArray.length === 0 && finalKeysArray.length === 0) {
    return { score: 'Chính xác 100% (Phim chuẩn)', aiSummary, finalSummary };
  }

  const tp = aiKeysArray.filter(k => finalKeysArray.includes(k)).length;
  const fp = aiKeysArray.filter(k => !finalKeysArray.includes(k)).length;
  const fn = finalKeysArray.filter(k => !aiKeysArray.includes(k)).length;

  if (fp === 0 && fn === 0) {
    return { score: 'Chính xác 100% (Trùng khớp hoàn toàn)', aiSummary, finalSummary };
  }

  const totalErrors = new Set([...aiKeysArray, ...finalKeysArray]).size;
  const accuracyPercent = Math.max(0, Math.round((tp / totalErrors) * 100));

  let detailNote = '';
  if (fp > 0 && fn > 0) {
    detailNote = ` (AI nhận diện thừa ${fp} lỗi, bỏ sót ${fn} lỗi)`;
  } else if (fp > 0) {
    detailNote = ` (AI nhận diện thừa ${fp} lỗi)`;
  } else if (fn > 0) {
    detailNote = ` (AI bỏ sót ${fn} lỗi)`;
  }

  return {
    score: `${accuracyPercent}%${detailNote}`,
    aiSummary,
    finalSummary,
  };
}


export function isTimestampInDateRange(
  timestamp?: string | number | null,
  updatedAt?: string | number | null,
  createdAt?: string | number | null,
  startDateStr?: string,
  endDateStr?: string
): boolean {
  if (!startDateStr && !endDateStr) return true;
  const ms = parseTimestampToMsHelper(timestamp, updatedAt, createdAt);
  if (!ms) return false;

  const itemDate = new Date(ms);
  if (startDateStr) {
    const s = new Date(startDateStr);
    s.setHours(0, 0, 0, 0);
    if (itemDate < s) return false;
  }
  if (endDateStr) {
    const e = new Date(endDateStr);
    e.setHours(23, 59, 59, 999);
    if (itemDate > e) return false;
  }
  return true;
}



export function isLogTest(log: any): boolean {
  if (!log) return false;
  if (log.userNotes && log.userNotes.toLowerCase().includes('test')) return true;
  if (log.verifiedNotes && log.verifiedNotes.toLowerCase().includes('test')) return true;
  return false;
}

function isLogComplete(log: any): boolean {
  if (!log) return false;
  return log.sessionStatus === 'COMPLETED' ||
    log.lastCompletedStep === 5 ||
    Boolean(log.stage && (log.stage.includes('Bước 5') || log.stage.includes('Step 5')));
}

function isPathologyLogIncomplete(log: any): boolean {
  if (!log) return false;
  return log.sessionStatus === 'INCOMPLETE' ||
    (log.lastCompletedStep !== undefined && log.lastCompletedStep < 5);
}

function matchesDeleteTime(
  item: any,
  timeConfig: string,
  startDate: string | undefined,
  endDate: string | undefined,
  now: number,
): boolean {
  if (timeConfig === 'all') return true;
  if (timeConfig === 'custom') {
    return isTimestampInDateRange(item.timestamp, item.updatedAt, item.createdAt, startDate, endDate);
  }

  const itemMs = parseTimestampToMsHelper(item.timestamp, item.updatedAt, item.createdAt);
  if (timeConfig === '24h') return now - itemMs < 24 * 60 * 60 * 1000;
  if (timeConfig === '7d') return now - itemMs < 7 * 24 * 60 * 60 * 1000;
  if (timeConfig === '30d') return now - itemMs < 30 * 24 * 60 * 60 * 1000;

  // These legacy timeConfig values encode a type-only request, so the time
  // dimension is inactive and must not narrow the matching status category.
  return timeConfig === 'incomplete' || timeConfig === 'errors' || timeConfig === 'tests';
}

import { SystemMetrics } from '../../types/dental';

// ===================================================
// Phase 1: High-Performance Cache Memory Structure with Dirty Flag
// ===================================================
export interface ServerCacheStructure {
  reports: any[];
  seg_reports: any[];
  bugs: any[];
  systemMetrics?: SystemMetrics;
  lastUpdated: string;
  // Disk persistence state only. Firestore retry eligibility is derived from
  // each record's firestoreSynced flag and must never use this field.
  isCacheDirty: boolean;
  diskMutationGeneration: number;
  diskPersistedGeneration: number;
}

import {
  createEmptyStats,
  reportContributions,
  pathologyContributions,
  bugContributions,
  SystemStatsDoc,
  rebuildSystemStats,
  getDateKeyFromLog,
} from './systemStatsService';

export function computeSystemMetrics(
  reports: any[] = [],
  segReports: any[] = [],
  bugs: any[] = []
): SystemStatsDoc {
  const stats = createEmptyStats();
  const applyContrib = (contribs: Record<string, number>) => {
    for (const [k, v] of Object.entries(contribs)) {
      if (k.startsWith('reports.')) {
        const sub = k.replace('reports.', '');
        if (sub.startsWith('accuracyCounts.')) {
          const accKey = sub.replace('accuracyCounts.', '');
          (stats.reports.accuracyCounts as any)[accKey] = ((stats.reports.accuracyCounts as any)[accKey] || 0) + v;
        } else if (sub.startsWith('errorDistribution.')) {
          const errKey = sub.replace('errorDistribution.', '');
          stats.reports.errorDistribution[errKey] = (stats.reports.errorDistribution[errKey] || 0) + v;
        } else {
          (stats.reports as any)[sub] = ((stats.reports as any)[sub] || 0) + v;
        }
      } else if (k.startsWith('pathology.')) {
        const sub = k.replace('pathology.', '');
        if (sub.startsWith('pathologyDistribution.')) {
          const pathKey = sub.replace('pathologyDistribution.', '');
          stats.pathology.pathologyDistribution[pathKey] = (stats.pathology.pathologyDistribution[pathKey] || 0) + v;
        } else if (sub.startsWith('toothDistribution.')) {
          const toothKey = sub.replace('toothDistribution.', '');
          stats.pathology.toothDistribution[toothKey] = (stats.pathology.toothDistribution[toothKey] || 0) + v;
        } else {
          (stats.pathology as any)[sub] = ((stats.pathology as any)[sub] || 0) + v;
        }
      } else if (k.startsWith('bugs.')) {
        const sub = k.replace('bugs.', '');
        if (sub.startsWith('severityDistribution.')) {
          const sevKey = sub.replace('severityDistribution.', '');
          (stats.bugs.severityDistribution as any)[sevKey] = ((stats.bugs.severityDistribution as any)[sevKey] || 0) + v;
        } else if (sub.startsWith('statusDistribution.')) {
          const stKey = sub.replace('statusDistribution.', '');
          (stats.bugs.statusDistribution as any)[stKey] = ((stats.bugs.statusDistribution as any)[stKey] || 0) + v;
        } else if (sub.startsWith('sourceDistribution.')) {
          const srcKey = sub.replace('sourceDistribution.', '');
          (stats.bugs.sourceDistribution as any)[srcKey] = ((stats.bugs.sourceDistribution as any)[srcKey] || 0) + v;
        } else {
          (stats.bugs as any)[sub] = ((stats.bugs as any)[sub] || 0) + v;
        }
      }
    }
  };

  reports.forEach(r => applyContrib(reportContributions(r)));
  segReports.forEach(p => applyContrib(pathologyContributions(p)));
  bugs.forEach(b => applyContrib(bugContributions(b)));

  const allTimeUsers = new Set<string>();
  const todayUsers = new Set<string>();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const trackUser = (r: any) => {
    const uid = r.userId || r.deviceId || r.user_id || r.device_id;
    if (uid && typeof uid === 'string' && uid.trim()) {
      const cleanUid = uid.trim();
      allTimeUsers.add(cleanUid);
      const itemDate = getDateKeyFromLog(r);
      if (itemDate === todayStr) {
        todayUsers.add(cleanUid);
      }
    }
  };

  reports.forEach(trackUser);
  segReports.forEach(trackUser);

  stats.users.uniqueUsersCount = allTimeUsers.size;
  stats.users.activeUsersCount = todayUsers.size;

  return stats;
}

export async function recalculateAndPersistMetrics(db?: any): Promise<SystemStatsDoc> {
  const cache = getOrInitServerCache();
  let metrics: SystemStatsDoc;
  if (db) {
    metrics = await rebuildSystemStats(db);
  } else {
    metrics = computeSystemMetrics(cache.reports || [], cache.seg_reports || [], cache.bugs || []);
  }
  cache.systemMetrics = metrics;
  markServerCacheDirty(cache);
  saveServerCacheToDisk();
  return metrics;
}

let serverTempCache: ServerCacheStructure | null = null;
let serverTempCacheRoot: string | null = null;

export function getOrInitServerCache(): ServerCacheStructure {
  const storageRoot = getStorageRoot();
  const tempCacheFile = assertStoragePathSafe(getCacheFilePath());
  if (!serverTempCache || serverTempCacheRoot !== storageRoot) {
    serverTempCacheRoot = storageRoot;
    serverTempCache = {
      reports: [],
      seg_reports: [],
      bugs: [],
      lastUpdated: new Date().toISOString(),
      isCacheDirty: false,
      diskMutationGeneration: 0,
      diskPersistedGeneration: 0,
    };
    if (fs.existsSync(tempCacheFile)) {
      try {
        const raw = fs.readFileSync(tempCacheFile, 'utf8');
        const parsed = JSON.parse(raw);
        serverTempCache.reports = Array.isArray(parsed.reports) ? parsed.reports : [];
        serverTempCache.seg_reports = Array.isArray(parsed.seg_reports)
          ? parsed.seg_reports
          : Array.isArray(parsed.segReports)
          ? parsed.segReports
          : [];
        serverTempCache.bugs = Array.isArray(parsed.bugs) ? parsed.bugs : [];
        serverTempCache.systemMetrics = parsed.systemMetrics || undefined;
        serverTempCache.lastUpdated = parsed.lastUpdated || new Date().toISOString();
        serverTempCache.isCacheDirty = false;
        serverTempCache.diskMutationGeneration = 0;
        serverTempCache.diskPersistedGeneration = 0;
      } catch (e) {
        console.warn('[Cache Init Warning]: Unable to read temp_cache.json', e);
      }
    }
  }
  return serverTempCache;
}


let isSavingCache = false;
let activeCacheWrite: Promise<void> | null = null;
let storageTestWriteFile: ((filePath: string, data: string) => Promise<void>) | null = null;

/** Marks a local cache mutation for disk persistence. Remote sync state is separate. */
export function markServerCacheDirty(cache = getOrInitServerCache()): void {
  cache.diskMutationGeneration += 1;
  cache.isCacheDirty = true;
}

export function configureCacheWriteForStorageTests(writer: (filePath: string, data: string) => Promise<void>): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Controlled cache writes are available only inside an R17 offline sandbox.');
  }
  storageTestWriteFile = writer;
}

export function resetCacheWriteForStorageTests(): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Controlled cache writes are available only inside an R17 offline sandbox.');
  }
  storageTestWriteFile = null;
}

export function getDiskPersistenceStateForTests(): { dirty: boolean; mutationGeneration: number; persistedGeneration: number } {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Disk persistence state is available only inside an R17 offline sandbox.');
  }
  const cache = getOrInitServerCache();
  return {
    dirty: cache.isCacheDirty,
    mutationGeneration: cache.diskMutationGeneration,
    persistedGeneration: cache.diskPersistedGeneration,
  };
}

function isTestExecutionActive(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((a) => a === "--test" || a.includes(".test.") || a.includes("test/"))
  );
}

export function saveServerCacheToDisk(force = false, sync = false) {
  // CRITICAL: Prevent unisolated test execution from mutating production workspace temp_cache.json
  if (isTestExecutionActive() && !isStorageTestOfflineMode()) {
    return;
  }

  const cache = getOrInitServerCache();
  if (!force && !cache.isCacheDirty) return; // Skip disk I/O if cache is clean
  if (isSavingCache) return; // The active owner drains newer generations, including sync triggers.

  const tempCacheFile = assertStoragePathSafe(getCacheFilePath());
  const temporaryFile = assertStoragePathSafe(`${tempCacheFile}.tmp.${process.pid}.${crypto.randomUUID()}`);
  try {
    const writeGeneration = cache.diskMutationGeneration;
    cache.lastUpdated = new Date().toISOString();
    const data = JSON.stringify({
      reports: cache.reports,
      seg_reports: cache.seg_reports,
      bugs: cache.bugs,
      systemMetrics: cache.systemMetrics,
      lastUpdated: cache.lastUpdated,
    });

    if (sync) {
      fs.writeFileSync(temporaryFile, data, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryFile, tempCacheFile);
      if (cache.diskMutationGeneration === writeGeneration) {
        cache.diskPersistedGeneration = writeGeneration;
        cache.isCacheDirty = false;
      }
    } else {
      isSavingCache = true;
      let committed = false;
      const write = storageTestWriteFile
        ? storageTestWriteFile(temporaryFile, data)
        : fs.promises.writeFile(temporaryFile, data, { encoding: 'utf8', flag: 'wx' });
      activeCacheWrite = write
        .then(() => fs.promises.rename(temporaryFile, tempCacheFile))
        .then(() => {
          committed = true;
          // A completed write owns only the generation captured above. A
          // later mutation remains dirty and schedules its own persistence.
          if (cache.diskMutationGeneration === writeGeneration) {
            cache.diskPersistedGeneration = writeGeneration;
            cache.isCacheDirty = false;
          }
        })
        .catch(async (e) => {
          await fs.promises.unlink(temporaryFile).catch(() => {});
          console.warn('[Cache Flush Error]: Unable to save temp_cache.json asynchronously; dirty state retained for the next save trigger', e);
        })
        .finally(() => {
          isSavingCache = false;
          activeCacheWrite = null;
          if (committed && cache.isCacheDirty) saveServerCacheToDisk();
        });
    }
  } catch (e) {
    try { fs.unlinkSync(temporaryFile); } catch {}
    console.warn('[Cache Flush Error]: Unable to persist temp_cache.json; dirty state retained for the next save trigger', e);
    isSavingCache = false;
  }
}

export async function waitForStorageIdleForTests(): Promise<void> {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Storage-idle test helper is available only inside an R17 offline sandbox.');
  }
  while (activeCacheWrite) {
    await activeCacheWrite;
  }
}

export function resetStorageStateForTests(): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Storage reset is available only inside an R17 offline sandbox.');
  }
  if (activeCacheWrite) {
    throw new Error('Wait for sandbox storage to become idle before resetting test state.');
  }
  serverTempCache = null;
  serverTempCacheRoot = null;
  isSavingCache = false;
  storageTestWriteFile = null;
  currentStorageAdapter = null;
  currentStorageAdapterKey = null;
}

// Flush RAM cache to disk on graceful server shutdown
export async function flushCacheOnShutdown() {
  // Do not race a synchronous replacement against an in-flight async writer.
  while (activeCacheWrite) await activeCacheWrite;
  const cache = getOrInitServerCache();
  if (cache.isCacheDirty) {
    saveServerCacheToDisk(true, true);
    if (!cache.isCacheDirty) serverLog('INFO', 'GracefulShutdown', 'Đã lưu toàn bộ RAM Cache xuống đĩa trước khi dừng Server.');
    else serverLog('ERROR', 'GracefulShutdown', 'Cache remains dirty after shutdown write failure.');
  }
}

// In-Memory Storage Adapter Implementation
export class InMemoryStorageAdapter implements IStorageAdapter {
  type = 'in_memory';

  async saveLog(payload: any, imageDataUrl?: string) {
    if (!payload.assessmentId) {
      payload.assessmentId = `perio_${Date.now()}_${crypto.randomUUID()}`;
    }
    payload.timestamp = payload.timestamp || new Date().toISOString();

    if (payload.aiAnalysis && payload.finalConfirmedErrors) {
      const isInvalidImage =
        payload.sessionStatus === 'FAILED_NON_DENTAL' ||
        payload.aiAnalysis.isPeriapicalRadiograph === false ||
        payload.aiAnalysis.overallQuality === 'Unsatisfactory' ||
        payload.finalConfirmedErrors.includes('not_periapical');

      const isCompleted =
        payload.sessionStatus === 'COMPLETED' ||
        payload.lastCompletedStep === 5 ||
        (payload.stage && payload.stage.includes('Bước 5'));

      if (isInvalidImage) {
        payload.accuracyScore = 'Không áp dụng (Ảnh không hợp lệ)';
        payload.aiDetectedErrorsSummary = 'Ảnh không hợp lệ';
        payload.finalConfirmedErrorsSummary = 'Ảnh không hợp lệ';
      } else if (!isCompleted) {
        payload.accuracyScore = 'Không áp dụng (Chưa hoàn thành)';
        const aiKeys = new Set<string>();
        payload.aiAnalysis.findings?.forEach((f: any) => {
          f.detectedErrors?.forEach((e: any) => {
            if (e.errorKey) aiKeys.add(e.errorKey);
          });
        });
        const aiArray = Array.from(aiKeys);
        payload.aiDetectedErrorsSummary = aiArray.length > 0 ? aiArray.join(', ') : 'Không có lỗi';
        payload.finalConfirmedErrorsSummary = 'Chưa chốt lỗi (Dở dang)';
      } else {
        const result = calculateAccuracyScore(payload.aiAnalysis, payload.finalConfirmedErrors);
        payload.accuracyScore = result.score;
        payload.aiDetectedErrorsSummary = result.aiSummary;
        payload.finalConfirmedErrorsSummary = result.finalSummary;
      }
    }

    let finalImageUrl = '';
    const userAgreedSharing = payload.shareConsent === true;

    let finalStorageKey = payload.imageStorageKey || '';
    if (userAgreedSharing) {
      payload.shareConsent = true;
      const rawImage = imageDataUrl || payload.imageUrl || "";
      if (rawImage && rawImage.startsWith("data:image")) {
        const optimized = await saveAndOptimizeImageFile(payload.assessmentId, rawImage);
        finalImageUrl = optimized.localUrl;
        finalStorageKey = optimized.imageStorageKey || '';
      } else {
        finalImageUrl = rawImage;
      }
      payload.imageUrl = finalImageUrl;
      payload.imageStorageKey = finalStorageKey;
    } else {
      payload.shareConsent = false;
      payload.imageUrl = "";
      payload.imageStorageKey = "";
      finalImageUrl = "";
    }

    const cache = getOrInitServerCache();
    const existingIndex = cache.reports.findIndex((l) => l.assessmentId === payload.assessmentId);
    const previousLineage = existingIndex >= 0
      ? cache.reports[existingIndex]?.aiAnalysis?.inferenceLineage
      : undefined;
    const immutableLineage = preserveImmutableInferenceLineage(previousLineage, payload.aiAnalysis?.inferenceLineage);
    const previousRecord = existingIndex >= 0 ? cache.reports[existingIndex] : undefined;
    const technicalEvaluation = mergeTechnicalEvaluation(previousRecord, payload.technicalEvaluation);
    const immutableAiAnalysis = technicalEvaluation?.aiPredictionSnapshot || payload.aiAnalysis;
    const logEntry = {
      ...payload,
      ...(technicalEvaluation ? { technicalEvaluation } : {}),
      ...(technicalEvaluation?.reviewState === 'reviewed' && technicalEvaluation.currentReview
        ? { finalConfirmedErrors: structuredClone(technicalEvaluation.currentReview.finalClassKeys) }
        : {}),
      ...(immutableAiAnalysis ? {
        aiAnalysis: {
          ...immutableAiAnalysis,
          ...(immutableLineage ? { inferenceLineage: immutableLineage } : {}),
        },
      } : {}),
      updatedAt: new Date().toISOString(),
      firestoreSynced: false,
    };

    if (existingIndex >= 0) {
      cache.reports[existingIndex] = { ...cache.reports[existingIndex], ...logEntry };
    } else {
      cache.reports.unshift(logEntry);
    }

    markServerCacheDirty(cache);
    saveServerCacheToDisk();

    return {
      success: true,
      assessmentId: payload.assessmentId,
      imageUrl: finalImageUrl,
      shareConsent: payload.shareConsent,
      firestoreSynced: false,
    };
  }

  async getLogs(limitCount?: number) {
    const cache = getOrInitServerCache();
    let logs = cache.reports || [];
    if (limitCount && limitCount > 0) {
      logs = logs.slice(0, limitCount);
    }
    return logs;
  }

  async getLogById(assessmentId: string) {
    const cache = getOrInitServerCache();
    return cache.reports.find(l => l.assessmentId === assessmentId) || null;
  }

  async saveBug(bugData: any) {
    const cache = getOrInitServerCache();
    const bugId = typeof bugData.bugId === 'string' && bugData.bugId.trim()
      ? bugData.bugId.trim()
      : `bug_${Date.now()}_${crypto.randomUUID()}`;
    bugData.bugId = bugId;
    const bugEntry = {
      bugId,
      timestamp: bugData.timestamp || new Date().toISOString(),
      description: bugData.description || 'Không có mô tả',
      path: bugData.path || 'N/A',
      source: bugData.source || 'USER_SUBMITTED',
      severity: bugData.severity || 'ERROR',
      status: bugData.status || 'OPEN',
      errorDetails: bugData.errorDetails || null,
      firestoreSynced: false,
    };
    const existingIndex = cache.bugs.findIndex((bug) => bug.bugId === bugId);
    if (existingIndex >= 0) {
      cache.bugs[existingIndex] = { ...cache.bugs[existingIndex], ...bugEntry };
    } else {
      cache.bugs.unshift(bugEntry);
    }
    markServerCacheDirty(cache);
    saveServerCacheToDisk();
    return { success: true };
  }

  async getBugs(limitCount?: number) {
    const cache = getOrInitServerCache();
    let bugs = cache.bugs || [];
    if (limitCount && limitCount > 0) {
      bugs = bugs.slice(0, limitCount);
    }
    return bugs;
  }

  async verifyAssessment(
    assessmentId: string,
    verifiedErrors: any,
    verifiedNotes?: string,
    reviewerId?: string,
    reviewedAt = new Date().toISOString(),
  ) {
    if (!reviewerId || reviewerId.startsWith('reviewer-unavailable:')) {
      throw new Error('A person-level reviewer ID is required.');
    }
    const cache = getOrInitServerCache();
    const index = cache.reports.findIndex(l => l.assessmentId === assessmentId);
    if (index === -1) {
      throw new Error(`Không tìm thấy đánh giá với ID: ${assessmentId}`);
    }

    const targetLog = cache.reports[index];
    const finalErrors = Array.isArray(verifiedErrors) ? verifiedErrors : [];
    const evaluation = appendTechnicalReview(readTechnicalEvaluation(targetLog), {
      reviewerId,
      reviewedAt,
      finalClassKeys: finalErrors,
      ...(verifiedNotes === undefined ? {} : { notes: verifiedNotes }),
    });
    targetLog.technicalEvaluation = evaluation;
    targetLog.aiAnalysis = structuredClone(evaluation.aiPredictionSnapshot);
    targetLog.finalConfirmedErrors = structuredClone(finalErrors);
    targetLog.verifiedErrors = structuredClone(finalErrors);
    targetLog.verifiedNotes = verifiedNotes || targetLog.verifiedNotes || '';
    targetLog.verifiedAt = reviewedAt;
    targetLog.verifiedBy = reviewerId;
    targetLog.firestoreSynced = false;

    if (targetLog.aiAnalysis) {
      const calcResult = calculateAccuracyScore(targetLog.aiAnalysis, finalErrors);
      targetLog.accuracyScore = calcResult.score;
      targetLog.aiDetectedErrorsSummary = calcResult.aiSummary;
      targetLog.finalConfirmedErrorsSummary = calcResult.finalSummary;
    }

    markServerCacheDirty(cache);
    saveServerCacheToDisk();
    return { success: true, log: targetLog };
  }

  async deleteData(options: {
    timeConfig?: string | { isAllTime?: boolean; startDate?: string; endDate?: string };
    startDate?: string;
    endDate?: string;
    deleteTypes?: string[];
  }) {
    const cache = getOrInitServerCache();
    const { timeConfig, deleteTypes = [] } = options;
    
    const effectiveTimeConfig = typeof timeConfig === 'string' ? timeConfig : (timeConfig?.isAllTime ? 'all' : 'custom');
    const effectiveStartDate = typeof timeConfig === 'object' ? timeConfig?.startDate || options.startDate : options.startDate;
    const effectiveEndDate = typeof timeConfig === 'object' ? timeConfig?.endDate || options.endDate : options.endDate;

    const now = Date.now();
    const initialCount = cache.reports.length + (cache.seg_reports?.length || 0) + cache.bugs.length;

    const hasAllType = deleteTypes.includes('all');
    const hasReports = hasAllType || deleteTypes.includes('reports') || deleteTypes.includes('complete') || deleteTypes.includes('incomplete') || deleteTypes.includes('errors') || deleteTypes.includes('test') || effectiveTimeConfig === 'incomplete' || effectiveTimeConfig === 'errors' || effectiveTimeConfig === 'tests';
    const hasSegReports = hasAllType || deleteTypes.includes('seg_reports') || deleteTypes.includes('pathology_reports') || deleteTypes.includes('complete') || deleteTypes.includes('incomplete') || deleteTypes.includes('errors') || deleteTypes.includes('test') || effectiveTimeConfig === 'incomplete' || effectiveTimeConfig === 'errors' || effectiveTimeConfig === 'tests';
    const hasBugs = hasAllType || deleteTypes.includes('bugs');

    if (hasReports) {
      cache.reports = cache.reports.filter(item => {
        const matchesTime = matchesDeleteTime(item, effectiveTimeConfig, effectiveStartDate, effectiveEndDate, now);
        const matchesType = hasAllType ||
          deleteTypes.includes('reports') ||
          (deleteTypes.includes('complete') && isLogComplete(item)) ||
          ((effectiveTimeConfig === 'incomplete' || deleteTypes.includes('incomplete')) && isLogIncomplete(item)) ||
          ((effectiveTimeConfig === 'errors' || deleteTypes.includes('errors')) && isLogError(item)) ||
          ((effectiveTimeConfig === 'tests' || deleteTypes.includes('test')) && isLogTest(item));
        const shouldDelete = matchesTime && matchesType;
        return !shouldDelete;
      });
    }

    if (hasSegReports) {
      cache.seg_reports = (cache.seg_reports || []).filter(item => {
        const matchesTime = matchesDeleteTime(item, effectiveTimeConfig, effectiveStartDate, effectiveEndDate, now);
        const matchesType = hasAllType ||
          deleteTypes.includes('seg_reports') ||
          deleteTypes.includes('pathology_reports') ||
          (deleteTypes.includes('complete') && isLogComplete(item)) ||
          ((effectiveTimeConfig === 'incomplete' || deleteTypes.includes('incomplete')) && isPathologyLogIncomplete(item)) ||
          ((effectiveTimeConfig === 'errors' || deleteTypes.includes('errors')) && item.sessionStatus === 'FAILED_NON_DENTAL') ||
          ((effectiveTimeConfig === 'tests' || deleteTypes.includes('test')) && isLogTest(item));
        const shouldDelete = matchesTime && matchesType;
        return !shouldDelete;
      });
    }

    if (hasBugs) {
      cache.bugs = cache.bugs.filter(item => {
        const matchesTime = matchesDeleteTime(item, effectiveTimeConfig, effectiveStartDate, effectiveEndDate, now);
        const matchesType = hasAllType || deleteTypes.includes('bugs');
        const shouldDelete = matchesTime && matchesType;
        return !shouldDelete;
      });
    }

    const remainingCount = cache.reports.length + (cache.seg_reports?.length || 0) + cache.bugs.length;
    const deletedCount = initialCount - remainingCount;

    markServerCacheDirty(cache);
    saveServerCacheToDisk(true);

    return {
      success: true,
      deletedCount,
      message: `Đã xóa thành công ${deletedCount} bản ghi.`,
    };
  }

  async deleteDocument(collection: 'reports' | 'bugs' | 'seg_reports', docId: string): Promise<{ success: boolean; deletedCount: number; message: string }> {
    const cache = getOrInitServerCache();
    let deletedCount = 0;

    if (collection === 'reports') {
      const initial = cache.reports.length;
      const target = cache.reports.find(r => r.assessmentId === docId || (r as any)._id === docId || (r as any).id === docId);
      if (target) {
        const keyToDelete = target.imageStorageKey || target.imageUrl;
        if (keyToDelete) {
          deleteImageFile(keyToDelete).catch(() => {});
        }
      }
      cache.reports = cache.reports.filter(r => r.assessmentId !== docId && (r as any)._id !== docId && (r as any).id !== docId);
      deletedCount = initial - cache.reports.length;
    } else if (collection === 'bugs') {
      const initial = cache.bugs.length;
      cache.bugs = cache.bugs.filter(b => b.bugId !== docId && (b as any)._id !== docId && (b as any).id !== docId);
      deletedCount = initial - cache.bugs.length;
    } else if (collection === 'seg_reports') {
      const initial = (cache.seg_reports || []).length;
      const target = (cache.seg_reports || []).find(p => p.assessmentId === docId || (p as any)._id === docId || (p as any).id === docId);
      if (target) {
        const keyToDelete = target.imageStorageKey || target.imageUrl;
        if (keyToDelete) {
          deleteImageFile(keyToDelete).catch(() => {});
        }
      }
      cache.seg_reports = (cache.seg_reports || []).filter(p => p.assessmentId !== docId && (p as any)._id !== docId && (p as any).id !== docId);
      deletedCount = initial - (cache.seg_reports || []).length;
    }

    markServerCacheDirty(cache);
    saveServerCacheToDisk(true);

    return {
      success: true,
      deletedCount,
      message: deletedCount > 0 ? `Đã xóa bản ghi ${docId} thành công.` : `Không tìm thấy bản ghi ${docId}.`,
    };
  }
}

// Firebase Cloud Storage Adapter Implementation
export class FirebaseStorageAdapter extends InMemoryStorageAdapter {
  type = 'firebase';

  getDb() {
    return getFirestoreInstance();
  }

  async saveLog(payload: any, imageDataUrl?: string) {
    const inMemoryResult = await super.saveLog(payload, imageDataUrl);
    const db = getFirestoreInstance();

    if (db) {
      try {
        const cache = getOrInitServerCache();
        const logEntry = cache.reports.find(r => r.assessmentId === inMemoryResult.assessmentId);
        if (logEntry) {
          const payloadToSync = {
            ...logEntry,
            firestoreSynced: true,
            lastSyncedAt: new Date().toISOString(),
          };

          const atomicResult = await executeAtomicReportWrite(db, inMemoryResult.assessmentId, payloadToSync);
          if (atomicResult.success) {
            logEntry.firestoreSynced = true;
            markServerCacheDirty(cache);
            saveServerCacheToDisk();
          }

          return {
            ...inMemoryResult,
            firestoreSynced: atomicResult.success,
          };
        }
      } catch (err: any) {
        serverLog('WARN', 'FirestoreSaveLog', 'Không thể đồng bộ Firestore tức thì, đã lưu vào RAM Cache', err?.message || err);
      }
    }

    return inMemoryResult;
  }

  async saveBug(bugData: any) {
    const inMemoryResult = await super.saveBug(bugData);
    const db = getFirestoreInstance();

    if (db) {
      try {
        const cache = getOrInitServerCache();
        const savedBug = cache.bugs.find((bug) => bug.bugId === bugData.bugId);
        if (savedBug) {
          const payloadToSync = {
            ...savedBug,
            firestoreSynced: true,
            lastSyncedAt: new Date().toISOString(),
          };

          const atomicResult = await executeAtomicBugWrite(db, savedBug.bugId, payloadToSync);
          if (atomicResult.success) {
            savedBug.firestoreSynced = true;
            markServerCacheDirty(cache);
            saveServerCacheToDisk();
          }
        }
      } catch (err: any) {
        serverLog('WARN', 'FirestoreSaveBug', 'Không thể lưu bug trực tiếp vào Firestore', err?.message || err);
      }
    }

    return inMemoryResult;
  }

  async getLogs(limitCount: number = 100) {
    const cache = getOrInitServerCache();
    if (cache.reports && cache.reports.length > 0) {
      return cache.reports.slice(0, limitCount);
    }
    const db = getFirestoreInstance();
    if (db) {
      try {
        const snapshot = await db.collection('reports').orderBy('timestamp', 'desc').limit(limitCount).get();
        const docs: any[] = [];
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          const id = data.assessmentId || doc.id;
          docs.push({ ...data, assessmentId: id, firestoreSynced: true });
        });
        cache.reports = docs;
        return docs;
      } catch (err: any) {
        serverLog('WARN', 'StorageAdapter', 'Failed to fetch logs from Firestore', err?.message || err);
      }
    }
    return (cache.reports || []).slice(0, limitCount);
  }

  async getBugs(limitCount: number = 100) {
    const cache = getOrInitServerCache();
    if (cache.bugs && cache.bugs.length > 0) {
      return cache.bugs.slice(0, limitCount);
    }
    const db = getFirestoreInstance();
    if (db) {
      try {
        const snapshot = await db.collection('bugs').orderBy('timestamp', 'desc').limit(limitCount).get();
        const docs: any[] = [];
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          const id = data.bugId || doc.id;
          docs.push({ ...data, bugId: id, firestoreSynced: true });
        });
        cache.bugs = docs;
        return docs;
      } catch (err: any) {
        serverLog('WARN', 'StorageAdapter', 'Failed to fetch bugs from Firestore', err?.message || err);
      }
    }
    return (cache.bugs || []).slice(0, limitCount);
  }

  async verifyAssessment(
    assessmentId: string,
    verifiedErrors: any,
    verifiedNotes?: string,
    reviewerId?: string,
    reviewedAt?: string,
  ) {
    const inMemoryResult = await super.verifyAssessment(
      assessmentId,
      verifiedErrors,
      verifiedNotes,
      reviewerId,
      reviewedAt,
    );
    const db = getFirestoreInstance();

    if (db) {
      try {
        const payloadToSync = {
          ...inMemoryResult.log,
          firestoreSynced: true,
          lastSyncedAt: new Date().toISOString(),
        };

        const atomicResult = await executeAtomicReportWrite(db, assessmentId, payloadToSync);
        if (atomicResult.success) {
          inMemoryResult.log.firestoreSynced = true;
          markServerCacheDirty(getOrInitServerCache());
          saveServerCacheToDisk();
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[FirestoreVerify] Không thể đồng bộ verifyAssessment lên Firestore', err?.message || err);
      }
    }
    
    return inMemoryResult;
  }

  async deleteData(options: {
    timeConfig?: string;
    startDate?: string;
    endDate?: string;
    deleteTypes?: string[];
  }) {
    const cache = getOrInitServerCache();
    
    // Capture state before memory deletion
    const oldReports = cache.reports ? [...cache.reports] : [];
    const oldBugs = cache.bugs ? [...cache.bugs] : [];
    const oldPathology = cache.seg_reports ? [...cache.seg_reports] : [];

    // Delete in memory
    const result = await super.deleteData(options);

    const db = getFirestoreInstance();
    if (!db) return result;

    try {
      // Find deleted objects
      const deletedReports = oldReports.filter(r => !cache.reports.find(newR => newR.assessmentId === r.assessmentId));
      const deletedBugs = oldBugs.filter(b => !cache.bugs.find(newB => newB.bugId === b.bugId));
      const deletedPathology = oldPathology.filter(p => !cache.seg_reports?.find(newP => newP.assessmentId === p.assessmentId));

      if (deletedReports.length > 0) {
        const items = deletedReports.map(r => ({ id: r.assessmentId, data: r }));
        await executeAtomicBulkDelete(db, 'reports', items);
      }

      if (deletedBugs.length > 0) {
        const items = deletedBugs.map(b => ({ id: b.bugId, data: b }));
        await executeAtomicBulkDelete(db, 'bugs', items);
      }

      if (deletedPathology.length > 0) {
        const items = deletedPathology.map(p => ({ id: p.assessmentId, data: p }));
        await executeAtomicBulkDelete(db, 'seg_reports', items);
      }
    } catch (e: any) {
      serverLog('ERROR', 'FirebaseDeleteData', 'Lỗi khi đồng bộ xóa lên Firestore', e?.message);
    }

    return result;
  }

  async deleteDocument(collection: 'reports' | 'bugs' | 'seg_reports', docId: string): Promise<{ success: boolean; deletedCount: number; message: string }> {
    const cache = getOrInitServerCache();
    const deletedReport = collection === 'reports' ? cache.reports.find(r => r.assessmentId === docId || (r as any)._id === docId || (r as any).id === docId) : null;
    const deletedBug = collection === 'bugs' ? cache.bugs.find(b => b.bugId === docId || (b as any)._id === docId || (b as any).id === docId) : null;
    const deletedPathology = collection === 'seg_reports' ? (cache.seg_reports || []).find(p => p.assessmentId === docId || (p as any)._id === docId || (p as any).id === docId) : null;

    // 1. Delete in-memory and disk cache first
    const memoryResult = await super.deleteDocument(collection, docId);

    // 2. Delete from Firestore atomically
    const db = getFirestoreInstance();
    if (db) {
      try {
        let atomicRes: any;
        if (collection === 'reports') {
          atomicRes = await executeAtomicReportDelete(db, docId, deletedReport);
        } else if (collection === 'bugs') {
          atomicRes = await executeAtomicBugDelete(db, docId, deletedBug);
        } else if (collection === 'seg_reports') {
          atomicRes = await executeAtomicPathologyDelete(db, docId, deletedPathology);
        }

        if (atomicRes && !atomicRes.success) {
          throw new Error(atomicRes.error || 'Atomic delete operation failed');
        }

        serverLog('INFO', 'FirestoreDelete', `Deleted document ${docId} atomically from Firestore collection ${collection}`);
      } catch (err: any) {
        serverLog('ERROR', 'FirestoreDelete', `Failed to delete document ${docId} from Firestore:`, err?.message || err);
        return {
          success: false,
          deletedCount: memoryResult.deletedCount,
          message: `Lỗi xóa tài liệu trên Firestore: ${err?.message || err}`,
        };
      }
    }

    return {
      success: true,
      deletedCount: 1,
      message: `Đã xóa bản ghi ${docId} thành công khỏi Firestore và bộ nhớ.`,
    };
  }

}

// Pluggable Storage Adapter singleton initialization
let currentStorageAdapter: IStorageAdapter | null = null;
let currentStorageAdapterKey: string | null = null;

export function getStorageAdapter(): IStorageAdapter {
  const offline = isStorageTestOfflineMode();
  const adapterKey = `${getStorageRoot()}::${offline ? 'offline' : 'normal'}`;
  if (!currentStorageAdapter || currentStorageAdapterKey !== adapterKey) {
    currentStorageAdapterKey = adapterKey;
    if (offline) {
      currentStorageAdapter = new InMemoryStorageAdapter();
      serverLog('INFO', 'StorageAdapter', 'Kích hoạt R17 Offline Test Storage Adapter');
      return currentStorageAdapter;
    }
    const firestore = getFirestoreInstance();
    if (firestore) {
      currentStorageAdapter = new FirebaseStorageAdapter();
      serverLog('INFO', 'StorageAdapter', 'Kích hoạt Firebase Cloud Firestore Storage Adapter');
    } else {
      currentStorageAdapter = new InMemoryStorageAdapter();
      serverLog('INFO', 'StorageAdapter', 'Kích hoạt Transient In-Memory Storage Adapter');
    }
  }
  return currentStorageAdapter;
}
