import { formatDate, parseYmd } from "@/lib/week";

/** Mike 出生日期（用于 Portal 图表中的年龄展示） */
export const MIKE_BIRTH_YMD = "2016-07-12";

/** 按「周岁」习惯：以 `asOfYmd` 当天是否已过本年度生日为准，并给出整月数 */
export function ageYearsMonthsAt(birthYmd: string, asOfYmd: string): { years: number; months: number } | null {
  const birth = parseYmd(birthYmd);
  const asOf = parseYmd(asOfYmd);
  if (asOf < birth) return null;

  let years = asOf.getFullYear() - birth.getFullYear();
  let months = asOf.getMonth() - birth.getMonth();
  if (asOf.getDate() < birth.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months };
}

/** 人类可读，如「9 岁 8 个月」「10 岁」 */
export function formatAgeZh(birthYmd: string, asOfYmd: string): string {
  const a = ageYearsMonthsAt(birthYmd, asOfYmd);
  if (!a) return "—";
  if (a.months === 0) return `${a.years} 岁`;
  return `${a.years} 岁 ${a.months} 个月`;
}

/** 数据周以「周一」为标识：用该周一作为年龄计算的参考日（与周数据对齐） */
export function formatAgeZhForWeekMonday(birthYmd: string, weekMondayYmd: string): string {
  return formatAgeZh(birthYmd, weekMondayYmd);
}

/** Portal 文案：截至服务器「今天」的岁数（依赖运行环境时区，建议设 TZ=Asia/Shanghai） */
export function mikeAgeSummaryTodayLine(): string {
  const today = formatDate(new Date());
  const age = formatAgeZh(MIKE_BIRTH_YMD, today);
  return `出生于 ${MIKE_BIRTH_YMD}，截至今日约 ${age}`;
}
