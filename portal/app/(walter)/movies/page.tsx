import { Suspense } from "react";
import { MediaCollectionGrid } from "@/components/media/MediaCollectionGrid";
import { MediaLibraryStatsCharts } from "@/components/media/MediaLibraryStatsCharts";
import { MediaSearchPanel } from "@/components/media/MediaSearchPanel";
import { getMediaCollectionCounts } from "@/lib/media-data";
import { getMediaLibraryDashboardStats } from "@/lib/media-stats";

export const dynamic = "force-dynamic";

export default async function MoviesPage() {
  const [collections, dashboardStats] = await Promise.all([getMediaCollectionCounts(), getMediaLibraryDashboardStats()]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="media-search-title">
        <Suspense
          fallback={
            <div
              className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm"
              aria-busy="true"
              aria-label="加载搜索"
            >
              <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
              <div className="mt-4 h-10 w-full max-w-xl animate-pulse rounded-lg bg-slate-200" />
            </div>
          }
        >
          <MediaSearchPanel />
        </Suspense>
      </section>
      <section aria-labelledby="media-library-stats-title" className="space-y-3">
        <div>
          <h1 id="media-library-stats-title" className="text-xl font-semibold text-slate-900">
            资源库概览
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            仅统计资源库索引路径内的作品。月度图「已看」为当月标记为已看的部数；「未看」为当前库内未看总部数参考线，不代表历史每月未看。
          </p>
        </div>
        <MediaLibraryStatsCharts stats={dashboardStats} />
      </section>
      <section aria-labelledby="media-collections-title">
        <h2 id="media-collections-title" className="mb-2 text-xl font-semibold text-slate-900">
          影视资源合集
        </h2>
        <p className="mb-5 text-sm text-slate-600">
          先按合集浏览，再进入作品详情查看元数据。首版仅提供元数据展示与搜索，不提供播放能力。
        </p>
        <MediaCollectionGrid collections={collections} />
      </section>
    </div>
  );
}
