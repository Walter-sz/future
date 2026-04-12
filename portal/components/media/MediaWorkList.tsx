import Link from "next/link";
import type { MediaWorkCard } from "@/lib/media-data";

function scoreText(score: number | null) {
  if (score == null) return "—";
  return score.toFixed(1);
}

export function MediaWorkList({ works }: { works: MediaWorkCard[] }) {
  if (works.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        暂无资源。可先通过影视资源 Agent 扫描并入库元数据。
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {works.map((w) => (
        <li
          key={w.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                href={`/movies/work/${w.id}`}
                scroll={false}
                className="text-base font-semibold text-slate-900 hover:text-amber-700"
              >
                {w.titleZh}
                {w.titleEn ? (
                  <span className="ml-2 text-sm font-normal text-slate-500">{w.titleEn}</span>
                ) : null}
              </Link>
              <p className="mt-1 text-xs text-slate-500">
                {w.mediaType === "tv" ? "剧集" : "电影"} · {w.year ?? "年份未知"} ·{" "}
                {w.country || "地区未知"}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>TMDB {scoreText(w.tmdbRating)}</div>
              <div>豆瓣 {scoreText(w.doubanRating)}</div>
            </div>
          </div>
          {w.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {w.tags.map((tag) => (
                <span
                  key={`${w.id}-${tag}`}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {w.summary ? <p className="mt-2 line-clamp-2 text-sm text-slate-700">{w.summary}</p> : null}
        </li>
      ))}
    </ul>
  );
}
