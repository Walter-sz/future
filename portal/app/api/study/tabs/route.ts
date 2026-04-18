import fs from "fs";
import path from "path";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { studyTab } from "@/lib/db/schema";
import {
  createBlankMindElixirData,
  mindmapStoragePathsForRow,
  stemForVaultFile,
  writeMindMapFile,
} from "@/lib/study-mindmap-storage";
import { tryMindMapFileV1FromParsed } from "@/lib/study-mindmap-json-import";
import { resolveAllowedFolderPath, resolveAllowedJsonMindmapFilePath } from "@/lib/study-folder-roots";
import type { StudyTabRow, StudyTabType } from "@/lib/study-types";

function rowToJson(r: typeof studyTab.$inferSelect): StudyTabRow {
  const base: StudyTabRow = {
    id: r.id,
    title: r.title,
    tabType: r.tabType as StudyTabType,
    sortOrder: r.sortOrder,
    configJson: r.configJson,
    createdAt: (r.createdAt as Date).getTime(),
    updatedAt: (r.updatedAt as Date).getTime(),
  };
  if (r.tabType === "mindmap") {
    return {
      ...base,
      mindmapStorage: mindmapStoragePathsForRow({
        id: r.id,
        title: r.title,
        tabType: r.tabType,
        configJson: r.configJson,
      }),
    };
  }
  return base;
}

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(studyTab).orderBy(asc(studyTab.sortOrder), asc(studyTab.id));
  return Response.json({ ok: true, tabs: rows.map(rowToJson) });
}

type PostBody = {
  title?: string;
  tabType?: string;
  /** mindmap: blank | xmind_import | json_open */
  mindmapMode?: "blank" | "xmind_import" | "json_open";
  /** xmind_import：客户端解析后的 Mind Elixir 数据（与 getData() 一致） */
  mindMapData?: unknown;
  /** json_open：服务端可读的已有 .json 绝对路径，打开后不复制到 walter_data */
  mindMapJsonPath?: string;
  /** folder */
  folderPath?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PostBody;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const tabType = body.tabType as string | undefined;
  const rawMode = body.mindmapMode;
  const hasJsonOpen = rawMode === "json_open";
  if (tabType !== "mindmap" && tabType !== "folder") {
    return Response.json({ ok: false, error: "tabType 须为 mindmap 或 folder" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();
  const maxRow = await db.select({ m: studyTab.sortOrder }).from(studyTab).orderBy(desc(studyTab.sortOrder)).limit(1);
  const nextOrder = (maxRow[0]?.m ?? 0) + 1;

  if (tabType === "folder") {
    const folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
    const v = resolveAllowedFolderPath(folderPath);
    if (!v.ok) {
      return Response.json({ ok: false, error: v.error }, { status: 400 });
    }
    const trimmedAbs = v.absolute.replace(/[/\\]+$/, "");
    const titleFromFolder =
      title || path.basename(trimmedAbs || v.absolute) || "文件夹";
    const configJson = JSON.stringify({ serverPath: v.absolute });
    const [inserted] = await db
      .insert(studyTab)
      .values({
        title: titleFromFolder,
        tabType: "folder",
        sortOrder: nextOrder,
        configJson,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) return Response.json({ ok: false, error: "插入失败" }, { status: 500 });
    return Response.json({ ok: true, tab: rowToJson(inserted) });
  }

  if (!title && !hasJsonOpen) {
    return Response.json({ ok: false, error: "缺少 title" }, { status: 400 });
  }

  // mindmap
  const mode = rawMode === "xmind_import" || rawMode === "json_open" ? rawMode : "blank";

  if (mode === "json_open") {
    const p = typeof body.mindMapJsonPath === "string" ? body.mindMapJsonPath.trim() : "";
    if (!p) {
      return Response.json({ ok: false, error: "请提供 mindMapJsonPath（已有脑图 JSON 绝对路径）" }, { status: 400 });
    }
    const v = resolveAllowedJsonMindmapFilePath(p);
    if (!v.ok) {
      return Response.json({ ok: false, error: v.error }, { status: 400 });
    }
    let raw: string;
    try {
      raw = fs.readFileSync(v.absolute, "utf-8");
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 400 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return Response.json({ ok: false, error: "JSON 解析失败" }, { status: 400 });
    }
    if (!tryMindMapFileV1FromParsed(parsed)) {
      return Response.json({ ok: false, error: "不是有效的 Mind Elixir / mind-elixir-v1 脑图 JSON" }, { status: 400 });
    }
    const base = path.basename(v.absolute);
    const titleFromFile = base.replace(/\.json$/i, "").trim() || "脑图";
    const configJson = JSON.stringify({
      mindmapExternalJsonPath: v.absolute,
      snapshotFormat: "mind-elixir-v1",
    });
    const [inserted] = await db
      .insert(studyTab)
      .values({
        title: titleFromFile,
        tabType: "mindmap",
        sortOrder: nextOrder,
        configJson,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) return Response.json({ ok: false, error: "插入失败" }, { status: 500 });
    return Response.json({ ok: true, tab: rowToJson(inserted) });
  }

  if (mode === "xmind_import" && body.mindMapData === undefined) {
    return Response.json({ ok: false, error: "XMind 导入需提供 mindMapData" }, { status: 400 });
  }

  const t = title.trim() || "未命名脑图";

  const [inserted] = await db
    .insert(studyTab)
    .values({
      title: t,
      tabType: "mindmap",
      sortOrder: nextOrder,
      configJson: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!inserted) return Response.json({ ok: false, error: "插入失败" }, { status: 500 });

  const tabId = inserted.id;
  const stem = stemForVaultFile(tabId, t);
  const data =
    mode === "xmind_import" && body.mindMapData !== undefined
      ? body.mindMapData
      : createBlankMindElixirData(t);

  const rel = writeMindMapFile({ id: tabId, title: stem, tabType: "mindmap", configJson: inserted.configJson }, data);
  const configJson = JSON.stringify({
    mindmapDataRelPath: rel.split(path.sep).join("/"),
    snapshotFormat: "mind-elixir-v1",
  });

  const [updated] = await db
    .update(studyTab)
    .set({ title: stem, configJson, updatedAt: new Date() })
    .where(eq(studyTab.id, tabId))
    .returning();

  return Response.json({ ok: true, tab: rowToJson(updated ?? inserted) });
}
