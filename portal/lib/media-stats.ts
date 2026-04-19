import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediaWork } from "@/lib/db/schema";
import { getMediaCollectionCounts, MEDIA_TV_COLLECTION_SLUGS } from "@/lib/media-data";
import { whereNasPathIsIndexedLibrary } from "@/lib/media-library-filter";

export type MediaYearStatRow = {
  year: number;
  movieCount: number;
  tvCount: number;
};

export type MediaGenreSlice = {
  name: string;
  value: number;
};

export type MediaMonthlyWatchStat = {
  /** 月份 YYYY-MM */
  monthYm: string;
  /** 短标签，如 2018/08 */
  monthShortLabel: string;
  /** 该自然月内标记为已看的部数（电影+剧集合计） */
  watchedAddedCount: number;
  /** 截至该月末，累积标记为已看的部数（电影+剧集合计） */
  watchedCumulativeCount: number;
};

export type MediaLibraryDashboardStats = {
  yearDistribution: MediaYearStatRow[];
  /** 与下方各电影类合集卡片人数一致（`getMediaCollectionCounts`） */
  movieCollectionDistribution: MediaGenreSlice[];
  /** 与下方美剧 / 英剧 / 其他剧集卡片人数一致；美剧与英剧计数可能重叠 */
  tvCollectionDistribution: MediaGenreSlice[];
  monthlyWatch: {
    months: MediaMonthlyWatchStat[];
    /** 当前库内未看总部数（非按月历史） */
    currentUnwatchedTotal: number;
  };
};

const tvSlugSet = new Set<string>(MEDIA_TV_COLLECTION_SLUGS);

function splitCollectionCounts(
  collections: Awaited<ReturnType<typeof getMediaCollectionCounts>>
): { movieCollectionDistribution: MediaGenreSlice[]; tvCollectionDistribution: MediaGenreSlice[] } {
  const movieCollectionDistribution: MediaGenreSlice[] = [];
  const tvCollectionDistribution: MediaGenreSlice[] = [];
  for (const c of collections) {
    const slice: MediaGenreSlice = { name: c.title, value: c.count };
    if (tvSlugSet.has(c.slug)) tvCollectionDistribution.push(slice);
    else movieCollectionDistribution.push(slice);
  }
  return { movieCollectionDistribution, tvCollectionDistribution };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatUtcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC 自然周，周一为一周之始 */
function utcMondayOf(d: Date): Date {
  const day = d.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(t - mondayOffset * 86400000);
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

function shortWeekLabel(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  return `${parts[1]}/${parts[2]}`;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getMediaYearDistribution(): Promise<MediaYearStatRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      year: mediaWork.year,
      movieCount: sql<number>`sum(case when lower(${mediaWork.mediaType}) = 'movie' then 1 else 0 end)`,
      tvCount: sql<number>`sum(case when lower(${mediaWork.mediaType}) = 'tv' then 1 else 0 end)`,
    })
    .from(mediaWork)
    .where(and(whereNasPathIsIndexedLibrary(), sql`${mediaWork.year} is not null`))
    .groupBy(mediaWork.year)
    .orderBy(mediaWork.year);

  return rows.map((r) => ({
    year: r.year as number,
    movieCount: Number(r.movieCount) || 0,
    tvCount: Number(r.tvCount) || 0,
  }));
}

function formatYm(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export async function getMonthlyWatchedAdded(): Promise<{
  months: MediaMonthlyWatchStat[];
  currentUnwatchedTotal: number;
}> {
  const db = getDb();

  const watchedRows = await db
    .select({ watchedAt: mediaWork.watchedAt })
    .from(mediaWork)
    .where(
      and(
        eq(mediaWork.watchStatus, "watched"),
        whereNasPathIsIndexedLibrary(),
        isNotNull(mediaWork.watchedAt)
      )
    );

  const byMonth = new Map<string, number>();

  let minDate: Date | null = null;
  for (const row of watchedRows) {
    const d = toDate(row.watchedAt);
    if (!d) continue;
    if (!minDate || d < minDate) minDate = d;
    const key = formatYm(d);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const endYm = formatYm(now);
  const startYm = minDate ? formatYm(minDate) : endYm;

  const monthKeys: string[] = [];
  if (minDate) {
    let y = minDate.getUTCFullYear();
    let m = minDate.getUTCMonth();
    const endY = now.getUTCFullYear();
    const endM = now.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      monthKeys.push(`${y}-${pad2(m + 1)}`);
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }
  if (monthKeys.length === 0) monthKeys.push(endYm);

  let cumulative = 0;
  const months: MediaMonthlyWatchStat[] = monthKeys.map((ym) => {
    const added = byMonth.get(ym) ?? 0;
    cumulative += added;
    return {
      monthYm: ym,
      monthShortLabel: ym,
      watchedAddedCount: added,
      watchedCumulativeCount: cumulative,
    };
  });

  const unw = await db
    .select({ c: sql<number>`count(*)` })
    .from(mediaWork)
    .where(and(whereNasPathIsIndexedLibrary(), ne(mediaWork.watchStatus, "watched")));

  return {
    months,
    currentUnwatchedTotal: Number(unw[0]?.c ?? 0),
  };
}

export async function getMediaLibraryDashboardStats(): Promise<MediaLibraryDashboardStats> {
  const [yearDistribution, collections, monthlyWatch] = await Promise.all([
    getMediaYearDistribution(),
    getMediaCollectionCounts(),
    getMonthlyWatchedAdded(),
  ]);

  const { movieCollectionDistribution, tvCollectionDistribution } = splitCollectionCounts(collections);

  return {
    yearDistribution,
    movieCollectionDistribution,
    tvCollectionDistribution,
    monthlyWatch,
  };
}
