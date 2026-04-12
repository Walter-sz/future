import { searchMediaWorks } from "@/lib/media-data";

type Req = { query?: string };

function scoreItem(item: {
  titleZh: string;
  titleEn: string;
  summary: string | null;
  tags: string[];
  country: string | null;
  language: string | null;
}, query: string) {
  let score = 0;
  if (item.titleZh.includes(query) || item.titleEn.toLowerCase().includes(query.toLowerCase())) score += 12;
  if ((item.summary || "").includes(query)) score += 5;
  if (item.tags.some((x) => x.includes(query))) score += 4;
  if ((item.country || "").includes(query) || (item.language || "").includes(query)) score += 2;
  return score;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Req;
  const query = (body.query || "").trim();
  if (!query) {
    return Response.json({ ok: true, query, items: [] });
  }
  const items = await searchMediaWorks(query, 60);
  const sorted = items
    .map((x) => ({ ...x, _score: scoreItem(x, query) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 20)
    .map((item) => {
      const rest = { ...item };
      delete (rest as { _score?: number })._score;
      return rest;
    });
  return Response.json({ ok: true, query, items: sorted });
}
