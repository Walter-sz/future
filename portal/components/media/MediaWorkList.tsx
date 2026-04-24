import Link from "next/link";
import type { MediaWorkCard } from "@/lib/media-data";
import { MediaWatchResourceStack } from "@/components/media/MediaWatchResourceStack";

function scoreText(score: number | null) {
  if (score == null) return "—";
  return score.toFixed(1);
}

function ratingCountText(count: number | null | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万人`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}千人`;
  return `${count}人`;
}

type ListProps = {
  works: MediaWorkCard[];
  /** 从合集页进入时在详情链接上附带 ?from=，避免标记已看后 refresh 丢失 Referer */
  collectionSlug?: string;
};

export function MediaWorkList({ works, collectionSlug }: ListProps) {
  if (works.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        暂无资源。可先通过影视资源 Agent 扫描并入库元数据。
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {works.map((w) => (
        <li key={w.id} className="min-w-0">
          <Link
            href={
              collectionSlug
                ? `/movies/work/${w.id}?from=${encodeURIComponent(collectionSlug)}`
                : `/movies/work/${w.id}`
            }
            className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-amber-300/80 hover:shadow-md"
          >
            <div className="relative aspect-[2/3] w-full shrink-0 overflow-hidden bg-slate-100">
              <div className="pointer-events-none absolute right-2 top-2 z-10 sm:right-2.5 sm:top-2.5">
                <MediaWatchResourceStack
                  watchStatus={w.watchStatus}
                  hasIndexedPlayableResource={w.hasIndexedPlayableResource}
                  pointerEventsNone
                />
              </div>
              {w.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={w.posterUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
                  暂无封面
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900 group-hover:text-amber-800">
                {w.titleZh}
              </h3>
              {w.titleEn ? (
                <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{w.titleEn}</p>
              ) : null}
              <p className="mt-2 text-xs text-slate-500">
                {w.mediaType === "tv" ? "剧集" : "电影"} · {w.year ?? "年份未知"}
              </p>
              <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">{w.country || "地区未知"}</p>
              <p className="mt-1.5 text-[11px] text-slate-600">
                TMDB {scoreText(w.tmdbRating)}
                <span className="mx-1.5 text-slate-300">|</span>
                豆瓣 {scoreText(w.doubanRating)}
                {(() => {
                  const t = ratingCountText(w.doubanRatingCount);
                  return t ? <span className="ml-1 text-slate-400">({t})</span> : null;
                })()}
              </p>
              {w.tags.length > 0 ? (
                <div className="mt-2 flex max-h-14 flex-wrap gap-1 overflow-hidden">
                  {w.tags.slice(0, 5).map((tag) => (
                    <span
                      key={`${w.id}-${tag}`}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                  {w.tags.length > 5 ? (
                    <span className="self-center text-[11px] text-slate-400">+{w.tags.length - 5}</span>
                  ) : null}
                </div>
              ) : null}
              {w.directorsPreview ? (
                <p className="mt-2 line-clamp-1 text-[11px] text-slate-600">导演 {w.directorsPreview}</p>
              ) : null}
              {w.summary ? (
                <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">{w.summary}</p>
              ) : (
                <p className="mt-2 flex-1 text-sm text-slate-400">暂无简介</p>
              )}
              <span className="mt-3 text-xs font-medium text-amber-700/80 group-hover:text-amber-800">
                查看详情 →
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
