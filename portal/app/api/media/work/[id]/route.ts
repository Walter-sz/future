import { getMediaWorkById } from "@/lib/media-data";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const item = await getMediaWorkById(numeric);
  if (!item) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, item });
}
