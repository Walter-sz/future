"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MediaWatchResourceStack } from "@/components/media/MediaWatchResourceStack";
import type { MediaWorkCard } from "@/lib/media-data";
import { moviesWorkDetailHref } from "@/lib/movies-search-q";

type SearchResp = {
  ok: boolean;
  query: string;
  items: MediaWorkCard[];
};

const Q_PARAM = "q";

export function MediaSearchPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qFromUrl = searchParams.get(Q_PARAM) ?? "";

  const [query, setQuery] = useState(qFromUrl);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SearchResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(qFromUrl);
    const trimmed = qFromUrl.trim();
    if (!trimmed) {
      setResp(null);
      setError(null);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/media/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
      signal: ac.signal,
    })
      .then(async (r) => {
        const data = (await r.json()) as SearchResp;
        if (!r.ok || !data.ok) throw new Error("搜索接口返回异常");
        if (!ac.signal.aborted) setResp(data);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setResp(null);
        setError(err instanceof Error ? err.message : "搜索失败");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [qFromUrl]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      router.replace(pathname, { scroll: false });
      return;
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set(Q_PARAM, trimmed);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <section aria-labelledby="media-search-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="media-search-title" className="mb-2 text-lg font-semibold text-slate-900">
        资源搜索
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        可按名称、导演、演员、剧情等关键词搜索。首版使用文本匹配，后续可升级语义向量检索。
      </p>
      <form onSubmit={onSearch} className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如：想看有汤姆·汉克斯的战争电影"
          className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-amber-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </form>
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {resp ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            查询：<span className="font-medium text-slate-700">{resp.query || "（空）"}</span>，命中{" "}
            {resp.items.length} 条
          </p>
          {resp.items.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">暂无匹配结果</p>
          ) : (
            <ul className="space-y-3">
              {resp.items.map((item) => (
                <li key={item.id} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
                    {item.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.posterUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-slate-400">无图</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                      <Link
                        href={moviesWorkDetailHref(item.id, qFromUrl.trim() ? qFromUrl : null)}
                        className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:text-amber-700"
                      >
                        {item.titleZh}
                        {item.titleEn ? ` / ${item.titleEn}` : ""}
                      </Link>
                      <MediaWatchResourceStack
                        watchStatus={item.watchStatus}
                        hasIndexedPlayableResource={item.hasIndexedPlayableResource}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.mediaType === "tv" ? "剧集" : "电影"} · {item.year ?? "年份未知"} ·{" "}
                      {item.country || "地区未知"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      TMDB {item.tmdbRating != null ? item.tmdbRating.toFixed(1) : "—"} · 豆瓣{" "}
                      {item.doubanRating != null ? item.doubanRating.toFixed(1) : "—"}
                      {item.directorsPreview ? ` · 导演 ${item.directorsPreview}` : ""}
                      {item.actorsPreview ? ` · 演员 ${item.actorsPreview}` : ""}
                    </p>
                    {item.summary ? (
                      <p className="mt-1 text-sm text-slate-700">
                        {item.summary.length > 120 ? `${item.summary.slice(0, 120)}...` : item.summary}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
