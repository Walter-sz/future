/**
 * 中国 0～18 岁男童身高、体重 **P50（50% 分位，中位数）** 参考值。
 * 来源：九省/市 2005 年儿童体格发育调查制表，《中华儿科杂志》2009 年 7 期（用户提供的标准表摘录）。
 * 在图表中按「实足年龄」线性插值，与同周历日期对齐的 Mike 周数据对比。
 */

import { parseYmd } from "@/lib/week";

/** 年龄（岁，小数；0=出生，0.5=半岁，2.5=两岁半）→ P50 身高 cm、体重 kg */
const P50_POINTS: ReadonlyArray<{ ageY: number; h: number; w: number }> = [
  { ageY: 0, h: 50.4, w: 3.32 },
  { ageY: 2 / 12, h: 58.7, w: 5.68 },
  { ageY: 4 / 12, h: 64.6, w: 7.45 },
  { ageY: 6 / 12, h: 68.4, w: 8.41 },
  { ageY: 9 / 12, h: 72.6, w: 9.33 },
  { ageY: 1, h: 76.5, w: 10.05 },
  { ageY: 15 / 12, h: 79.8, w: 10.68 },
  { ageY: 18 / 12, h: 82.7, w: 11.29 },
  { ageY: 21 / 12, h: 85.6, w: 11.93 },
  { ageY: 2, h: 88.5, w: 12.54 },
  { ageY: 2.5, h: 93.3, w: 13.64 },
  { ageY: 3, h: 96.8, w: 14.65 },
  { ageY: 3.5, h: 100.6, w: 15.63 },
  { ageY: 4, h: 104.1, w: 16.64 },
  { ageY: 4.5, h: 107.7, w: 17.75 },
  { ageY: 5, h: 111.3, w: 18.98 },
  { ageY: 5.5, h: 114.7, w: 20.18 },
  { ageY: 6, h: 117.7, w: 21.26 },
  { ageY: 6.5, h: 120.7, w: 22.45 },
  { ageY: 7, h: 124.0, w: 24.06 },
  { ageY: 7.5, h: 127.1, w: 25.72 },
  { ageY: 8, h: 130.0, w: 27.33 },
  { ageY: 8.5, h: 132.7, w: 28.91 },
  { ageY: 9, h: 135.4, w: 30.46 },
  { ageY: 9.5, h: 137.9, w: 32.09 },
  { ageY: 10, h: 140.2, w: 33.74 },
  { ageY: 10.5, h: 142.6, w: 35.58 },
  { ageY: 11, h: 145.3, w: 37.69 },
  { ageY: 11.5, h: 148.4, w: 39.98 },
  { ageY: 12, h: 151.9, w: 42.49 },
  { ageY: 12.5, h: 155.6, w: 45.13 },
  { ageY: 13, h: 159.5, w: 48.08 },
  { ageY: 13.5, h: 163.0, w: 50.85 },
  { ageY: 14, h: 165.9, w: 53.37 },
  { ageY: 14.5, h: 168.2, w: 55.43 },
  { ageY: 15, h: 169.8, w: 57.08 },
  { ageY: 15.5, h: 171.0, w: 58.39 },
  { ageY: 16, h: 171.6, w: 59.35 },
  { ageY: 16.5, h: 172.1, w: 60.12 },
  { ageY: 17, h: 172.3, w: 60.68 },
  { ageY: 18, h: 172.7, w: 61.4 },
];

function interpP50(ageYearsClamped: number, key: "h" | "w"): number {
  const pts = P50_POINTS;
  const y = ageYearsClamped;
  if (y <= pts[0].ageY) return pts[0][key];
  const last = pts[pts.length - 1];
  if (y >= last.ageY) return last[key];
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].ageY < y) i++;
  const p0 = pts[i];
  const p1 = pts[i + 1];
  const t = (y - p0.ageY) / (p1.ageY - p0.ageY);
  return p0[key] + t * (p1[key] - p0[key]);
}

/** 从出生日到参考日之间的实足年龄（年，小数），用于对照表插值 */
export function decimalAgeYears(birthYmd: string, asOfYmd: string): number {
  const b = parseYmd(birthYmd);
  const a = parseYmd(asOfYmd);
  const days = (a.getTime() - b.getTime()) / 86400000;
  return days / 365.25;
}

/** P50 身高 (cm)，年龄超过 18 岁按 18 岁表值；出生前为 null */
export function chinaBoyP50HeightCm(birthYmd: string, weekMondayYmd: string): number | null {
  const age = decimalAgeYears(birthYmd, weekMondayYmd);
  if (age < 0) return null;
  return Math.round(interpP50(Math.min(18, age), "h") * 10) / 10;
}

/** P50 体重 (kg) */
export function chinaBoyP50WeightKg(birthYmd: string, weekMondayYmd: string): number | null {
  const age = decimalAgeYears(birthYmd, weekMondayYmd);
  if (age < 0) return null;
  return Math.round(interpP50(Math.min(18, age), "w") * 100) / 100;
}

export function chinaBoyP50SeriesForWeeks(
  birthYmd: string,
  weekMondayYmds: string[]
): { heights: (number | null)[]; weights: (number | null)[] } {
  const heights = weekMondayYmds.map((w) => chinaBoyP50HeightCm(birthYmd, w));
  const weights = weekMondayYmds.map((w) => chinaBoyP50WeightKg(birthYmd, w));
  return { heights, weights };
}
