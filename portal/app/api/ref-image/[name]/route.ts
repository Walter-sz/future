import fs from "fs";
import { resolveReferenceImagePath } from "@/lib/reference-images";

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> }
) {
  const { name: raw } = await context.params;
  const name = decodeURIComponent(raw);
  const filePath = resolveReferenceImagePath(name);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }
  const buf = fs.readFileSync(filePath);
  return new Response(buf, {
    headers: {
      "Content-Type": contentTypeFor(name),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
