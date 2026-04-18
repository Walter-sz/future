import { execFile } from "child_process";
import { promisify } from "util";
import { resolveAllowedJsonMindmapFilePath } from "@/lib/study-folder-roots";

const execFileAsync = promisify(execFile);

function isPickerEnabled(): boolean {
  return process.platform === "darwin" && process.env.STUDY_DISABLE_FOLDER_PICKER !== "1";
}

export async function GET() {
  return Response.json({ supported: isPickerEnabled() });
}

export async function POST() {
  if (!isPickerEnabled()) {
    return Response.json(
      {
        ok: false,
        error:
          process.platform !== "darwin"
            ? "当前 Portal 未在 macOS 本机运行，无法使用访达选择 JSON 文件，请手动填写绝对路径"
            : "已禁用访达选择（STUDY_DISABLE_FOLDER_PICKER）",
      },
      { status: 501 }
    );
  }

  try {
    const script = 'POSIX path of (choose file with prompt "请选择脑图 JSON 文件")';
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      maxBuffer: 1024 * 1024,
      timeout: 300_000,
    });
    const raw = stdout.trim().replace(/\r?\n$/, "");
    if (!raw) {
      return Response.json({ ok: false, error: "未获得路径" }, { status: 400 });
    }
    const v = resolveAllowedJsonMindmapFilePath(raw);
    if (!v.ok) {
      return Response.json({ ok: false, error: v.error }, { status: 400 });
    }
    return Response.json({ ok: true, path: v.absolute });
  } catch (e: unknown) {
    const err = e as Error & { stderr?: string };
    const combined = `${err.message}\n${err.stderr ?? ""}`;
    if (/user canceled|-128/i.test(combined)) {
      return Response.json({ ok: false, error: "已取消选择" }, { status: 400 });
    }
    return Response.json({ ok: false, error: combined.trim() || "选择失败" }, { status: 500 });
  }
}
