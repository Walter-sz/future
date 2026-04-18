import fs from "fs";
import os from "os";
import path from "path";

/**
 * 服务端可访问的「知识库根」白名单，逗号分隔绝对路径。
 * 例：STUDY_ALLOWED_ROOTS=/volume1/vault,/Users/me/Obsidian
 *
 * 未设置 STUDY_ALLOWED_ROOTS 时，默认使用当前进程用户主目录（本机访达所选文件夹多在其下）。
 * 公网/多用户部署请显式设置白名单，或设 STUDY_NO_DEFAULT_HOME=1 关闭文件夹 Tab（需自行配置根目录）。
 */
export function getStudyAllowedRoots(): string[] {
  const raw = (process.env.STUDY_ALLOWED_ROOTS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p));
  }
  if (process.env.STUDY_NO_DEFAULT_HOME === "1" || process.env.STUDY_NO_DEFAULT_HOME === "true") {
    return [];
  }
  const h = os.homedir();
  return h ? [path.resolve(h)] : [];
}

/**
 * 规范化并校验 path 落在某一允许根之下（防穿越）。
 */
export function resolveAllowedFolderPath(input: string): { ok: true; absolute: string } | { ok: false; error: string } {
  const roots = getStudyAllowedRoots();
  if (roots.length === 0) {
    return {
      ok: false,
      error:
        "未配置可访问目录：请设置环境变量 STUDY_ALLOWED_ROOTS（逗号分隔绝对路径），或勿设置 STUDY_NO_DEFAULT_HOME=1（默认使用用户主目录）",
    };
  }
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "路径为空" };
  }
  let abs: string;
  try {
    abs = path.resolve(trimmed);
  } catch {
    return { ok: false, error: "路径无效" };
  }
  const normalized = path.normalize(abs);
  for (const root of roots) {
    const nr = path.normalize(root);
    if (normalized === nr || normalized.startsWith(nr + path.sep)) {
      if (!fs.existsSync(normalized)) {
        return { ok: false, error: "路径不存在" };
      }
      const st = fs.statSync(normalized);
      if (!st.isDirectory()) {
        return { ok: false, error: "不是目录" };
      }
      return { ok: true, absolute: normalized };
    }
  }
  return { ok: false, error: "路径不在 STUDY_ALLOWED_ROOTS 白名单内" };
}

/**
 * 打开已有脑图 JSON：须为白名单内的现有 .json 文件。
 */
export function resolveAllowedJsonMindmapFilePath(
  input: string
): { ok: true; absolute: string } | { ok: false; error: string } {
  const roots = getStudyAllowedRoots();
  if (roots.length === 0) {
    return {
      ok: false,
      error:
        "未配置可访问目录：请设置环境变量 STUDY_ALLOWED_ROOTS（逗号分隔绝对路径），或勿设置 STUDY_NO_DEFAULT_HOME=1（默认使用用户主目录）",
    };
  }
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "路径为空" };
  }
  let abs: string;
  try {
    abs = path.resolve(trimmed);
  } catch {
    return { ok: false, error: "路径无效" };
  }
  const normalized = path.normalize(abs);
  if (!normalized.toLowerCase().endsWith(".json")) {
    return { ok: false, error: "须为 .json 文件路径" };
  }
  let under = false;
  for (const root of roots) {
    const nr = path.normalize(root);
    if (normalized === nr || normalized.startsWith(nr + path.sep)) {
      under = true;
      break;
    }
  }
  if (!under) {
    return { ok: false, error: "路径不在 STUDY_ALLOWED_ROOTS 白名单内" };
  }
  if (!fs.existsSync(normalized)) {
    return { ok: false, error: "文件不存在" };
  }
  const st = fs.statSync(normalized);
  if (!st.isFile()) {
    return { ok: false, error: "不是文件" };
  }
  return { ok: true, absolute: normalized };
}

/**
 * 校验 browse/file 请求中的路径（须已规范化且在白名单内）。
 */
export function assertPathUnderAllowedRoots(requestPath: string): { ok: true; absolute: string } | { ok: false; error: string } {
  const roots = getStudyAllowedRoots();
  if (roots.length === 0) {
    return { ok: false, error: "未配置可访问目录（STUDY_ALLOWED_ROOTS 或默认主目录）" };
  }
  let abs: string;
  try {
    abs = path.resolve(requestPath);
  } catch {
    return { ok: false, error: "路径无效" };
  }
  const normalized = path.normalize(abs);
  for (const root of roots) {
    const nr = path.normalize(root);
    if (normalized === nr || normalized.startsWith(nr + path.sep)) {
      return { ok: true, absolute: normalized };
    }
  }
  return { ok: false, error: "禁止访问该路径" };
}
