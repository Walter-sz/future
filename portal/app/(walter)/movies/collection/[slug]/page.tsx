import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaWorkList } from "@/components/media/MediaWorkList";
import { getCollectionMeta, getWorksByCollection } from "@/lib/media-data";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export default async function MediaCollectionPage({ params }: Props) {
  const { slug } = await params;
  const meta = getCollectionMeta(slug);
  if (!meta) notFound();
  const works = await getWorksByCollection(slug);

  return (
    <div className="space-y-4">
      <Link href="/movies" scroll={false} className="text-sm text-amber-700 hover:underline">
        ← 返回影视资源
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{meta.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{meta.description}</p>
      </div>
      <MediaWorkList works={works} />
    </div>
  );
}
