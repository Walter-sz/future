"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaWorkCard } from "@/lib/media-data";
import { MediaWatchResourceStack } from "@/components/media/MediaWatchResourceStack";
import { WatchStatusControl } from "@/components/media/WatchStatusControl";
import type { UserMetaOverrides, UserMetaOverrideKey } from "@/lib/media-user-meta";

type Props = {
  workId: number;
  item: MediaWorkCard;
  directors: string[];
  actors: string[];
  tagNames: string[];
  /** 电影主流类型选项（slug + 展示名，来自 media_tag / 合集定义） */
  genreOptions: { slug: string; label: string }[];
};

function score(v: number | null) {
  return v == null ? "—" : v.toFixed(1);
}

/** 将评分人数格式化为「12,345 人」；无效值返回 null。 */
function formatRatingCount(count: number | null | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  return `${Math.round(count).toLocaleString("zh-CN")} 人`;
}

function matchStatusLabel(s: string) {
  if (s === "matched") return "TMDB 已匹配";
  if (s === "ai_inferred") return "Gemini 推测（无 TMDB 命中）";
  if (s === "unresolved") return "未匹配";
  return s;
}

function isLocked(overrides: UserMetaOverrides | undefined, key: UserMetaOverrideKey) {
  return overrides != null && Object.prototype.hasOwnProperty.call(overrides, key);
}

function sortedSlugKey(slugs: string[]) {
  return [...slugs].sort().join("\0");
}

