import Link from "next/link";
import type { MediaCollection } from "@/lib/media-data";

export function MediaCollectionGrid({ collections }: { collections: MediaCollection[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((c) => (
        <li key={c.slug}>
          <Link
            href={`/movies/collection/${c.slug}`}
            scroll={false}
            className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-300/80 hover:shadow-md"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {c.count} 部
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
