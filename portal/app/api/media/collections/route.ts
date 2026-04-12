import { getMediaCollectionCounts } from "@/lib/media-data";

export async function GET() {
  const items = await getMediaCollectionCounts();
  return Response.json({ ok: true, items });
}
