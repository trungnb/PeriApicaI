import { isLogIncompleteHelper as isLogIncomplete, isLogErrorHelper as isLogError, parseTimestampToMsHelper } from '../utils/metadataHelpers';
import path from 'path';
import fs from 'fs';
import { saveAndOptimizeImageFile, deleteImageFile, serverLog, generateSignedImageUrl } from '../config/env';
import { restorePathologyDocFromFirestore } from './firestorePathologyService';
import { getFirestoreInstance } from './firebaseService';
import {
  executeAtomicReportWrite,
  executeAtomicReportDelete,
  executeAtomicBugWrite,
  executeAtomicBugDelete,
  executeAtomicPathologyWrite,
  executeAtomicPathologyDelete,
  executeAtomicBulkDelete,
} from './atomicUpdateService';

export interface IStorageAdapter {
  type: string;
  saveLog(payload: any, imageDataUrl?: string): Promise<{ success: boolean; assessmentId: string; imageUrl: string; shareConsent: boolean; firestoreSynced: boolean }>;
  getLogs(limitCount?: number): Promise<any[]>;
  getLogById(assessmentId: string): Promise<any | null>;
  saveBug(bugData: any): Promise<{ success: boolean }>;
  getBugs(limitCount?: number): Promise<any[]>;
  verifyAssessment(assessmentId: string, verifiedErrors: any, verifiedNotes?: string): Promise<{ success: boolean; log: any }>;
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
  isCacheDirty: boolean; // Flag to eliminate unnecessary disk/network I/O
}

import {
  computeSystemMetadata,
  recalculateAndPersistSystemMetadata,
  recordReportWrite,
  recordReportDelete,
  recordBugWrite,
  recordBugDelete,
  recordPathologyWrite,
  recordPathologyDelete,
  getSystemMetadata,
} from './systemMetadataService';

export const computeSystemMetrics = computeSystemMetadata;

export async function recalculateAndPersistMetrics(db?: any): Promise<SystemMetrics> {
  const cache = getOrInitServerCache();
  const metrics = await recalculateAndPersistSystemMetadata(db, cache);
  cache.systemMetrics = metrics;
  saveServerCacheToDisk();
  return metrics;
}

const TEMP_CACHE_FILE = path.join(process.cwd(), 'temp_cache.json');
let serverTempCache: ServerCacheStructure | null = null;

export function getOrInitServerCache(): ServerCacheStructure {
  if (!serverTempCache) {
    serverTempCache = { reports: [], seg_reports: [], bugs: [], lastUpdated: new Date().toISOString(), isCacheDirty: false };
    if (fs.existsSync(TEMP_CACHE_FILE)) {
      try {
        const raw = fs.readFileSync(TEMP_CACHE_FILE, 'utf8');
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
      } catch (e) {
        console.warn('[Cache Init Warning]: Unable to read temp_cache.json', e);
      }
    }
  }
  return serverTempCache;
}


let isSavingCache = false;

export function saveServerCacheToDisk(force = false, sync = false) {
  const cache = getOrInitServerCache();
  if (!force && !cache.isCacheDirty) return; // Skip disk I/O if cache is clean
  if (isSavingCache && !sync) return; // Skip if already saving

  try {
    cache.lastUpdated = new Date().toISOString();
    const data = JSON.stringify({
      reports: cache.reports,
      seg_reports: cache.seg_reports,
      bugs: cache.bugs,
      systemMetrics: cache.systemMetrics,
      lastUpdated: cache.lastUpdated,
    });

    if (sync) {
      fs.writeFileSync(TEMP_CACHE_FILE, data, 'utf8');
      cache.isCacheDirty = false;
    } else {
      isSavingCache = true;
      fs.promises.writeFile(TEMP_CACHE_FILE, data, 'utf8')
        .then(() => {
          cache.isCacheDirty = false;
        })
        .catch((e) => {
          console.warn('[Cache Flush Error]: Unable to save temp_cache.json asynchronously', e);
        })
        .finally(() => {
          isSavingCache = false;
          if (cache.isCacheDirty) saveServerCacheToDisk();
        });
    }
  } catch (e) {
    console.warn('[Cache Flush Error]: Unable to serialize temp_cache.json', e);
    isSavingCache = false;
  }
}

// Flush RAM cache to disk on graceful server shutdown
export function flushCacheOnShutdown() {
  const cache = getOrInitServerCache();
  if (cache.isCacheDirty) {
    saveServerCacheToDisk(true, true);
    serverLog('INFO', 'GracefulShutdown', 'Đã lưu toàn bộ RAM Cache xuống đĩa trước khi dừng Server.');
  }
}

