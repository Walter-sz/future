import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionScrollRestore } from "@/components/media/CollectionScrollRestore";
import { MediaWorkList } from "@/components/media/MediaWorkList";
import { RatingBandTabs } from "@/components/media/RatingBandTabs";
import { getCollectionMeta, getWorksByCollection } from "@/lib/media-data";
import {
  computeBandsForWorks,
  filterWorksByBand,
  isValidBandId,
  pickDefaultBand,
  sortWorksForBand,
  type RatingBandId,
} from "@/lib/media-rating-bands";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ rating?: string | string[] }>;
};

export const dynamic = "force-dynamic";

function pickRatingParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return null;
}

export default async function MediaCollectionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const meta = getCollectionMeta(slug);
  if (!meta) notFound();

  const works = await getWorksByCollection(slug);
  const bandList = computeBandsForWorks(works);
  const rawRating = pickRatingParam(sp.rating);
  const selected: RatingBandId | null = isValidBandId(rawRating)
    ? rawRating
    : pickDefaultBand(bandList);
  const visibleWorks = selected
    ? sortWorksForBand(filterWorksByBand(works, bandList, selected), selected)
    : [];

  return (
    <CollectionScrollRestore collectionSlug={slug}>
      <div className="space-y-4">
        <div className="mx-auto max-w-5xl space-y-4">
          <Link href="/movies" className="text-sm text-amber-700 hover:underline">
            ← 返回影视资源
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{meta.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{meta.description}</p>
          </div>
        </div>
        {selected ? (
          <RatingBandTabs
            collectionSlug={slug}
            bands={bandList.bands}
            counts={bandList.counts}
            selected={selected}
          />
        ) : null}
        <MediaWorkList works={visibleWorks} collectionSlug={slug} />
      </div>
    </CollectionScrollRestore>
  );
}
