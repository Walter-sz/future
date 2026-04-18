import { resolveAllowedFolderPath } from "@/lib/study-folder-roots";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { path?: string };
  const p = typeof body.path === "string" ? body.path.trim() : "";
  const v = resolveAllowedFolderPath(p);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.error }, { status: 400 });
  }
  return Response.json({ ok: true, absolutePath: v.absolute });
}
