import fs from "fs";
import path from "path";
import { assertPathUnderAllowedRoots } from "@/lib/study-folder-roots";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? "";
  const v = assertPathUnderAllowedRoots(raw);
  if (!v.ok) {
    return Response.json({ ok: false, error: v.error }, { status: 400 });
  }
  const dir = v.absolute;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return Response.json({ ok: false, error: "不是目录" }, { status: 400 });
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }

  const max = 500;
  const list = entries
    .slice(0, max)
    .map((d) => ({
      name: d.name,
      path: path.join(dir, d.name),
      isDirectory: d.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });

  return Response.json({ ok: true, path: dir, entries: list, truncated: entries.length > max });
}
