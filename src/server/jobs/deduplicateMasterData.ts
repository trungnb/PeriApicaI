import { getOrInitServerCache, markServerCacheDirty, saveServerCacheToDisk } from '../services/storageAdapter';
import { serverLog } from '../config/env';

/**
 * Script kiểm tra và loại bỏ các trường trùng lặp trong cache tổng hợp (master cache)
 * dựa trên định danh duy nhất (docId hoặc id) và composite keys.
 */
export function deduplicateMasterCache(): { removedReports: number; removedPathology: number; removedBugs: number } {
  try {
    const cache = getOrInitServerCache();
    let removedReports = 0;
    let removedPathology = 0;
    let removedBugs = 0;

    // Helper deduplication function
    const deduplicateItems = (items: any[], getId: (item: any, index: number) => string) => {
      const seen = new Map<string, any>();
      let duplicatesCount = 0;

      for (const item of items) {
        if (!item) continue;
        const key = getId(item, seen.size);
        if (seen.has(key)) {
          duplicatesCount++;
          // Giữ lại bản ghi có thời gian mới hơn hoặc đầy đủ hơn
          const existing = seen.get(key);
          const existingTime = new Date(existing.timestamp || existing.createdAt || 0).getTime();
          const currentTime = new Date(item.timestamp || item.createdAt || 0).getTime();
          if (currentTime > existingTime) {
            seen.set(key, item);
          }
        } else {
          seen.set(key, item);
        }
      }

      return {
        uniqueList: Array.from(seen.values()),
        removed: duplicatesCount,
      };
    };

    // 1. Deduplicate reports
    if (Array.isArray(cache.reports)) {
      const res = deduplicateItems(cache.reports, (r, idx) => r.docId || r.id || `report_${idx}_${r.timestamp}`);
      removedReports = res.removed;
      cache.reports = res.uniqueList;
    }

    // 2. Deduplicate pathology reports (seg_reports)
    if (Array.isArray(cache.seg_reports)) {
      const res = deduplicateItems(cache.seg_reports, (s, idx) => s.docId || s.id || `path_${idx}_${s.timestamp}`);
      removedPathology = res.removed;
      cache.seg_reports = res.uniqueList;
    }

    // 3. Deduplicate bugs
    if (Array.isArray(cache.bugs)) {
      const res = deduplicateItems(cache.bugs, (b, idx) => b.docId || b.id || `bug_${idx}_${b.timestamp}`);
      removedBugs = res.removed;
      cache.bugs = res.uniqueList;
    }

    const totalRemoved = removedReports + removedPathology + removedBugs;
    if (totalRemoved > 0) {
      markServerCacheDirty(cache);
      saveServerCacheToDisk(true);
      serverLog(
        'INFO',
        'Deduplication',
        `Đã phát hiện và loại bỏ ${totalRemoved} bản ghi trùng lặp trong master cache (Reports: ${removedReports}, Pathology: ${removedPathology}, Bugs: ${removedBugs}).`
      );
    } else {
      serverLog('INFO', 'Deduplication', 'Master cache hoàn toàn sạch, không phát hiện bản ghi trùng lặp.');
    }

    return { removedReports, removedPathology, removedBugs };
  } catch (err: any) {
    serverLog('ERROR', 'Deduplication', '[Deduplicate Master Cache Error]:', err);
    return { removedReports: 0, removedPathology: 0, removedBugs: 0 };
  }
}
