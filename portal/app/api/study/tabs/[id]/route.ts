import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { studyTab } from "@/lib/db/schema";
import { getMindMapExternalAbsolutePath, renameMindMapFileIfNeeded } from "@/lib/study-mindmap-storage";
import { resolveAllowedFolderPath } from "@/lib/study-folder-roots";
import { isPinnedTab } from "@/lib/study-types";
import type { StudyTabRow } from "@/lib/study-types";

function rowToJson(r: typeof studyTab.$inferSelect): StudyTabRow {
  return {
    id: r.id,
    title: r.title,
    tabType: r.tabType as StudyTabRow["tabType"],
    sortOrder: r.sortOrder,
    configJson: r.configJson,
    createdAt: (r.createdAt as Date).getTime(),
    updatedAt: (r.updatedAt as Date).getTime(),
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    sortOrder?: number;
    configJson?: string;
    folderPath?: string;
  };

  const db = getDb();
  const existing = await db.select().from(studyTab).where(eq(studyTab.id, numeric)).limit(1);
  const row = existing[0];
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const updates: Partial<typeof studyTab.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof body.title === "string" && body.title.trim()) {
    const nt = body.title.trim();
    if (row.tabType === "mindmap") {
      if (getMindMapExternalAbsolutePath(row.configJson)) {
        updates.title = nt;
      } else {
        const r = renameMindMapFileIfNeeded(
          { id: row.id, title: row.title, tabType: "mindmap", configJson: row.configJson },
          nt
        );
        if (r) {
          updates.title = r.tabTitleStem;
          updates.configJson = r.configJson;
        }
      }
    } else if (isPinnedTab(row.tabType)) {
      updates.title = nt;
    } else {
      updates.title = nt;
    }
  }

  if (body.sortOrder !== undefined && Number.isInteger(body.sortOrder)) {
    updates.sortOrder = body.sortOrder;
  }

  if (typeof body.configJson === "string") {
    try {
      JSON.parse(body.configJson);
      updates.configJson = body.configJson;
    } catch {
      return Response.json({ ok: false, error: "configJson 不是合法 JSON" }, { status: 400 });
    }
  }

  if (row.tabType === "folder" && typeof body.folderPath === "string") {
    const v = resolveAllowedFolderPath(body.folderPath.trim());
    if (!v.ok) {
      return Response.json({ ok: false, error: v.error }, { status: 400 });
    }
    updates.configJson = JSON.stringify({ serverPath: v.absolute });
  }

  const [updated] = await db.update(studyTab).set(updates).where(eq(studyTab.id, numeric)).returning();
  if (!updated) return Response.json({ ok: false, error: "update failed" }, { status: 500 });
  return Response.json({ ok: true, tab: rowToJson(updated) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.select().from(studyTab).where(eq(studyTab.id, numeric)).limit(1);
  const row = existing[0];
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (isPinnedTab(row.tabType)) {
    return Response.json({ ok: false, error: "固定 Tab 不可删除" }, { status: 403 });
  }

  await db.delete(studyTab).where(eq(studyTab.id, numeric));
  return Response.json({ ok: true });
}
