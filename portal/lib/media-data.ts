import { and, desc, eq, inArray, like, not, notExists, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediaTag, mediaWork, mediaWorkTag } from "@/lib/db/schema";
import {
  sqlTvOriginLooksUk,
  sqlTvOriginLooksUs,
  whereNasPathIsIndexedLibrary,
} from "@/lib/media-library-filter";

/** 用于「其他」合集：无以下任一类型 tag 的电影 */
export const MAINSTREAM_MEDIA_TAG_SLUGS = [
  "action",
  "comedy",
  "drama",
  "sci-fi",
  "thriller",
  "horror",
  "animation",
  "war",
  "romance",
  "documentary",
  "fantasy",
  "crime",
  "family",
  "history",
  "mystery",
] as const;

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
  watchStatus: string;
  directorsPreview: string;
  actorsPreview: string;
};

const COLLECTION_DEFS: Omit<MediaCollection, "count">[] = [
  { slug: "action", title: "动作片", description: "动作、冒险类影片" },
  { slug: "comedy", title: "喜剧片", description: "喜剧题材" },
  { slug: "drama", title: "剧情片", description: "剧情与现实主义题材" },
  { slug: "sci-fi", title: "科幻片", description: "科幻与未来题材" },
  { slug: "thriller", title: "悬疑惊悚", description: "悬疑、惊悚类" },
  { slug: "horror", title: "恐怖片", description: "恐怖题材" },
  { slug: "animation", title: "动画", description: "动画电影与系列" },
  { slug: "war", title: "战争片", description: "战争与军事题材" },
  { slug: "romance", title: "爱情片", description: "爱情与情感题材" },
  { slug: "documentary", title: "纪录片", description: "纪录类作品" },
  { slug: "fantasy", title: "奇幻片", description: "奇幻与魔幻题材" },
  { slug: "crime", title: "犯罪片", description: "犯罪、警匪题材" },
  { slug: "family", title: "家庭片", description: "家庭与儿童向剧情" },
  { slug: "history", title: "历史片", description: "历史与传记题材" },
  { slug: "mystery", title: "推理片", description: "推理与侦探题材" },
  { slug: "us-tv", title: "美剧", description: "含美国出品/合拍；同一部也可同时出现在英剧" },
  { slug: "uk-tv", title: "英剧", description: "含英国出品/合拍；同一部也可同时出现在美剧" },
  { slug: "other-tv", title: "其他剧集", description: "产地信息既不偏美也不偏英的剧集" },
  { slug: "other", title: "其他电影", description: "未归入以上主流类型的电影" },
];

export function getCollectionMeta(slug: string) {
  return COLLECTION_DEFS.find((c) => c.slug === slug);
}