// In-Memory Storage Adapter Implementation
export class InMemoryStorageAdapter implements IStorageAdapter {
  type = 'in_memory';

  async saveLog(payload: any, imageDataUrl?: string) {
    if (!payload.assessmentId) {
      const crypto = require('crypto');
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
    const logEntry = {
      ...payload,
      updatedAt: new Date().toISOString(),
      firestoreSynced: false,
    };

    if (existingIndex >= 0) {
      cache.reports[existingIndex] = { ...cache.reports[existingIndex], ...logEntry };
    } else {
      cache.reports.unshift(logEntry);
    }

    cache.isCacheDirty = true; // Mark dirty for I/O sync
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
    const crypto = require('crypto');
    const bugEntry = {
      bugId: `bug_${Date.now()}_${crypto.randomUUID()}`,
      timestamp: bugData.timestamp || new Date().toISOString(),
      description: bugData.description || 'Không có mô tả',
      path: bugData.path || 'N/A',
      source: bugData.source || 'USER_SUBMITTED',
      severity: bugData.severity || 'ERROR',
      errorDetails: bugData.errorDetails || null,
      firestoreSynced: false,
    };
    cache.bugs.unshift(bugEntry);
    cache.isCacheDirty = true;
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

  async verifyAssessment(assessmentId: string, verifiedErrors: any, verifiedNotes?: string) {
    const cache = getOrInitServerCache();
    const index = cache.reports.findIndex(l => l.assessmentId === assessmentId);
    if (index === -1) {
      throw new Error(`Không tìm thấy đánh giá với ID: ${assessmentId}`);
    }

    const targetLog = cache.reports[index];
    const finalErrors = Array.isArray(verifiedErrors) ? verifiedErrors : [];
    targetLog.finalConfirmedErrors = finalErrors;
    targetLog.verifiedNotes = verifiedNotes || targetLog.verifiedNotes || '';
    targetLog.verifiedAt = new Date().toISOString();
    targetLog.firestoreSynced = false;

    if (targetLog.aiAnalysis) {
      const calcResult = calculateAccuracyScore(targetLog.aiAnalysis, finalErrors);
      targetLog.accuracyScore = calcResult.score;
      targetLog.aiDetectedErrorsSummary = calcResult.aiSummary;
      targetLog.finalConfirmedErrorsSummary = calcResult.finalSummary;
    }

    cache.isCacheDirty = true;
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
    
    let effectiveTimeConfig = typeof timeConfig === 'string' ? timeConfig : (timeConfig?.isAllTime ? 'all' : 'custom');
    let effectiveStartDate = typeof timeConfig === 'object' ? timeConfig?.startDate || options.startDate : options.startDate;
    let effectiveEndDate = typeof timeConfig === 'object' ? timeConfig?.endDate || options.endDate : options.endDate;

    const now = Date.now();
    let initialCount = cache.reports.length + (cache.seg_reports?.length || 0) + cache.bugs.length;

    const hasAllType = deleteTypes.includes('all');
    const hasReports = hasAllType || deleteTypes.includes('reports') || deleteTypes.includes('incomplete') || deleteTypes.includes('errors') || deleteTypes.includes('test');
    const hasSegReports = hasAllType || deleteTypes.includes('seg_reports') || deleteTypes.includes('pathology_reports') || deleteTypes.includes('incomplete') || deleteTypes.includes('errors') || deleteTypes.includes('test');
    const hasBugs = hasAllType || deleteTypes.includes('bugs');

    if (hasReports) {
      cache.reports = cache.reports.filter(item => {
        const itemMs = parseTimestampToMsHelper(item.timestamp, item.updatedAt, item.createdAt);
        if (effectiveTimeConfig === 'all' && (hasAllType || deleteTypes.includes('reports'))) return false;
        if (effectiveTimeConfig === '24h' && now - itemMs < 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '7d' && now - itemMs < 7 * 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '30d' && now - itemMs < 30 * 24 * 60 * 60 * 1000) return false;
        if ((effectiveTimeConfig === 'incomplete' || deleteTypes.includes('incomplete')) && isLogIncomplete(item)) return false;
        if ((effectiveTimeConfig === 'errors' || deleteTypes.includes('errors')) && isLogError(item)) return false;
        if ((effectiveTimeConfig === 'tests' || deleteTypes.includes('test')) && isLogTest(item)) return false;
        if (effectiveTimeConfig === 'custom' && isTimestampInDateRange(item.timestamp, item.updatedAt, item.createdAt, effectiveStartDate, effectiveEndDate)) {
          if (hasAllType || deleteTypes.includes('reports')) return false;
          if (deleteTypes.includes('incomplete') && isLogIncomplete(item)) return false;
          if (deleteTypes.includes('errors') && isLogError(item)) return false;
          if (deleteTypes.includes('test') && isLogTest(item)) return false;
        }
        return true;
      });
    }

    if (hasSegReports) {
      cache.seg_reports = (cache.seg_reports || []).filter(item => {
        const itemMs = parseTimestampToMsHelper(item.timestamp, item.updatedAt, item.createdAt);
        if (effectiveTimeConfig === 'all' && (hasAllType || deleteTypes.includes('seg_reports') || deleteTypes.includes('pathology_reports'))) return false;
        if (effectiveTimeConfig === '24h' && now - itemMs < 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '7d' && now - itemMs < 7 * 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '30d' && now - itemMs < 30 * 24 * 60 * 60 * 1000) return false;
        if ((effectiveTimeConfig === 'incomplete' || deleteTypes.includes('incomplete')) && (item.sessionStatus === 'INCOMPLETE' || (item.lastCompletedStep !== undefined && item.lastCompletedStep < 5))) return false;
        if ((effectiveTimeConfig === 'errors' || deleteTypes.includes('errors')) && item.sessionStatus === 'FAILED_NON_DENTAL') return false;
        if ((effectiveTimeConfig === 'tests' || deleteTypes.includes('test')) && isLogTest(item)) return false;
        if (effectiveTimeConfig === 'custom' && isTimestampInDateRange(item.timestamp, item.updatedAt, item.createdAt, effectiveStartDate, effectiveEndDate)) {
          if (hasAllType || deleteTypes.includes('seg_reports') || deleteTypes.includes('pathology_reports')) return false;
          if (deleteTypes.includes('incomplete') && (item.sessionStatus === 'INCOMPLETE' || (item.lastCompletedStep !== undefined && item.lastCompletedStep < 5))) return false;
          if (deleteTypes.includes('errors') && item.sessionStatus === 'FAILED_NON_DENTAL') return false;
          if (deleteTypes.includes('test') && isLogTest(item)) return false;
        }
        return true;
      });
    }

    if (hasBugs) {
      cache.bugs = cache.bugs.filter(item => {
        const itemMs = parseTimestampToMsHelper(item.timestamp, item.updatedAt, item.createdAt);
        if (effectiveTimeConfig === 'all') return false;
        if (effectiveTimeConfig === '24h' && now - itemMs < 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '7d' && now - itemMs < 7 * 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === '30d' && now - itemMs < 30 * 24 * 60 * 60 * 1000) return false;
        if (effectiveTimeConfig === 'custom' && isTimestampInDateRange(item.timestamp, item.updatedAt, item.createdAt, effectiveStartDate, effectiveEndDate)) return false;
        return true;
      });
    }

    const remainingCount = cache.reports.length + (cache.seg_reports?.length || 0) + cache.bugs.length;
    const deletedCount = initialCount - remainingCount;

    cache.isCacheDirty = true;
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

    cache.isCacheDirty = true;
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

          const atomicResult = await executeAtomicReportWrite(db, inMemoryResult.assessmentId, payloadToSync, true);
          if (atomicResult.success) {
            logEntry.firestoreSynced = true;
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
        const lastBug = cache.bugs[0];
        if (lastBug) {
          const payloadToSync = {
            ...lastBug,
            firestoreSynced: true,
            lastSyncedAt: new Date().toISOString(),
          };

          const atomicResult = await executeAtomicBugWrite(db, lastBug.bugId, payloadToSync, true);
          if (atomicResult.success) {
            lastBug.firestoreSynced = true;
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

  async verifyAssessment(assessmentId: string, verifiedErrors: any, verifiedNotes?: string) {
    const cache = getOrInitServerCache();
    const oldLog = cache.reports.find(r => r.assessmentId === assessmentId) ? { ...cache.reports.find(r => r.assessmentId === assessmentId) } : undefined;
    const inMemoryResult = await super.verifyAssessment(assessmentId, verifiedErrors, verifiedNotes);
    const db = getFirestoreInstance();

    if (db) {
      try {
        const payloadToSync = {
          ...inMemoryResult.log,
          firestoreSynced: true,
          lastSyncedAt: new Date().toISOString(),
        };

        const atomicResult = await executeAtomicReportWrite(db, assessmentId, payloadToSync, false, oldLog);
        if (atomicResult.success) {
          inMemoryResult.log.firestoreSynced = true;
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

export function getStorageAdapter(): IStorageAdapter {
  if (!currentStorageAdapter) {
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


