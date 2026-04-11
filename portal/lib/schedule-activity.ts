import { SCHEDULE_HOURS } from "@/lib/week";

/**
 * 同一 weekday 下，沿 SCHEDULE_HOURS 连续且文案（trim 后）完全相同的格子视为同一次活动。
 * 训练：文案含「训练」；比赛：文案含「比赛」。两类分别统计、独立合并。
 */
function countMergedByKeyword(
  cells: Record<string, string>,
  includesKeyword: (label: string) => boolean
): number {
  let total = 0;
  for (let weekday = 0; weekday < 7; weekday++) {
    let i = 0;
    while (i < SCHEDULE_HOURS.length) {
      const hour = SCHEDULE_HOURS[i]!;
      const label = (cells[`${weekday}-${hour}`] ?? "").trim();
      if (!label || !includesKeyword(label)) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < SCHEDULE_HOURS.length) {
        const nextHour = SCHEDULE_HOURS[end]!;
        const prevHour = SCHEDULE_HOURS[end - 1]!;
        if (nextHour !== prevHour + 1) break;
        const nextLabel = (cells[`${weekday}-${nextHour}`] ?? "").trim();
        if (nextLabel !== label || !includesKeyword(nextLabel)) break;
        end++;
      }
      total++;
      i = end;
    }
  }
  return total;
}

export function countTrainingSessionsFromScheduleCells(cells: Record<string, string>): number {
  return countMergedByKeyword(cells, (s) => s.includes("训练"));
}

export function countMatchSessionsFromScheduleCells(cells: Record<string, string>): number {
  return countMergedByKeyword(cells, (s) => s.includes("比赛"));
}

export function scheduleCellsFromSlotRows(
  rows: { weekStart: string; weekday: number; hour: number; label: string }[]
): Map<string, Record<string, string>> {
  const byWeek = new Map<string, Record<string, string>>();
  for (const r of rows) {
    let m = byWeek.get(r.weekStart);
    if (!m) {
      m = {};
      byWeek.set(r.weekStart, m);
    }
    m[`${r.weekday}-${r.hour}`] = r.label;
  }
  return byWeek;
}
