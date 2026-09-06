import fs from 'fs';
import { serverLog } from '../config/env';
import { getUploadsDirectory, resolveUploadFilePath } from '../config/storagePaths';
import { getOrInitServerCache, markServerCacheDirty, saveServerCacheToDisk } from '../services/storageAdapter';
import { deduplicateMasterCache } from './deduplicateMasterData';

export function runDailyUploadsCleanup() {
  try {
    const uploadsDir = getUploadsDirectory();
    if (!fs.existsSync(uploadsDir)) return;
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAgeMs = 1 * 60 * 60 * 1000; // 1 hour (Cloud Run RAM optimization)
    let deletedCount = 0;

    for (const file of files) {
      const filePath = resolveUploadFilePath(file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        // Ignore single file deletion errors
      }
    }

    if (deletedCount > 0) {
      serverLog('INFO', 'StorageCleanup', `Tự động dọn dẹp ${deletedCount} file ảnh tải lên cũ hơn 1 giờ.`);
    }

    // Run deduplication check on master cache collections
    deduplicateMasterCache();

    // Prune stale cache entries (> 30 days) from temp_cache.json
    const cache = getOrInitServerCache();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const initialReportCount = cache.reports.length;
    const initialSegCount = cache.seg_reports.length;

    cache.reports = cache.reports.filter((r: any) => {
      const timeMs = new Date(r.timestamp || r.createdAt || 0).getTime();
      return isNaN(timeMs) || (now - timeMs) < THIRTY_DAYS_MS;
    }).slice(0, 2000); // Cap at 2000 items

    cache.seg_reports = cache.seg_reports.filter((r: any) => {
      const timeMs = new Date(r.timestamp || r.createdAt || 0).getTime();
      return isNaN(timeMs) || (now - timeMs) < THIRTY_DAYS_MS;
    }).slice(0, 2000); // Cap at 2000 items

    if (cache.reports.length !== initialReportCount || cache.seg_reports.length !== initialSegCount) {
      markServerCacheDirty(cache);
      saveServerCacheToDisk(true);
      serverLog('INFO', 'StorageCleanup', `Đã dọn dẹp các bản ghi cache cục bộ cũ hơn 30 ngày.`);
    }
  } catch (err: any) {
    serverLog('ERROR', 'StorageCleanup', '[Storage Cleanup Error]:', err);
  }
}

export function startCleanupJob() {
  const CLEANUP_INTERVAL_MS = 1 * 60 * 60 * 1000;
  setInterval(runDailyUploadsCleanup, CLEANUP_INTERVAL_MS);
  setTimeout(runDailyUploadsCleanup, 10000); // Initial check after 10s
}