export function MediaWorkDetailArticle({ workId, item, directors, actors, tagNames, genreOptions }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [titleZh, setTitleZh] = useState(item.titleZh);
  const [titleEn, setTitleEn] = useState(item.titleEn);
  const [yearStr, setYearStr] = useState(item.year != null ? String(item.year) : "");
  const [doubanStr, setDoubanStr] = useState(item.doubanRating != null ? String(item.doubanRating) : "");
  const [tmdbStr, setTmdbStr] = useState(item.tmdbRating != null ? String(item.tmdbRating) : "");
  const [country, setCountry] = useState(item.country ?? "");
  const [summary, setSummary] = useState(item.summary ?? "");
  const [mediaKind, setMediaKind] = useState<"movie" | "tv">(item.mediaType === "tv" ? "tv" : "movie");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [selectedGenreSlugs, setSelectedGenreSlugs] = useState<string[]>(() => [...item.genreTagSlugs]);

  const snapshot = useMemo(
    () => ({
      titleZh: item.titleZh,
      titleEn: item.titleEn,
      mediaType: item.mediaType === "tv" ? ("tv" as const) : ("movie" as const),
      year: item.year,
      doubanRating: item.doubanRating,
      tmdbRating: item.tmdbRating,
      country: item.country,
      summary: item.summary,
    }),
    [item]
  );

  const userOverridesKey = JSON.stringify(item.userMetaOverrides ?? {});

  const resetFormFromItem = useCallback(() => {
    setTitleZh(item.titleZh);
    setTitleEn(item.titleEn);
    setYearStr(item.year != null ? String(item.year) : "");
    setDoubanStr(item.doubanRating != null ? String(item.doubanRating) : "");
    setTmdbStr(item.tmdbRating != null ? String(item.tmdbRating) : "");
    setCountry(item.country ?? "");
    setSummary(item.summary ?? "");
    setMediaKind(item.mediaType === "tv" ? "tv" : "movie");
    setSelectedGenreSlugs([...item.genreTagSlugs]);
  }, [
    item.titleZh,
    item.titleEn,
    item.mediaType,
    item.year,
    item.doubanRating,
    item.tmdbRating,
    item.country,
    item.summary,
    item.genreTagSlugs,
  ]);

  useEffect(() => {
    resetFormFromItem();
  }, [item.id, userOverridesKey, resetFormFromItem]);

  function buildPatch() {
    const patch: UserMetaOverrides = {};
    if (titleZh.trim() !== snapshot.titleZh) patch.titleZh = titleZh.trim();
    if (titleEn.trim() !== snapshot.titleEn) patch.titleEn = titleEn.trim();
    if (mediaKind !== snapshot.mediaType) patch.mediaType = mediaKind;
    const y = yearStr.trim();
    const yearParsed = y === "" ? null : Number(y);
    if (yearParsed !== snapshot.year) patch.year = y === "" ? null : yearParsed;
    const db = doubanStr.trim() === "" ? null : Number(doubanStr);
    if (db !== snapshot.doubanRating) patch.doubanRating = doubanStr.trim() === "" ? null : db;
    const tr = tmdbStr.trim() === "" ? null : Number(tmdbStr);
    if (tr !== snapshot.tmdbRating) patch.tmdbRating = tmdbStr.trim() === "" ? null : tr;
    const co = country.trim();
    if (co !== (snapshot.country ?? "")) patch.country = co === "" ? null : co;
    if (summary !== (snapshot.summary ?? "")) patch.summary = summary === "" ? null : summary;
    return Object.keys(patch).length > 0 ? patch : null;
  }

  async function onSave() {
    setErr(null);
    setOkMsg(null);
    const patch = buildPatch();
    const genreApplies = mediaKind === "movie";
    const genreChanged =
      genreApplies && sortedSlugKey(selectedGenreSlugs) !== sortedSlugKey(item.genreTagSlugs);
    if (!patch && !genreChanged) {
      setErr("没有修改项");
      return;
    }
    setPending(true);
    try {
      const body: Record<string, unknown> = {};
      if (patch) body.meta = patch;
      if (genreChanged) body.genreTagSlugs = [...selectedGenreSlugs];
      const r = await fetch(`/api/media/work/${workId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error || "保存失败");
      setOkMsg("已保存。");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  function onCancel() {
    setErr(null);
    setOkMsg(null);
    resetFormFromItem();
    setEditing(false);
  }

  const lockHint = (key: UserMetaOverrideKey) =>
    isLocked(item.userMetaOverrides, key) ? (
      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-900">已锁定</span>
    ) : null;

  const fieldLabelClass = "font-medium text-slate-900";
  const inputClass =
    "mt-0.5 w-full max-w-md rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300";

  return (
    <>
      <header className="mb-4 border-b border-slate-100 pb-4">
        {!editing ? (
          <>
            <div className="flex flex-wrap items-start gap-3 gap-y-2">
              <h1 className="min-w-0 flex-1 text-xl font-semibold text-slate-900">
                {item.titleZh}
                {item.titleEn ? <span className="ml-2 text-base font-normal text-slate-500">{item.titleEn}</span> : null}
              </h1>
              <div className="shrink-0">
                <MediaWatchResourceStack
                  watchStatus={item.watchStatus ?? "unwatched"}
                  hasIndexedPlayableResource={item.hasIndexedPlayableResource}
                />
              </div>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {item.mediaType === "tv" ? "剧集" : "电影"} · {item.year ?? "年份未知"} · {item.country || "地区未知"}
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-2 gap-y-2">
              <label className="min-w-0 flex-1 basis-[12rem]">
                <span className={`text-xs text-slate-500`}>中文名{lockHint("titleZh")}</span>
                <input className={`${inputClass} text-xl font-semibold`} value={titleZh} onChange={(e) => setTitleZh(e.target.value)} />
              </label>
              <label className="min-w-0 flex-1 basis-[10rem]">
                <span className="text-xs text-slate-500">外文名{lockHint("titleEn")}</span>
                <input className={inputClass} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </label>
              <div className="ml-auto shrink-0">
                <MediaWatchResourceStack
                  watchStatus={item.watchStatus ?? "unwatched"}
                  hasIndexedPlayableResource={item.hasIndexedPlayableResource}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
              <div>
                <span className="text-xs text-slate-500">类型{lockHint("mediaType")}</span>
                <div className="mt-0.5 flex gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setMediaKind("movie")}
                    className={`rounded-md border px-2 py-1 text-xs font-medium ${
                      mediaKind === "movie" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    电影
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setMediaKind("tv")}
                    className={`rounded-md border px-2 py-1 text-xs font-medium ${
                      mediaKind === "tv" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    电视剧
                  </button>
                </div>
              </div>
              <label>
                <span className="text-xs text-slate-500">年份{lockHint("year")}</span>
                <input
                  className={`${inputClass} w-24`}
                  inputMode="numeric"
                  placeholder="—"
                  value={yearStr}
                  onChange={(e) => setYearStr(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </label>
              <label className="min-w-0 flex-1 basis-[10rem]">
                <span className="text-xs text-slate-500">国家/地区{lockHint("country")}</span>
                <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} />
              </label>
            </div>
          </>
        )}
      </header>

      <div className="grid gap-5 md:grid-cols-[220px,1fr]">
        <div className="space-y-4">
          <div>
            {item.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.posterUrl}
                alt={`${item.titleZh} 海报`}
                className="w-full rounded-lg border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                暂无封面
              </div>
            )}
          </div>
          <WatchStatusControl workId={workId} initialStatus={item.watchStatus ?? "unwatched"} />
        </div>

        <div className="space-y-3 text-sm text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            {!editing ? (
              <button
                type="button"
                onClick={() => {
                  setErr(null);
                  setOkMsg(null);
                  resetFormFromItem();
                  setEditing(true);
                }}
                className="ml-auto rounded-md border border-amber-300/90 bg-white px-3 py-1 text-sm font-medium text-amber-800 shadow-sm hover:bg-amber-50"
              >
                信息更新
              </button>
            ) : (
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={onCancel}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onSave}
                  className="rounded-md bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {pending ? "保存中…" : "保存修改"}
                </button>
              </div>
            )}
          </div>

          {!editing ? (
            <>
              <p>
                <span className={fieldLabelClass}>TMDB 评分：</span>
                {score(item.tmdbRating)}
              </p>
              <p>
                <span className={fieldLabelClass}>豆瓣评分：</span>
                {score(item.doubanRating)}
                {(() => {
                  const t = formatRatingCount(item.doubanRatingCount);
                  return t ? <span className="ml-2 text-slate-500">（{t}评价）</span> : null;
                })()}
              </p>
            </>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-2">
                <span className={fieldLabelClass}>TMDB 评分：{lockHint("tmdbRating")}</span>
                <input
                  className={`${inputClass} inline-block max-w-[6rem]`}
                  inputMode="decimal"
                  value={tmdbStr}
                  onChange={(e) => setTmdbStr(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))}
                  placeholder="—"
                />
              </p>
              <p className="flex flex-wrap items-baseline gap-2">
                <span className={fieldLabelClass}>豆瓣评分：{lockHint("doubanRating")}</span>
                <input
                  className={`${inputClass} inline-block max-w-[6rem]`}
                  inputMode="decimal"
                  value={doubanStr}
                  onChange={(e) => setDoubanStr(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))}
                  placeholder="—"
                />
              </p>
            </>
          )}

          <p>
            <span className={fieldLabelClass}>导演：</span>
            {directors.length > 0 ? directors.join("、") : "暂无"}
          </p>
          <p>
            <span className={fieldLabelClass}>主要演员：</span>
            {actors.length > 0 ? actors.join("、") : "暂无"}
          </p>
          {item.mediaType === "movie" || tagNames.length > 0 ? (
            <p>
              <span className={fieldLabelClass}>类型标签：</span>
              {editing && mediaKind === "movie"
                ? selectedGenreSlugs.length === 0
                  ? "未选择"
                  : selectedGenreSlugs
                      .map((s) => genreOptions.find((g) => g.slug === s)?.label ?? s)
                      .join("、")
                : tagNames.length > 0
                  ? tagNames.join("、")
                  : item.mediaType === "movie"
                    ? "暂无（未归入主流类型合集）"
                    : "—"}
            </p>
          ) : null}
          {editing && mediaKind === "movie" && genreOptions.length > 0 ? (
            <div className="rounded-md border border-slate-100 bg-slate-50/80 p-3">
              <p className={fieldLabelClass}>调整类型（多选）</p>
              <p className="mt-0.5 text-xs text-slate-500">从已有类型中选择，保存后与影视资源页各类型合集一致。</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {genreOptions.map((g) => {
                  const on = selectedGenreSlugs.includes(g.slug);
                  return (
                    <button
                      key={g.slug}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setSelectedGenreSlugs((prev) =>
                          on ? prev.filter((s) => s !== g.slug) : [...prev, g.slug]
                        );
                      }}
                      className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        on ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <p>
            <span className={fieldLabelClass}>元数据来源：</span>
            {matchStatusLabel(item.matchStatus)}
          </p>
          <p>
            <span className={fieldLabelClass}>NAS 路径：</span>
            <code className="break-all rounded bg-slate-100 px-1 py-0.5 text-xs">{item.nasLibraryPath}</code>
          </p>

          {!editing ? (
            <div>
              <p className="mb-1 font-medium text-slate-900">剧情简介</p>
              <p className="leading-relaxed text-slate-700">{item.summary || "暂无简介"}</p>
            </div>
          ) : (
            <div>
              <p className="mb-1 font-medium text-slate-900">
                剧情简介{lockHint("summary")}
              </p>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm leading-relaxed text-slate-800 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="暂无简介"
              />
            </div>
          )}

          {editing ? (
            <p className="text-xs text-slate-500">保存的项会写入库与 metadata，并优先于 agent 回填。</p>
          ) : null}
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
          {okMsg && !editing ? <p className="text-xs text-emerald-700">{okMsg}</p> : null}
        </div>
      </div>
    </>
  );
}
