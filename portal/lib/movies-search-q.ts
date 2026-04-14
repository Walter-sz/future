/** 影视资源页与作品详情之间传递搜索关键词，便于返回时恢复 ?q= 与结果 */

const Q_KEY = "q";
const MAX_LEN = 600;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0] != null) return v[0];
  return undefined;
}

/** 从详情页 searchParams 解析可用的搜索回跳词 */
export function parseMoviesSearchQ(q: string | string[] | undefined): string | null {
  const raw = firstParam(q)?.trim() ?? "";
  if (!raw || raw.length > MAX_LEN) return null;
  return raw;
}

/** 影视首页带搜索（无词则裸 /movies） */
export function moviesHomeHrefWithSearchQ(searchQ: string | null): string {
  const t = searchQ?.trim() ?? "";
  if (!t) return "/movies";
  return `/movies?${new URLSearchParams({ [Q_KEY]: t }).toString()}`;
}

/** 作品详情链接；带上当前搜索词以便返回链保留 q */
export function moviesWorkDetailHref(workId: number, searchQ: string | null): string {
  const base = `/movies/work/${workId}`;
  const t = searchQ?.trim() ?? "";
  if (!t || t.length > MAX_LEN) return base;
  return `${base}?${new URLSearchParams({ [Q_KEY]: t }).toString()}`;
}
