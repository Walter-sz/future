import fs from "fs";
import path from "path";

/**
 * 与 CrawlerAgent 落盘封面一致（默认 monorepo：`future/crawler-agent/data/covers`）。
 * 设置后可让 `/api/media/douban-cover/[subjectId]` 读到本机文件，避免豆瓣防盗链导致网页海报空白。
 */
export function getDoubanCoverCacheDir(): string {
  const raw = process.env.DOUBAN_COVER_CACHE_DIR;
  if (raw) {
    return path.resolve(raw);
  }
  return path.resolve(process.cwd(), "..", "crawler-agent", "data", "covers");
}

const SUBJECT_ID = /^\d{5,12}$/;

export function resolveDoubanCoverFile(subjectId: string): { path: string; contentType: string } | null {
  if (!SUBJECT_ID.test(subjectId)) {
    return null;
  }
  const dir = getDoubanCoverCacheDir();
  const order = [".webp", ".jpg", ".jpeg", ".png"] as const;
  for (const ext of order) {
    const fp = path.join(dir, `${subjectId}${ext}`);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ct =
        ext === ".webp"
          ? "image/webp"
          : ext === ".png"
            ? "image/png"
            : "image/jpeg";
      return { path: fp, contentType: ct };
    }
  }
  return null;
}
