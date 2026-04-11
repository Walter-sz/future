/**
 * Week helpers using local timezone of the Node/browser environment.
 * Set TZ=Asia/Shanghai on the server for consistent family use in China.
 */

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (ISO week) of the calendar week containing `date`, as YYYY-MM-DD */
export function getWeekMonday(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

/** Normalize any calendar date YYYY-MM-DD to the Monday of that week */
export function normalizeToWeekMonday(ymd: string): string {
  return getWeekMonday(parseYmd(ymd));
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addWeeks(weekStartYmd: string, delta: number): string {
  const d = parseYmd(weekStartYmd);
  d.setDate(d.getDate() + delta * 7);
  return formatDate(d);
}

/** `weekStart` 为当周周一 YYYY-MM-DD，`deltaDays` 0=周一 … 6=周日 */
export function addDays(ymd: string, deltaDays: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + deltaDays);
  return formatDate(d);
}

/** 用于表头等短展示，如「3月29日」 */
export function formatMonthDayCn(ymd: string): string {
  const d = parseYmd(ymd);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const SCHEDULE_HOURS = Array.from({ length: 17 }, (_, i) => i + 7);