export function listCollectionDefs() {
  return COLLECTION_DEFS;
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

function previewPeople(jsonText: string | null, max: number) {
  const arr = parseJsonArray(jsonText);
  return arr.slice(0, max).join("、");
}

function workToCard(
  r: typeof mediaWork.$inferSelect,
  tagsMap: Map<number, string[]>
): MediaWorkCard {
  return {
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
    watchStatus: r.watchStatus ?? "unwatched",
    directorsPreview: previewPeople(r.directorsJson, 3),
    actorsPreview: previewPeople(r.actorsJson, 4),
  };
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

async function countByTagSlug(slug: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(mediaWork)
    .innerJoin(mediaWorkTag, eq(mediaWorkTag.workId, mediaWork.id))
    .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
    .where(
      and(
        eq(mediaWork.mediaType, "movie"),
        eq(mediaTag.slug, slug),
        whereNasPathIsIndexedLibrary()
      )
    );
  return rows[0]?.c ?? 0;
}

async function countOtherMovies(): Promise<number> {
  const db = getDb();
  const slugList = [...MAINSTREAM_MEDIA_TAG_SLUGS];
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(mediaWork)
    .where(
      and(
        eq(mediaWork.mediaType, "movie"),
        whereNasPathIsIndexedLibrary(),
        notExists(
          db
            .select({ w: mediaWorkTag.workId })
            .from(mediaWorkTag)
            .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
            .where(
              and(eq(mediaWorkTag.workId, mediaWork.id), inArray(mediaTag.slug, slugList as unknown as string[]))
            )
        )
      )
    );
  return rows[0]?.c ?? 0;
}

export async function getMediaCollectionCounts(): Promise<MediaCollection[]> {
  const db = getDb();
  const counts = new Map<string, number>();

  for (const def of COLLECTION_DEFS) {
    if (def.slug === "us-tv") {
      const r = await db
        .select({ c: sql<number>`count(*)` })
        .from(mediaWork)
        .where(
          and(eq(mediaWork.mediaType, "tv"), whereNasPathIsIndexedLibrary(), sqlTvOriginLooksUs())
        );
      counts.set(def.slug, r[0]?.c ?? 0);
    } else if (def.slug === "uk-tv") {
      const r = await db
        .select({ c: sql<number>`count(*)` })
        .from(mediaWork)
        .where(and(eq(mediaWork.mediaType, "tv"), whereNasPathIsIndexedLibrary(), sqlTvOriginLooksUk()));
      counts.set(def.slug, r[0]?.c ?? 0);
    } else if (def.slug === "other-tv") {
      const r = await db
        .select({ c: sql<number>`count(*)` })
        .from(mediaWork)
        .where(
          and(
            eq(mediaWork.mediaType, "tv"),
            whereNasPathIsIndexedLibrary(),
            not(sqlTvOriginLooksUs()),
            not(sqlTvOriginLooksUk())
          )
        );
      counts.set(def.slug, r[0]?.c ?? 0);
    } else if (def.slug === "other") {
      counts.set(def.slug, await countOtherMovies());
    } else {
      counts.set(def.slug, await countByTagSlug(def.slug));
    }
  }

  return COLLECTION_DEFS.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}

export async function getWorksByCollection(collectionSlug: string): Promise<MediaWorkCard[]> {
  const db = getDb();
  let rows: (typeof mediaWork.$inferSelect)[];

  if (collectionSlug === "us-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), whereNasPathIsIndexedLibrary(), sqlTvOriginLooksUs()))
      .orderBy(desc(mediaWork.updatedAt));
  } else if (collectionSlug === "uk-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(and(eq(mediaWork.mediaType, "tv"), whereNasPathIsIndexedLibrary(), sqlTvOriginLooksUk()))
      .orderBy(desc(mediaWork.updatedAt));
  } else if (collectionSlug === "other-tv") {
    rows = await db
      .select()
      .from(mediaWork)
      .where(
        and(
          eq(mediaWork.mediaType, "tv"),
          whereNasPathIsIndexedLibrary(),
          not(sqlTvOriginLooksUs()),
          not(sqlTvOriginLooksUk())
        )
      )
      .orderBy(desc(mediaWork.updatedAt));
  } else if (collectionSlug === "other") {
    const slugList = [...MAINSTREAM_MEDIA_TAG_SLUGS];
    rows = await db
      .select()
      .from(mediaWork)
      .where(
        and(
          eq(mediaWork.mediaType, "movie"),
          whereNasPathIsIndexedLibrary(),
          notExists(
            db
              .select({ w: mediaWorkTag.workId })
              .from(mediaWorkTag)
              .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
              .where(
                and(eq(mediaWorkTag.workId, mediaWork.id), inArray(mediaTag.slug, slugList as unknown as string[]))
              )
          )
        )
      )
      .orderBy(desc(mediaWork.updatedAt));
  } else if (COLLECTION_DEFS.some((c) => c.slug === collectionSlug && c.slug !== "other")) {
    rows = await db
      .select({ work: mediaWork })
      .from(mediaWork)
      .innerJoin(mediaWorkTag, eq(mediaWorkTag.workId, mediaWork.id))
      .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
      .where(
        and(
          eq(mediaWork.mediaType, "movie"),
          eq(mediaTag.slug, collectionSlug),
          whereNasPathIsIndexedLibrary()
        )
      )
      .orderBy(desc(mediaWork.updatedAt))
      .then((x) => x.map((r) => r.work));
  } else {
    return [];
  }

  const tagsMap = await tagsByWorkIds(rows.map((r) => r.id));
  return rows.map((r) => workToCard(r, tagsMap));
}

export async function getMediaWorkById(id: number): Promise<MediaWorkCard | null> {
  const db = getDb();
  const rows = await db.select().from(mediaWork).where(eq(mediaWork.id, id)).limit(1);
  const work = rows[0];
  if (!work) return null;
  const tagsMap = await tagsByWorkIds([work.id]);
  return workToCard(work, tagsMap);
}

export async function searchMediaWorks(query: string, limit = 20): Promise<MediaWorkCard[]> {
  const q = query.trim();
  if (!q) return [];
  const db = getDb();

  const raw = await db
    .select()
    .from(mediaWork)
    .where(
      and(
        whereNasPathIsIndexedLibrary(),
        or(
          like(mediaWork.titleZh, `%${q}%`),
          like(mediaWork.titleEn, `%${q}%`),
          like(mediaWork.summary, `%${q}%`),
          like(mediaWork.directorsJson, `%${q}%`),
          like(mediaWork.actorsJson, `%${q}%`),
          like(mediaWork.searchText, `%${q}%`)
        )
      )
    )
    .orderBy(desc(mediaWork.updatedAt))
    .limit(limit);

  const tagsMap = await tagsByWorkIds(raw.map((r) => r.id));
  return raw.map((r) => workToCard(r, tagsMap));
}

export function formatPeople(jsonText: string | null): string[] {
  return parseJsonArray(jsonText);
}
