import path from "path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { studyTab } from "@/lib/db/schema";
import {
  getMindMapExternalAbsolutePath,
  migrateLegacyMindMapFileToCanonical,
  readMindMapFile,
  writeMindMapFile,
  type MindMapFileV1,
} from "@/lib/study-mindmap-storage";

function rowLike(r: typeof studyTab.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    tabType: r.tabType,
    configJson: r.configJson,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db.select().from(studyTab).where(eq(studyTab.id, numeric)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (row.tabType !== "mindmap") {
    return Response.json({ ok: false, error: "not a mindmap tab" }, { status: 400 });
  }

  let rl = rowLike(row);
  const migrated = getMindMapExternalAbsolutePath(row.configJson) ? null : migrateLegacyMindMapFileToCanonical(rl);
  if (migrated) {
    await db
      .update(studyTab)
      .set({ configJson: migrated, updatedAt: new Date() })
      .where(eq(studyTab.id, numeric));
    rl = { ...rl, configJson: migrated };
  }

  const file = readMindMapFile(rl);
  if (!file) {
    return Response.json({ ok: false, error: "mindmap file missing" }, { status: 404 });
  }
  return Response.json({ ok: true, file });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { data?: unknown };
  if (body.data === undefined) {
    return Response.json({ ok: false, error: "缺少 data" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db.select().from(studyTab).where(eq(studyTab.id, numeric)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (row.tabType !== "mindmap") {
    return Response.json({ ok: false, error: "not a mindmap tab" }, { status: 400 });
  }

  const rl = rowLike(row);
  let nextConfigJson = row.configJson;
  try {
    const rel = writeMindMapFile(rl, body.data);
    if (!getMindMapExternalAbsolutePath(row.configJson)) {
      nextConfigJson = JSON.stringify({
        mindmapDataRelPath: rel.split(path.sep).join("/"),
        snapshotFormat: "mind-elixir-v1",
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }

  const file: MindMapFileV1 = {
    format: "mind-elixir-v1",
    version: 1,
    data: body.data,
  };

  await db.update(studyTab).set({ configJson: nextConfigJson, updatedAt: new Date() }).where(eq(studyTab.id, numeric));

  return Response.json({ ok: true, file });
}
