import { MediaCollectionGrid } from "@/components/media/MediaCollectionGrid";
import { MediaSearchPanel } from "@/components/media/MediaSearchPanel";
import { getMediaCollectionCounts } from "@/lib/media-data";

export const dynamic = "force-dynamic";

export default async function MoviesPage() {
  const collections = await getMediaCollectionCounts();

  return (
    <div className="space-y-10">
      <section aria-labelledby="media-collections-title">
        <h1 id="media-collections-title" className="mb-2 text-xl font-semibold text-slate-900">
          影视资源合集
        </h1>
        <p className="mb-5 text-sm text-slate-600">
          先按合集浏览，再进入作品详情查看元数据。首版仅提供元数据展示与搜索，不提供播放能力。
        </p>
        <MediaCollectionGrid collections={collections} />
      </section>
      <section className="border-t border-amber-200/60 pt-10">
        <MediaSearchPanel />
      </section>
    </div>
  );
}
