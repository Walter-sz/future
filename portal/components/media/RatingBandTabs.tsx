import Link from "next/link";
import type { RatingBand, RatingBandId } from "@/lib/media-rating-bands";

type Props = {
  /** 合集 slug，用于构造 `/movies/collection/<slug>?rating=<id>` */
  collectionSlug: string;
  bands: RatingBand[];
  counts: Record<string, number>;
  selected: RatingBandId;
};

export function RatingBandTabs({ collectionSlug, bands, counts, selected }: Props) {
  if (bands.length <= 1) return null;
  return (
    <nav aria-label="按评分分档" className="mb-1">
      <ul className="flex flex-wrap items-center gap-1.5">
        {bands.map((b) => {
          const active = b.id === selected;
          const count = counts[b.id] ?? 0;
          const href = `/movies/collection/${encodeURIComponent(collectionSlug)}?rating=${b.id}`;
          return (
            <li key={b.id}>
              <Link
                href={href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors " +
                  (active
                    ? "border-amber-500 bg-amber-50 text-amber-900 shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/60")
                }
              >
                <span>{b.label}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[11px] font-medium " +
                    (active ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600")
                  }
                >
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
