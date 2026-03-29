import { getDb } from "@/lib/db";
import {
  weeklyAnthropometric,
  weeklySpeed,
  weeklyActivity,
  scheduleSlot,
  shortTermGoal,
} from "@/lib/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
import { addWeeks, getWeekMonday } from "@/lib/week";

const CHART_RECENT_WEEKS = 24;
/** 周数过多时只保留最近若干根，避免横轴挤在一起 */
const CHART_MAX_WEEKS = 52;

function buildRecentWeekStarts(): string[] {
  const current = getWeekMonday();
  const list: string[] = [];
  for (let i = CHART_RECENT_WEEKS - 1; i >= 0; i--) {
    list.push(addWeeks(current, -i));
  }
  return list;
}

/** 合并「最近 N 周」与库里已有数据的周，排序后用于图表横轴（三张图共用） */
export async function resolveChartWeekStarts(): Promise<string[]> {
  const db = getDb();
  const recent = buildRecentWeekStarts();
  const [a, s, ac] = await Promise.all([
    db.select({ w: weeklyAnthropometric.weekStart }).from(weeklyAnthropometric),
    db.select({ w: weeklySpeed.weekStart }).from(weeklySpeed),
    db.select({ w: weeklyActivity.weekStart }).from(weeklyActivity),
  ]);
  const set = new Set<string>(recent);
  for (const r of a) set.add(r.w);
  for (const r of s) set.add(r.w);
  for (const r of ac) set.add(r.w);
  const sorted = Array.from(set).sort();
  if (sorted.length > CHART_MAX_WEEKS) return sorted.slice(-CHART_MAX_WEEKS);
  return sorted;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type AnthropometricPoint = {
  week: string;
  heightCm: number | null;
  weightKg: number | null;
};

export type SpeedPoint = {
  week: string;
  sprint10m: number | null;
  sprint30m: number | null;
  sprint100m: number | null;
};

export type ActivityPoint = {
  week: string;
  training: number | null;
  match: number | null;
};

/** Portal 三张周曲线共用同一时间轴，并包含库中已有但不在「最近 24 周」内的数据点 */
export async function getPortalChartData(): Promise<{
  anthropometric: AnthropometricPoint[];
  speed: SpeedPoint[];
  activity: ActivityPoint[];
}> {
  const weeks = await resolveChartWeekStarts();
  if (weeks.length === 0) {
    return { anthropometric: [], speed: [], activity: [] };
  }
  const db = getDb();
  const [arows, srows, crows] = await Promise.all([
    db.select().from(weeklyAnthropometric).where(inArray(weeklyAnthropometric.weekStart, weeks)),
    db.select().from(weeklySpeed).where(inArray(weeklySpeed.weekStart, weeks)),
    db.select().from(weeklyActivity).where(inArray(weeklyActivity.weekStart, weeks)),
  ]);
  const amap = new Map(arows.map((r) => [r.weekStart, r]));
  const smap = new Map(srows.map((r) => [r.weekStart, r]));
  const cmap = new Map(crows.map((r) => [r.weekStart, r]));

  const anthropometric = weeks.map((w) => {
    const r = amap.get(w);
    return {
      week: w,
      heightCm: toFiniteNumber(r?.heightCm),
      weightKg: toFiniteNumber(r?.weightKg),
    };
  });
  const speed = weeks.map((w) => {
    const r = smap.get(w);
    return {
      week: w,
      sprint10m: toFiniteNumber(r?.sprint10m),
      sprint30m: toFiniteNumber(r?.sprint30m),
      sprint100m: toFiniteNumber(r?.sprint100m),
    };
  });
  const activity = weeks.map((w) => {
    const r = cmap.get(w);
    return {
      week: w,
      training: toFiniteNumber(r?.trainingCount),
      match: toFiniteNumber(r?.matchCount),
    };
  });

  return { anthropometric, speed, activity };
}

export async function getScheduleForWeek(weekStart: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(scheduleSlot)
    .where(eq(scheduleSlot.weekStart, weekStart));
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[`${r.weekday}-${r.hour}`] = r.label;
  }
  return map;
}

export async function getShortTermGoalContent() {
  const db = getDb();
  const rows = await db.select().from(shortTermGoal).where(eq(shortTermGoal.id, 1)).limit(1);
  return rows[0]?.content ?? "";
}
