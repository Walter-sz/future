import fs from "fs";
import { resolveDoubanCoverFile } from "@/lib/douban-cover-cache";

export async function GET(
  _request: Request,
  context: { params: Promise<{ subjectId: string }> }
) {
  const { subjectId } = await context.params;
  const hit = resolveDoubanCoverFile(subjectId);
  if (!hit) {
    return new Response("Cover not found", { status: 404 });
  }
  const buf = fs.readFileSync(hit.path);
  return new Response(buf, {
    headers: {
      "Content-Type": hit.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
