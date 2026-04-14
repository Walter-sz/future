import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MediaWorkDetailArticle } from "@/components/media/MediaWorkDetailArticle";
import { getCollectionMeta, getMediaWorkById } from "@/lib/media-data";
import { moviesHomeHrefWithSearchQ, parseMoviesSearchQ } from "@/lib/movies-search-q";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[]; q?: string | string[] }>;
};

export const dynamic = "force-dynamic";

function parseJsonArray(v: string | null | undefined) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map((x) => String(x)) : [];
  } catch {
    return [];
  }
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

  const item = await getMediaWorkById(numeric);
  if (!item) notFound();

  const directors = parseJsonArray(item.directorsJson);
  const actors = parseJsonArray(item.actorsJson);
  const tagNames = item.tags;
  const searchBackQ = parseMoviesSearchQ(sp.q);
  const moviesHomeHref = moviesHomeHrefWithSearchQ(searchBackQ);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={moviesHomeHref} className="text-sm text-amber-700 hover:underline">
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
        <MediaWorkDetailArticle workId={numeric} item={item} directors={directors} actors={actors} tagNames={tagNames} />
      </article>
    </div>
  );
}
