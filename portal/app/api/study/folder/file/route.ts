import fs from "fs";
import path from "path";
import { assertPathUnderAllowedRoots } from "@/lib/study-folder-roots";

const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".html",
  ".htm",
  ".xml",
  ".css",
  ".js",
  ".ts",
  ".tsx",
]);

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXT.has(ext);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? "";
  const v = assertPathUnderAllowedRoots(raw);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.error }, { status: 400 });
  }
  const fp = v.absolute;
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    return Response.json({ ok: false, error: "不是文件" }, { status: 400 });
  }
  if (!isProbablyTextFile(fp)) {
    return Response.json({ ok: false, error: "当前仅支持文本类扩展名" }, { status: 400 });
  }
  try {
    const content = fs.readFileSync(fp, "utf-8");
    return Response.json({ ok: true, path: fp, content });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? "";
  const v = assertPathUnderAllowedRoots(raw);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.error }, { status: 400 });
  }
  const fp = v.absolute;
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    return Response.json({ ok: false, error: "不是文件" }, { status: 400 });
  }
  if (!isProbablyTextFile(fp)) {
    return Response.json({ ok: false, error: "当前仅支持文本类扩展名" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  if (typeof body.content !== "string") {
    return Response.json({ ok: false, error: "缺少 content 字符串" }, { status: 400 });
  }
  try {
    fs.writeFileSync(fp, body.content, "utf-8");
    return Response.json({ ok: true, path: fp });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
