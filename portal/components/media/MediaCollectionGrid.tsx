import Link from "next/link";
import type { MediaCollection } from "@/lib/media-data";
import { MEDIA_TV_COLLECTION_SLUGS } from "@/lib/media-data";

const tvSlugSet = new Set<string>(MEDIA_TV_COLLECTION_SLUGS);

function partitionCollections(collections: MediaCollection[]) {
  const movies: MediaCollection[] = [];
  const tv: MediaCollection[] = [];
  for (const c of collections) {
    if (tvSlugSet.has(c.slug)) tv.push(c);
    else movies.push(c);
  }
  return { movies, tv };
}

function CollectionCardList({ collections }: { collections: MediaCollection[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((c) => (
        <li key={c.slug}>
          <Link
            href={`/movies/collection/${c.slug}`}
            className="flex h-full flex-col rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-amber-300/80 hover:shadow-md"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {c.count} 条
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{c.description}</p>
            <span className="mt-4 text-sm font-medium text-amber-700">查看合集 →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const sectionShell =
  "rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/90 via-white to-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100 sm:p-6";

export function MediaCollectionGrid({ collections }: { collections: MediaCollection[] }) {
  const { movies, tv } = partitionCollections(collections);

  return (
    <div className="space-y-8">
      {movies.length > 0 ? (
        <div className={sectionShell}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/80 pb-3">
            <h3 className="text-lg font-semibold text-slate-800">电影</h3>
            <p className="text-xs text-slate-500">按类型与「其他电影」浏览</p>
          </div>
          <CollectionCardList collections={movies} />
        </div>
      ) : null}

      {tv.length > 0 ? (
        <div className={sectionShell}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/80 pb-3">
            <h3 className="text-lg font-semibold text-slate-800">电视剧</h3>
            <p className="text-xs text-slate-500">美/英/加/澳/日韩中等产地合集；合拍可出现在多个国家下</p>
          </div>
          <CollectionCardList collections={tv} />
        </div>
      ) : null}
    </div>
  );
}
