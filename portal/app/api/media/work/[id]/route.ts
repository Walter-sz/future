import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { mediaWork } from "@/lib/db/schema";
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

type PatchBody = { watchStatus?: string };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const ws = body.watchStatus;
  if (ws !== "watched" && ws !== "unwatched") {
    return Response.json({ ok: false, error: "watchStatus 须为 watched 或 unwatched" }, { status: 400 });
  }
  const db = getDb();
  const now = new Date();
  const watchedAt = ws === "watched" ? now : null;
  await db.update(mediaWork).set({ watchStatus: ws, watchedAt, updatedAt: now }).where(eq(mediaWork.id, numeric));
  const item = await getMediaWorkById(numeric);
  if (!item) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({ ok: true, item });
}
