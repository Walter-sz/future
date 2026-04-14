import fs from "fs";
import path from "path";
import { getPersistenceRoot } from "@/lib/persistence";

/** 与 agent ResolvedMeta / metadata JSON 对齐的 camelCase 键 */
export const USER_META_OVERRIDE_KEYS = [
  "titleZh",
  "titleEn",
  "mediaType",
  "year",
  "doubanRating",
  "tmdbRating",
  "country",
  "summary",
] as const;

export type UserMetaOverrideKey = (typeof USER_META_OVERRIDE_KEYS)[number];

export type UserMetaOverrides = Partial<Record<UserMetaOverrideKey, string | number | null>>;

export function parseUserMetaOverridesJson(raw: string | null | undefined): UserMetaOverrides {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return {};
    const out: UserMetaOverrides = {};
    for (const k of USER_META_OVERRIDE_KEYS) {
      if (!(k in o)) continue;
      const v = o[k];
      if (k === "mediaType") {
        if (v === "movie" || v === "tv") out.mediaType = v;
        continue;
      }
      if (k === "year") {
        if (v === null) out.year = null;
        else if (typeof v === "number" && Number.isFinite(v)) out.year = Math.round(v);
        else if (typeof v === "string" && /^\d{4}$/.test(v.trim())) out.year = Number(v.trim());
      } else if (k === "doubanRating" || k === "tmdbRating") {
        if (v === null) out[k] = null;
        else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      } else {
        if (v === null) out[k] = null;
        else if (typeof v === "string") out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function mergeUserMetaOverridesJson(
  existingJson: string | null | undefined,
  patch: UserMetaOverrides
): string {
  const cur = parseUserMetaOverridesJson(existingJson);
  const next = { ...cur, ...patch };
  return JSON.stringify(next);
}

export function uniqueJoinTitle(zh: string, en: string) {
  const a = zh.trim();
  const b = en.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase() === b.toLowerCase()) return a;
  return `${a} ${b}`.trim();
}

export function buildMediaSearchText(parts: {
  titleZh: string;
  titleEn: string;
  summary: string | null;
  directorsJson: string;
  actorsJson: string;
  tagsJoined: string;
  country: string | null;
}): string {
  let directors = "";
  let actors = "";
  try {
    const d = JSON.parse(parts.directorsJson || "[]");
    if (Array.isArray(d)) directors = d.map((x) => String(x)).join(" ");
  } catch {
    /* ignore */
  }
  try {
    const a = JSON.parse(parts.actorsJson || "[]");
    if (Array.isArray(a)) actors = a.map((x) => String(x)).join(" ");
  } catch {
    /* ignore */
  }
  return [parts.titleZh, parts.titleEn, parts.summary || "", directors, actors, parts.tagsJoined, parts.country || ""]
    .join(" ")
    .trim();
}

export function resolveMetadataAbsolutePath(metadataPath: string | null | undefined): string | null {
  if (!metadataPath?.trim()) return null;
  const p = metadataPath.trim();
  if (path.isAbsolute(p) && fs.existsSync(p)) return p;
  const root = getPersistenceRoot();
  const joined = path.isAbsolute(p) ? p : path.join(root, p.replace(/^\/*/, ""));
  return fs.existsSync(joined) ? joined : null;
}

export function validateMetaPatch(patch: UserMetaOverrides): { ok: true } | { ok: false; error: string } {
  if (patch.titleZh !== undefined) {
    const s = typeof patch.titleZh === "string" ? patch.titleZh.trim() : "";
    if (!s) return { ok: false, error: "titleZh 不能为空" };
    if (s.length > 500) return { ok: false, error: "titleZh 过长" };
  }
  if (patch.titleEn !== undefined && patch.titleEn !== null) {
    if (typeof patch.titleEn !== "string") return { ok: false, error: "titleEn 格式无效" };
    if (patch.titleEn.length > 500) return { ok: false, error: "titleEn 过长" };
  }
  if (patch.year !== undefined && patch.year !== null) {
    const y = Number(patch.year);
    if (!Number.isInteger(y) || y < 1888 || y > 2100) return { ok: false, error: "year 无效" };
  }
  for (const rk of ["doubanRating", "tmdbRating"] as const) {
    const v = patch[rk];
    if (v === undefined) continue;
    if (v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 10) return { ok: false, error: `${rk} 须在 0–10 或 null` };
  }
  if (patch.country !== undefined && patch.country !== null) {
    if (typeof patch.country !== "string" || patch.country.length > 500) return { ok: false, error: "country 无效" };
  }
  if (patch.summary !== undefined && patch.summary !== null) {
    if (typeof patch.summary !== "string" || patch.summary.length > 20000) return { ok: false, error: "summary 过长" };
  }
  if (patch.mediaType !== undefined && patch.mediaType !== "movie" && patch.mediaType !== "tv") {
    return { ok: false, error: "mediaType 须为 movie 或 tv" };
  }
  return { ok: true };
}

/** 将人工覆盖写入 metadata JSON（保留其余字段） */
export function writeMetadataSidecarUserOverrides(
  absPath: string,
  display: {
    titleZh: string;
    titleEn: string;
    normalizedTitle: string;
    mediaType: "movie" | "tv";
    year: number | null;
    country: string | null;
    language: string | null;
    tmdbRating: number | null;
    doubanRating: number | null;
    summary: string | null;
    userMetaOverrides: UserMetaOverrides;
  }
) {
  let base: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    base = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    base = {};
  }
  const next = {
    ...base,
    titleZh: display.titleZh,
    titleEn: display.titleEn,
    normalizedTitle: display.normalizedTitle,
    mediaType: display.mediaType,
    year: display.year,
    country: display.country,
    language: display.language,
    tmdbRating: display.tmdbRating,
    doubanRating: display.doubanRating,
    summary: display.summary,
    userMetaOverrides: display.userMetaOverrides,
  };
  fs.writeFileSync(absPath, JSON.stringify(next, null, 2), "utf8");
}
