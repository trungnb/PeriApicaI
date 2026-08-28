/**
 * Safely parses any timestamp representation (ISO 8601 string, Vietnam locale string, epoch ms, or Date)
 * into milliseconds epoch time for precise descending/ascending sorting.
 */
export function parseTimestampToMs(
  timestamp?: string | number | any | null,
  updatedAt?: string | number | any | null,
  createdAt?: string | number | any | null
): number {
  const candidates = [updatedAt, createdAt, timestamp];

  for (const val of candidates) {
    if (!val) continue;
    if (typeof val === 'number') return val;

    // Handle Firestore Timestamp / JS Date objects
    if (typeof val === 'object' && val !== null) {
      if (typeof val.toDate === 'function') {
        try {
          const d = val.toDate();
          if (d instanceof Date && !isNaN(d.getTime())) return d.getTime();
        } catch {}
      }
      if (typeof val._seconds === 'number') {
        return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
      }
      if (typeof val.seconds === 'number') {
        return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
      }
      if (val instanceof Date && !isNaN(val.getTime())) {
        return val.getTime();
      }
    }

    const str = String(val).trim();
    if (!str || str === '[object Object]') continue;

    // 1. Direct ISO Date parse (e.g., "2026-08-13T01:43:39.082Z")
    const directDate = new Date(str);
    if (!isNaN(directDate.getTime()) && directDate.getTime() > 0) {
      return directDate.getTime();
    }

    // 2. Format: "hh:mm:ss dd/mm/yyyy" or "hh:mm dd/mm/yyyy" (e.g. "08:43:19 13/8/2026")
    const timeThenDateMatch = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (timeThenDateMatch) {
      const hours = parseInt(timeThenDateMatch[1], 10);
      const minutes = parseInt(timeThenDateMatch[2], 10);
      const seconds = timeThenDateMatch[3] ? parseInt(timeThenDateMatch[3], 10) : 0;
      const day = parseInt(timeThenDateMatch[4], 10);
      const month = parseInt(timeThenDateMatch[5], 10) - 1;
      const year = parseInt(timeThenDateMatch[6], 10);
      const d = new Date(year, month, day, hours, minutes, seconds);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // 3. Format: "dd/mm/yyyy, hh:mm:ss" or "dd/mm/yyyy hh:mm:ss" (e.g. "13/08/2026, 08:43:19")
    const dateThenTimeMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (dateThenTimeMatch) {
      const day = parseInt(dateThenTimeMatch[1], 10);
      const month = parseInt(dateThenTimeMatch[2], 10) - 1;
      const year = parseInt(dateThenTimeMatch[3], 10);
      const hours = parseInt(dateThenTimeMatch[4], 10);
      const minutes = parseInt(dateThenTimeMatch[5], 10);
      const seconds = dateThenTimeMatch[6] ? parseInt(dateThenTimeMatch[6], 10) : 0;
      const d = new Date(year, month, day, hours, minutes, seconds);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // 4. Format: Simple Date "dd/mm/yyyy"
    const dateMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10) - 1;
      const year = parseInt(dateMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }

  return 0;
}

/**
 * Formats a timestamp into a clean, standardized, highly readable string.
 * Output format: "HH:mm:ss - DD/MM/YYYY" (e.g. "08:43:19 - 13/08/2026")
 */
export function formatDisplayTimestamp(
  timestamp?: string | number | null,
  updatedAt?: string | number | null,
  createdAt?: string | number | null
): string {
  const ms = parseTimestampToMs(timestamp, updatedAt, createdAt);
  if (!ms) {
    return String(timestamp || updatedAt || createdAt || 'Chưa có thời gian');
  }

  const d = new Date(ms);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${hours}:${minutes}:${seconds} - ${day}/${month}/${year}`;
}

/**
 * Parses date part for filtering (year, month, day)
 */
export function parseLogDateParts(
  timestamp?: string | number | null,
  updatedAt?: string | number | null,
  createdAt?: string | number | null
): { year: number; month: number; day: number } | null {
  const ms = parseTimestampToMs(timestamp, updatedAt, createdAt);
  if (!ms) return null;

  const d = new Date(ms);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}
