import fs from "fs";
import path from "path";
import { getPersistenceRoot } from "@/lib/persistence";

const SAFE_NAME = /^[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif)$/i;

export function isSafeImageFilename(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

/** `walter_data/images` 下可供展示的对照表图片（仅一层文件名） */
export function listReferenceImages(): string[] {
  const dir = path.join(getPersistenceRoot(), "images");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isSafeImageFilename(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function resolveReferenceImagePath(name: string): string | null {
  if (!isSafeImageFilename(name)) return null;
  const full = path.join(getPersistenceRoot(), "images", name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}
