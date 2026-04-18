import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assertPathUnderAllowedRoots } from "@/lib/study-folder-roots";
import { getPersistenceRoot } from "@/lib/persistence";
import { tryMindMapFileV1FromParsed } from "@/lib/study-mindmap-json-import";
import { parseStudyTabConfig } from "@/lib/study-types";

export const MINDMAP_FORMAT = "mind-elixir-v1" as const;

export type MindMapFileV1 = {
  format: typeof MINDMAP_FORMAT;
  version: 1;
  /** Mind Elixir getData() 结构 */
  data: unknown;
};

/** 文件名非法字符（跨平台保守集） */
const FILENAME_INVALID = /[/\\?%*:|"<>.\x00-\x1f]/g;

export function sanitizeMindmapTitleForFilename(title: string): string {
  const t = (title ?? "")
    .trim()
    .replace(FILENAME_INVALID, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const cut = t.slice(0, 80);
  return cut || "mindmap";
}

/**
 * 新脑图 / XMind / 重命名：由用户输入得到与磁盘 JSON 主名一致（不含 .json）。
 * 形如 `{sanitize(名)}__{tabId}`；若用户已填 `某名__本TabId` 则只清洗「某名」一段。
 */
export function stemForVaultFile(tabId: number, userTitle: string): string {
  const trimmed = (userTitle ?? "").trim();
  if (!trimmed) return sanitizeMindmapTitleForFilename("mindmap") + `__${tabId}`;
  const re = /^(.+)__(\d+)$/;
  const m = trimmed.match(re);
  if (m && Number(m[2]) === tabId) {
    return `${sanitizeMindmapTitleForFilename(m[1])}__${tabId}`;
  }
  const base = sanitizeMindmapTitleForFilename(trimmed);
  return `${base}__${tabId}`;
}

/** vault 内 JSON 相对路径（stem 与 study_tab.title 一致） */
export function vaultRelFromStem(stem: string): string {
  return path.join("study", "mindmaps", `${stem}.json`);
}

/** @deprecated 使用 stemForVaultFile + vaultRelFromStem；仍用于兼容旧路径推断 */
export function mindmapRelPathForTab(tabId: number, title: string): string {
  return vaultRelFromStem(stemForVaultFile(tabId, title));
}

/** 旧版仅按 id 命名，读取时仍兼容 */
export function mindmapLegacyRelPathForTab(tabId: number): string {
  return path.join("study", "mindmaps", `${tabId}.json`);
}

function absFromRel(rel: string): string {
  return path.join(getPersistenceRoot(), rel);
}

export type StudyTabRowLike = {
  id: number;
  title: string;
  tabType: string;
  configJson: string | null;
};

function configRelPath(configJson: string | null): string | undefined {
  const cfg = parseStudyTabConfig(configJson ?? "");
  const r = cfg.mindmapDataRelPath;
  return typeof r === "string" && r.trim() ? r.trim() : undefined;
}

/** 打开本地 JSON 时的绝对路径（不落盘到 study/mindmaps/） */
export function getMindMapExternalAbsolutePath(configJson: string | null): string | null {
  const cfg = parseStudyTabConfig(configJson ?? "");
  const p = cfg.mindmapExternalJsonPath;
  return typeof p === "string" && p.trim() ? path.resolve(p.trim()) : null;
}

/** 解析现有文件路径：配置路径 → 标题命名 → 旧版 id.json（外链打开时不使用） */
export function resolveExistingMindMapRelPath(row: StudyTabRowLike): string | null {
  if (row.tabType !== "mindmap") return null;
  if (getMindMapExternalAbsolutePath(row.configJson)) return null;
  const candidates: string[] = [];
  const fromCfg = configRelPath(row.configJson);
  if (fromCfg) candidates.push(fromCfg.replace(/\//g, path.sep));
  // title 即文件主名（新逻辑）
  candidates.push(vaultRelFromStem(row.title));
  // 旧数据：title 曾为用户输入短名，文件名为 stemForVaultFile(id, title)
  candidates.push(vaultRelFromStem(stemForVaultFile(row.id, row.title)));
  candidates.push(mindmapLegacyRelPathForTab(row.id));

  const seen = new Set<string>();
  for (const rel of candidates) {
    const norm = rel.split(path.sep).join(path.sep);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const abs = absFromRel(norm);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return norm;
    }
  }
  return null;
}

/**
 * vault 内相对路径：title 已为「与文件名一致的主名」且以 __{id} 结尾时用 title；
 * 否则按旧规则用「用户输入短名」推导（兼容旧数据）。
 */
export function canonicalMindMapRelPath(row: StudyTabRowLike): string {
  const trailing = new RegExp(`__${row.id}$`);
  if (row.title && trailing.test(row.title)) {
    return vaultRelFromStem(row.title);
  }
  return vaultRelFromStem(stemForVaultFile(row.id, row.title));
}

export function mindmapAbsolutePathFromRel(rel: string): string {
  return absFromRel(rel);
}

/** 供列表 API 展示：优先已有文件路径，否则为当前标题对应的规范路径 */
export function mindmapStoragePathsForRow(row: StudyTabRowLike): { relPath: string; absolutePath: string } {
  const ext = getMindMapExternalAbsolutePath(row.configJson);
  if (ext) {
    const gn = assertPathUnderAllowedRoots(ext);
    const display = gn.ok ? gn.absolute : ext;
    return {
      relPath: `[打开本地] ${path.basename(display)}`,
      absolutePath: display.split(path.sep).join("/"),
    };
  }
  const existing = resolveExistingMindMapRelPath(row);
  const rel = existing ?? canonicalMindMapRelPath(row);
  const abs = absFromRel(rel);
  return {
    relPath: rel.split(path.sep).join("/"),
    absolutePath: abs.split(path.sep).join("/"),
  };
}

export function readMindMapFile(row: StudyTabRowLike): MindMapFileV1 | null {
  if (row.tabType !== "mindmap") return null;
  const ext = getMindMapExternalAbsolutePath(row.configJson);
  if (ext) {
    const guard = assertPathUnderAllowedRoots(ext);
    if (!guard.ok || !fs.existsSync(guard.absolute)) return null;
    try {
      const raw = fs.readFileSync(guard.absolute, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const file = tryMindMapFileV1FromParsed(parsed);
      if (!file) return null;
      return file as MindMapFileV1;
    } catch {
      return null;
    }
  }
  const rel = resolveExistingMindMapRelPath(row);
  if (!rel) return null;
  const abs = absFromRel(rel);
  try {
    const raw = fs.readFileSync(abs, "utf-8");
    const j = JSON.parse(raw) as MindMapFileV1;
    if (j && j.format === MINDMAP_FORMAT && j.version === 1 && j.data !== undefined) {
      return j;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 若仍存在旧版 `study/mindmaps/{id}.json` 且尚无规范命名文件，则重命名并返回新 configJson。
 */
export function migrateLegacyMindMapFileToCanonical(row: StudyTabRowLike): string | null {
  if (row.tabType !== "mindmap") return null;
  if (getMindMapExternalAbsolutePath(row.configJson)) return null;
  const legacyRel = mindmapLegacyRelPathForTab(row.id);
  const canonRel = canonicalMindMapRelPath(row);
  if (legacyRel === canonRel) return null;
  const legacyAbs = absFromRel(legacyRel);
  const canonAbs = absFromRel(canonRel);
  if (!fs.existsSync(legacyAbs) || !fs.statSync(legacyAbs).isFile()) return null;
  if (fs.existsSync(canonAbs)) return null;
  try {
    fs.mkdirSync(path.dirname(canonAbs), { recursive: true });
    fs.renameSync(legacyAbs, canonAbs);
    return JSON.stringify({
      mindmapDataRelPath: canonRel.split(path.sep).join("/"),
      snapshotFormat: "mind-elixir-v1",
    });
  } catch {
    return null;
  }
}

export function writeMindMapFile(row: StudyTabRowLike, data: unknown): string {
  const ext = getMindMapExternalAbsolutePath(row.configJson);
  const payload: MindMapFileV1 = {
    format: MINDMAP_FORMAT,
    version: 1,
    data,
  };
  if (ext) {
    const guard = assertPathUnderAllowedRoots(ext);
    if (!guard.ok) {
      throw new Error(guard.error);
    }
    fs.mkdirSync(path.dirname(guard.absolute), { recursive: true });
    fs.writeFileSync(guard.absolute, JSON.stringify(payload, null, 2), "utf-8");
    return guard.absolute;
  }
  const rel = canonicalMindMapRelPath(row);
  const p = absFromRel(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf-8");
  return rel;
}

/**
 * Tab 重命名后：若规范路径变化，迁移磁盘文件；返回的 tabTitleStem 与 .json 主名一致。
 */
export function renameMindMapFileIfNeeded(
  before: StudyTabRowLike,
  newTitleRaw: string
): { newRelPath: string; configJson: string; tabTitleStem: string } | null {
  if (before.tabType !== "mindmap") return null;
  if (getMindMapExternalAbsolutePath(before.configJson)) {
    return null;
  }
  const newStem = stemForVaultFile(before.id, newTitleRaw);
  const after: StudyTabRowLike = { ...before, title: newStem };
  const oldRel = resolveExistingMindMapRelPath(before) ?? canonicalMindMapRelPath(before);
  const newRel = canonicalMindMapRelPath(after);
  if (path.normalize(oldRel) === path.normalize(newRel)) {
    return {
      newRelPath: newRel,
      tabTitleStem: newStem,
      configJson: JSON.stringify({
        mindmapDataRelPath: newRel.split(path.sep).join("/"),
        snapshotFormat: "mind-elixir-v1",
      }),
    };
  }
  const oldAbs = absFromRel(oldRel);
  const newAbs = absFromRel(newRel);
  try {
    if (fs.existsSync(oldAbs) && fs.statSync(oldAbs).isFile()) {
      fs.mkdirSync(path.dirname(newAbs), { recursive: true });
      if (fs.existsSync(newAbs) && oldAbs !== newAbs) {
        fs.unlinkSync(newAbs);
      }
      if (oldAbs !== newAbs) {
        fs.renameSync(oldAbs, newAbs);
      }
    }
  } catch {
    /* 仍更新 config */
  }
  return {
    newRelPath: newRel,
    tabTitleStem: newStem,
    configJson: JSON.stringify({
      mindmapDataRelPath: newRel.split(path.sep).join("/"),
      snapshotFormat: "mind-elixir-v1",
    }),
  };
}

/** 与 Mind Elixir v5 `getData()` 兼容的空白图 */
export function createBlankMindElixirData(rootTopic: string): Record<string, unknown> {
  const id = `root-${crypto.randomBytes(8).toString("hex")}`;
  return {
    nodeData: {
      id,
      topic: rootTopic || "新建脑图",
      children: [],
    },
    arrows: [],
    summaries: [],
  };
}
