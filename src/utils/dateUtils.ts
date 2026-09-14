function parseDateValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as any).toDate === 'function') {
    try { return (value as any).toDate().getTime(); } catch {}
  }
  if (value && typeof (value as any)._seconds === 'number') {
    return (value as any)._seconds * 1000 + Math.floor(((value as any)._nanoseconds || 0) / 1e6);
  }
  if (value && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000 + Math.floor(((value as any).nanoseconds || 0) / 1e6);
  }
  return new Date(value as any).getTime();
}

export function parseTimestampToMs(
  timestamp?: string | number | any | null,
  updatedAt?: string | number | any | null,
  createdAt?: string | number | any | null
): number {
  for (const value of [updatedAt, createdAt, timestamp]) {
    if (!value) continue;
    const ms = parseDateValue(value);
    if (Number.isFinite(ms) && ms > 0 && Number.isFinite(new Date(ms).getTime())) return ms;
  }
  return 0;
}

export function formatDisplayTimestamp(
  timestamp?: string | number | null,
  updatedAt?: string | number | null,
  createdAt?: string | number | null
): string {
  const ms = parseTimestampToMs(timestamp, updatedAt, createdAt);
  if (!ms) return String(timestamp || updatedAt || createdAt || 'Chưa có thời gian');
  const formatted = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23',
  }).format(new Date(ms));
  return formatted.replace(' ', ' - ');
}

export function parseLogDateParts(
  timestamp?: string | number | null,
  updatedAt?: string | number | null,
  createdAt?: string | number | null
): { year: number; month: number; day: number } | null {
  const ms = parseTimestampToMs(timestamp, updatedAt, createdAt);
  if (!ms) return null;
  const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}
