import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { mediaWork } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Props = { params: Promise<{ id: string }> };

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

export default async function MediaWorkDetailPage({ params }: Props) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) notFound();

  const db = getDb();
  const rows = await db.select().from(mediaWork).where(eq(mediaWork.id, numeric)).limit(1);
  const work = rows[0];
  if (!work) notFound();

  const directors = parseJsonArray(work.directorsJson);
  const actors = parseJsonArray(work.actorsJson);

  return (
    <div className="space-y-4">
      <Link href="/movies" scroll={false} className="text-sm text-amber-700 hover:underline">
        ← 返回影视资源
      </Link>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-4 border-b border-slate-100 pb-4">
          <h1 className="text-xl font-semibold text-slate-900">
            {work.titleZh}
            {work.titleEn ? <span className="ml-2 text-base font-normal text-slate-500">{work.titleEn}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {work.mediaType === "tv" ? "剧集" : "电影"} · {work.year ?? "年份未知"} · {work.country || "地区未知"}
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-[220px,1fr]">
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
            <p>
              <span className="font-medium text-slate-900">匹配状态：</span>
              {work.matchStatus}
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
