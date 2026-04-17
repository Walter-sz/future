import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediaTag, mediaWork, mediaWorkTag } from "@/lib/db/schema";
import { getMediaWorkById, replaceMainstreamGenreTagsForWork } from "@/lib/media-data";
import {
  buildMediaSearchText,
  mergeUserMetaOverridesJson,
  parseUserMetaOverridesJson,
  resolveMetadataAbsolutePath,
  uniqueJoinTitle,
  validateMetaPatch,
  writeMetadataSidecarUserOverrides,
  type UserMetaOverrides,
} from "@/lib/media-user-meta";

type PatchBody = {
  watchStatus?: string;
  meta?: UserMetaOverrides;
  /** 仅电影；slug 须为库内主流类型，整组替换（可空数组表示清空） */
  genreTagSlugs?: string[];
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const item = await getMediaWorkById(numeric);
  if (!item) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, item });
}

async function tagsJoinedForWork(workId: number): Promise<string> {
  const db = getDb();
  const tagRows = await db
    .select({ name: mediaTag.name })
    .from(mediaWorkTag)
    .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
    .where(eq(mediaWorkTag.workId, workId));
  return tagRows.map((r) => r.name).join(" ");
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const hasWatch = body.watchStatus !== undefined;
  const hasMeta = body.meta !== undefined && body.meta !== null && typeof body.meta === "object";
  const hasGenre =
    Object.prototype.hasOwnProperty.call(body, "genreTagSlugs") && Array.isArray(body.genreTagSlugs);

  if (!hasWatch && !hasMeta && !hasGenre) {
    return Response.json({ ok: false, error: "需提供 watchStatus、meta 或 genreTagSlugs" }, { status: 400 });
  }

  if (hasGenre && !body.genreTagSlugs!.every((s) => typeof s === "string")) {
    return Response.json({ ok: false, error: "genreTagSlugs 须为字符串数组" }, { status: 400 });
  }

  if (hasWatch && body.watchStatus !== "watched" && body.watchStatus !== "unwatched") {
    return Response.json({ ok: false, error: "watchStatus 须为 watched 或 unwatched" }, { status: 400 });
  }

  let metaPatch: UserMetaOverrides = {};
  if (hasMeta) {
    metaPatch = { ...body.meta };
    const keys = Object.keys(metaPatch).filter((k) => metaPatch[k as keyof UserMetaOverrides] !== undefined);
    if (keys.length === 0) {
      return Response.json({ ok: false, error: "meta 不能为空对象" }, { status: 400 });
    }
    const v = validateMetaPatch(metaPatch);
    if (!v.ok) return Response.json({ ok: false, error: v.error }, { status: 400 });
  }

  const db = getDb();
  const rows = await db.select().from(mediaWork).where(eq(mediaWork.id, numeric)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const now = new Date();

  const nextMediaType: "movie" | "tv" =
    hasMeta && metaPatch.mediaType !== undefined
      ? metaPatch.mediaType === "tv"
        ? "tv"
        : "movie"
      : row.mediaType === "tv"
        ? "tv"
        : "movie";

  if (hasGenre && nextMediaType !== "movie") {
    return Response.json({ ok: false, error: "仅电影作品可设置类型标签" }, { status: 400 });
  }

  if (hasGenre) {
    try {
      await replaceMainstreamGenreTagsForWork(
        numeric,
        (body.genreTagSlugs as string[]).map((s) => s.trim()).filter(Boolean)
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "类型标签更新失败";
      return Response.json({ ok: false, error: msg }, { status: 400 });
    }
  }

  if (hasMeta) {
    const titleZh = metaPatch.titleZh !== undefined ? String(metaPatch.titleZh).trim() : row.titleZh;
    const titleEn = metaPatch.titleEn !== undefined ? String(metaPatch.titleEn ?? "").trim() : row.titleEn;
    const year: number | null =
      metaPatch.year !== undefined
        ? metaPatch.year === null
          ? null
          : Math.round(Number(metaPatch.year))
        : row.year;
    const country = metaPatch.country !== undefined ? (metaPatch.country === null ? null : String(metaPatch.country)) : row.country;
    const summary = metaPatch.summary !== undefined ? (metaPatch.summary === null ? null : String(metaPatch.summary)) : row.summary;
    const tmdbRating: number | null =
      metaPatch.tmdbRating !== undefined
        ? metaPatch.tmdbRating === null
          ? null
          : Number(metaPatch.tmdbRating)
        : row.tmdbRating;
    const doubanRating: number | null =
      metaPatch.doubanRating !== undefined
        ? metaPatch.doubanRating === null
          ? null
          : Number(metaPatch.doubanRating)
        : row.doubanRating;

    const mediaType: "movie" | "tv" =
      metaPatch.mediaType !== undefined
        ? metaPatch.mediaType === "tv"
          ? "tv"
          : "movie"
        : row.mediaType === "tv"
          ? "tv"
          : "movie";

    const mergedOverridesJson = mergeUserMetaOverridesJson(row.userMetaOverridesJson, metaPatch);
    const normalizedTitle = uniqueJoinTitle(titleZh, titleEn);
    const tagsJoined = await tagsJoinedForWork(numeric);
    const searchText = buildMediaSearchText({
      titleZh,
      titleEn,
      summary,
      directorsJson: row.directorsJson,
      actorsJson: row.actorsJson,
      tagsJoined,
      country,
    });

    await db
      .update(mediaWork)
      .set({
        titleZh,
        titleEn,
        normalizedTitle,
        mediaType,
        year,
        country,
        summary,
        tmdbRating,
        doubanRating,
        userMetaOverridesJson: mergedOverridesJson,
        searchText,
        updatedAt: now,
      })
      .where(eq(mediaWork.id, numeric));

    const metaAbs = resolveMetadataAbsolutePath(row.metadataPath);
    if (metaAbs) {
      try {
        writeMetadataSidecarUserOverrides(metaAbs, {
          titleZh,
          titleEn,
          normalizedTitle,
          mediaType,
          year,
          country,
          language: row.language,
          tmdbRating,
          doubanRating,
          summary,
          userMetaOverrides: parseUserMetaOverridesJson(mergedOverridesJson),
        });
      } catch {
        /* 元数据文件写入失败不阻断 DB 更新 */
      }
    }
  } else if (hasGenre) {
    const tagsJoined = await tagsJoinedForWork(numeric);
    const searchText = buildMediaSearchText({
      titleZh: row.titleZh,
      titleEn: row.titleEn,
      summary: row.summary,
      directorsJson: row.directorsJson,
      actorsJson: row.actorsJson,
      tagsJoined,
      country: row.country,
    });
    await db.update(mediaWork).set({ searchText, updatedAt: now }).where(eq(mediaWork.id, numeric));
  }

  if (hasWatch) {
    const watchedAt = body.watchStatus === "watched" ? now : null;
    await db
      .update(mediaWork)
      .set({ watchStatus: body.watchStatus, watchedAt, updatedAt: now })
      .where(eq(mediaWork.id, numeric));
  }

  const item = await getMediaWorkById(numeric);
  if (!item) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, item });
}
