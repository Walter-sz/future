import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediaTag, mediaWork, mediaWorkTag } from "@/lib/db/schema";

export type MediaCollection = {
  slug: string;
  title: string;
  description: string;
  count: number;
};

export type MediaWorkCard = {
  id: number;
  titleZh: string;
  titleEn: string;
  mediaType: string;
  year: number | null;
  tmdbRating: number | null;
  doubanRating: number | null;
  summary: string | null;
  posterUrl: string | null;
  country: string | null;
  language: string | null;
  matchStatus: string;
  tags: string[];
};

const COLLECTIONS: Omit<MediaCollection, "count">[] = [
  { slug: "war", title: "战争片合集", description: "战争与军事题材影片" },
  { slug: "romance", title: "爱情片合集", description: "爱情与情感题材影片" },
  { slug: "us-tv", title: "美剧合集", description: "美国电视剧与剧集" },
  { slug: "uk-tv", title: "英剧合集", description: "英国电视剧与剧集" },
  { slug: "other-tv", title: "其他剧合集", description: "非美剧/英剧的电视剧集合" },
];

export function getCollectionMeta(slug: string) {
  return COLLECTIONS.find((c) => c.slug === slug);
}

function parseJsonArray(v: string | null): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function tagsByWorkIds(workIds: number[]) {
  if (workIds.length === 0) return new Map<number, string[]>();
  const db = getDb();
  const rows = await db
    .select({
      workId: mediaWorkTag.workId,
      tagName: mediaTag.name,
    })
    .from(mediaWorkTag)
    .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
    .where(inArray(mediaWorkTag.workId, workIds));
  const out = new Map<number, string[]>();
  for (const row of rows) {
    if (!out.has(row.workId)) out.set(row.workId, []);
    out.get(row.workId)!.push(row.tagName);
  }
  return out;
}

export async function getMediaCollectionCounts(): Promise<MediaCollection[]> {
  const db = getDb();

  const [war, romance, usTv, ukTv, otherTv] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)` })
      .from(mediaWork)
      .innerJoin(mediaWorkTag, eq(mediaWorkTag.workId, mediaWork.id))
      .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
      .where(eq(mediaTag.slug, "war")),
    db
      .select({ c: sql<number>`count(*)` })
      .from(mediaWork)
      .innerJoin(mediaWorkTag, eq(mediaWorkTag.workId, mediaWork.id))
      .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
      .where(eq(mediaTag.slug, "romance")),
    db
      .select({ c: sql<number>`count(*)` })
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), or(like(mediaWork.country, "%US%"), like(mediaWork.country, "%美国%")))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), or(like(mediaWork.country, "%GB%"), like(mediaWork.country, "%英国%")))),
    db
      .select({ c: sql<number>`count(*)` })
      .from(mediaWork)
      .where(
        and(
          eq(mediaWork.mediaType, "tv"),
          sql`coalesce(${mediaWork.country}, '') not like '%US%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%美国%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%GB%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%英国%'`
        )
      ),
  ]);

  const counts = [war, romance, usTv, ukTv, otherTv].map((rows) => rows[0]?.c ?? 0);
  return COLLECTIONS.map((c, idx) => ({ ...c, count: counts[idx] }));
}

export async function getWorksByCollection(collectionSlug: string): Promise<MediaWorkCard[]> {
  const db = getDb();
  let rows: (typeof mediaWork.$inferSelect)[];

  if (collectionSlug === "war" || collectionSlug === "romance") {
    rows = await db
      .select({ work: mediaWork })
      .from(mediaWork)
      .innerJoin(mediaWorkTag, eq(mediaWorkTag.workId, mediaWork.id))
      .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
      .where(eq(mediaTag.slug, collectionSlug))
      .orderBy(desc(mediaWork.updatedAt))
      .then((x) => x.map((r) => r.work));
  } else if (collectionSlug === "us-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), or(like(mediaWork.country, "%US%"), like(mediaWork.country, "%美国%"))))
      .orderBy(desc(mediaWork.updatedAt));
  } else if (collectionSlug === "uk-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), or(like(mediaWork.country, "%GB%"), like(mediaWork.country, "%英国%"))))
      .orderBy(desc(mediaWork.updatedAt));
  } else if (collectionSlug === "other-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(
        and(
          eq(mediaWork.mediaType, "tv"),
          sql`coalesce(${mediaWork.country}, '') not like '%US%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%美国%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%GB%'`,
          sql`coalesce(${mediaWork.country}, '') not like '%英国%'`
        )
      )
      .orderBy(desc(mediaWork.updatedAt));
  } else {
    return [];
  }

  const tagsMap = await tagsByWorkIds(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    titleZh: r.titleZh,
    titleEn: r.titleEn,
    mediaType: r.mediaType,
    year: r.year,
    tmdbRating: r.tmdbRating,
    doubanRating: r.doubanRating,
    summary: r.summary,
    posterUrl: r.posterUrl,
    country: r.country,
    language: r.language,
    matchStatus: r.matchStatus,
    tags: tagsMap.get(r.id) ?? [],
  }));
}

export async function getMediaWorkById(id: number): Promise<MediaWorkCard | null> {
  const db = getDb();
  const rows = await db.select().from(mediaWork).where(eq(mediaWork.id, id)).limit(1);
  const work = rows[0];
  if (!work) return null;
  const tagsMap = await tagsByWorkIds([work.id]);
  return {
    id: work.id,
    titleZh: work.titleZh,
    titleEn: work.titleEn,
    mediaType: work.mediaType,
    year: work.year,
    tmdbRating: work.tmdbRating,
    doubanRating: work.doubanRating,
    summary: work.summary,
    posterUrl: work.posterUrl,
    country: work.country,
    language: work.language,
    matchStatus: work.matchStatus,
    tags: tagsMap.get(work.id) ?? [],
  };
}

export async function searchMediaWorks(query: string, limit = 20): Promise<MediaWorkCard[]> {
  const q = query.trim();
  if (!q) return [];
  const db = getDb();

  const raw = await db
    .select()
    .from(mediaWork)
    .where(
      or(
        like(mediaWork.titleZh, `%${q}%`),
        like(mediaWork.titleEn, `%${q}%`),
        like(mediaWork.summary, `%${q}%`),
        like(mediaWork.directorsJson, `%${q}%`),
        like(mediaWork.actorsJson, `%${q}%`),
        like(mediaWork.searchText, `%${q}%`)
      )
    )
    .orderBy(desc(mediaWork.updatedAt))
    .limit(limit);

  const tagsMap = await tagsByWorkIds(raw.map((r) => r.id));
  return raw.map((r) => ({
    id: r.id,
    titleZh: r.titleZh,
    titleEn: r.titleEn,
    mediaType: r.mediaType,
    year: r.year,
    tmdbRating: r.tmdbRating,
    doubanRating: r.doubanRating,
    summary: r.summary,
    posterUrl: r.posterUrl,
    country: r.country,
    language: r.language,
    matchStatus: r.matchStatus,
    tags: tagsMap.get(r.id) ?? [],
  }));
}

export function formatPeople(jsonText: string | null): string[] {
  return parseJsonArray(jsonText);
}
