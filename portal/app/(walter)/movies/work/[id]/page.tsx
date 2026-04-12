import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WatchStatusBadge } from "@/components/media/WatchStatusBadge";
import { WatchStatusControl } from "@/components/media/WatchStatusControl";
import { getDb } from "@/lib/db";
import { mediaTag, mediaWork, mediaWorkTag } from "@/lib/db/schema";
import { getCollectionMeta } from "@/lib/media-data";
import { eq } from "drizzle-orm";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
};

export const dynamic = "force-dynamic";

function parseJsonArray(v: string | null) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function score(v: number | null) {
  return v == null ? "—" : v.toFixed(1);
}

function matchStatusLabel(s: string) {
  if (s === "matched") return "TMDB 已匹配";
  if (s === "ai_inferred") return "Gemini 推测（无 TMDB 命中）";
  if (s === "unresolved") return "未匹配";
  return s;
}

function parseCollectionSlugFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    const m = u.pathname.match(/^\/movies\/collection\/([^/]+)\/?$/);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** 查询参数 from=合集 slug（须为已知合集），避免仅依赖 Referer（标记已看 refresh 后 Referer 会变成详情页自身）。 */
function collectionSlugFromSearchParams(from: string | string[] | undefined): string | null {
  const raw = typeof from === "string" ? from : Array.isArray(from) ? from[0] : undefined;
  if (!raw?.trim()) return null;
  try {
    const decoded = decodeURIComponent(raw.trim());
    if (!decoded || decoded.length > 160) return null;
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return null;
    return getCollectionMeta(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export default async function MediaWorkDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) notFound();

  const headerList = await headers();
  const refererCollectionSlug = parseCollectionSlugFromReferer(headerList.get("referer"));
  const collectionBackSlug = collectionSlugFromSearchParams(sp.from) ?? refererCollectionSlug;

  const db = getDb();
  const rows = await db.select().from(mediaWork).where(eq(mediaWork.id, numeric)).limit(1);
  const work = rows[0];
  if (!work) notFound();

  const directors = parseJsonArray(work.directorsJson);
  const actors = parseJsonArray(work.actorsJson);
  const tagRows = await db
    .select({ name: mediaTag.name })
    .from(mediaWorkTag)
    .innerJoin(mediaTag, eq(mediaTag.id, mediaWorkTag.tagId))
    .where(eq(mediaWorkTag.workId, numeric));
  const tagNames = tagRows.map((r) => r.name);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/movies" className="text-sm text-amber-700 hover:underline">
          ← 返回影视资源
        </Link>
        {collectionBackSlug ? (
          <Link
            href={`/movies/collection/${encodeURIComponent(collectionBackSlug)}`}
            scroll={false}
            className="text-sm text-amber-700 hover:underline"
          >
            ← 返回合集
          </Link>
        ) : null}
      </div>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-4 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-center gap-2 gap-y-2">
            <h1 className="text-xl font-semibold text-slate-900">
              {work.titleZh}
              {work.titleEn ? <span className="ml-2 text-base font-normal text-slate-500">{work.titleEn}</span> : null}
            </h1>
            <WatchStatusBadge status={work.watchStatus ?? "unwatched"} variant="inline" className="sm:text-sm" />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {work.mediaType === "tv" ? "剧集" : "电影"} · {work.year ?? "年份未知"} · {work.country || "地区未知"}
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-[220px,1fr]">
          <div className="space-y-4">
            <div>
              {work.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={work.posterUrl}
                  alt={`${work.titleZh} 海报`}
                  className="w-full rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                  暂无封面
                </div>
              )}
            </div>
            <WatchStatusControl workId={numeric} initialStatus={work.watchStatus ?? "unwatched"} />
          </div>

          <div className="space-y-3 text-sm text-slate-700">
            <p>
              <span className="font-medium text-slate-900">TMDB 评分：</span>
              {score(work.tmdbRating)}
            </p>
            <p>
              <span className="font-medium text-slate-900">豆瓣评分：</span>
              {score(work.doubanRating)}
            </p>
            <p>
              <span className="font-medium text-slate-900">导演：</span>
              {directors.length > 0 ? directors.join("、") : "暂无"}
            </p>
            <p>
              <span className="font-medium text-slate-900">主要演员：</span>
              {actors.length > 0 ? actors.join("、") : "暂无"}
            </p>
            {tagNames.length > 0 ? (
              <p>
                <span className="font-medium text-slate-900">类型标签：</span>
                {tagNames.join("、")}
              </p>
            ) : null}
            <p>
              <span className="font-medium text-slate-900">元数据来源：</span>
              {matchStatusLabel(work.matchStatus)}
            </p>
            <p>
              <span className="font-medium text-slate-900">NAS 路径：</span>
              <code className="break-all rounded bg-slate-100 px-1 py-0.5 text-xs">{work.nasLibraryPath}</code>
            </p>
            <div>
              <p className="mb-1 font-medium text-slate-900">剧情简介</p>
              <p className="leading-relaxed text-slate-700">{work.summary || "暂无简介"}</p>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
