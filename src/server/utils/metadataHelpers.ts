export function determineAccuracyCategory(log: any): 'EXACT_MATCH' | 'MOSTLY_ACCURATE' | 'PARTIALLY_ACCURATE' | 'INACCURATE' {
  if (!log) return 'EXACT_MATCH';
  const scoreStr = log.accuracyScore || '';
  if (scoreStr.includes('100%') || scoreStr.includes('Trùng khớp') || scoreStr.includes('Phim chuẩn') || log.userValidation?.concurred === true) {
    return 'EXACT_MATCH';
  } else if (scoreStr.includes('75%') || scoreStr.includes('80%') || scoreStr.includes('phần lớn')) {
    return 'MOSTLY_ACCURATE';
  } else if (scoreStr.includes('50%') || scoreStr.includes('một phần')) {
    return 'PARTIALLY_ACCURATE';
  } else if (scoreStr.includes('0%') || scoreStr.includes('Không đồng thuận') || scoreStr.includes('thừa') || scoreStr.includes('bỏ sót')) {
    return 'INACCURATE';
  }
  return 'EXACT_MATCH';
}

export function isLogIncompleteHelper(log: any): boolean {
  if (!log) return false;
  if (log.sessionStatus === 'INCOMPLETE') return true;
  if (log.stage && (log.stage.includes('Bước 3') || log.stage.includes('Bước 4'))) return true;
  if (typeof log.lastCompletedStep === 'number' && log.lastCompletedStep < 5) return true;
  if (log.accuracyScore && log.accuracyScore.includes('Chưa hoàn thành')) return true;
  return false;
}

export function isLogErrorHelper(log: any): boolean {
  if (!log) return false;
  if (log.sessionStatus === 'FAILED_NON_DENTAL') return true;
  if (log.aiAnalysis && log.aiAnalysis.isPeriapicalRadiograph === false) return true;
  if (Array.isArray(log.finalConfirmedErrors) && log.finalConfirmedErrors.includes('not_periapical')) return true;
  if (log.accuracyScore && log.accuracyScore.includes('không hợp lệ')) return true;
  return false;
}

export function parseTimestampToMsHelper(timestamp?: string | number | null, updatedAt?: string | number | null, createdAt?: string | number | null): number {
  const ts = timestamp || updatedAt || createdAt;
  if (typeof ts === 'number') return ts;
  if (!ts) return 0;
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

export function getDateKeyFromLog(log: any): string {
  if (!log) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const ms = parseTimestampToMsHelper(log.timestamp, log.updatedAt, log.createdAt);
  const date = ms ? new Date(ms) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
