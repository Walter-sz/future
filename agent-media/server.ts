import { createServer } from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { Annotation, StateGraph } from "@langchain/langgraph";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.MEDIA_AGENT_PORT || 3847);
const NAS_TARGET = process.env.NAS_SSH_TARGET || "synology";
const NAS_INBOX_ROOT = process.env.NAS_INBOX_ROOT || "/volume1/homes/影视资源待入库";
const NAS_LIBRARY_ROOT = process.env.NAS_LIBRARY_ROOT || "/volume1/homes/影视资源库";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_TOKEN = process.env.TMDB_API_READ_TOKEN || "";
const GEMINI_PROXY_BASE = (process.env.GEMINI_PROXY_BASE || "http://192.168.124.24:53533").replace(
  /\/$/,
  ""
);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MEDIA_AGENT_CONCURRENCY = Math.max(1, Number(process.env.MEDIA_AGENT_CONCURRENCY || 4) || 4);
/** 每批送进 Gemini 做目录策略的目录数；默认 32。可用 MEDIA_SCAN_POLICY_BATCH_SIZE 覆盖，范围 8–64；批越大越依赖 GEMINI_SCAN_POLICY_TIMEOUT_MS */
const SCAN_POLICY_BATCH_SIZE = Math.min(
  64,
  Math.max(8, Number(process.env.MEDIA_SCAN_POLICY_BATCH_SIZE || 32) || 32)
);
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || 25000) || 25000);
/** 目录策略 / 纠偏批请求体大，单独放宽超时（毫秒），避免默认 25s 一批就超时 */
const GEMINI_SCAN_POLICY_TIMEOUT_MS = Math.max(
  45_000,
  Number(process.env.GEMINI_SCAN_POLICY_TIMEOUT_MS || 180_000) || 180_000
);
/** 目录策略阶段总墙钟上限（毫秒）。未设置或为 0：不限制，跑完所有批次（单批仍受 GEMINI_TIMEOUT_MS）。显式设正数时至少 60s。 */
function resolveScanPolicyMaxMs(): number {
  const raw = process.env.MEDIA_SCAN_POLICY_MAX_MS;
  if (raw === undefined || raw === "" || raw === "0") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(60_000, n);
}
const SCAN_POLICY_MAX_MS = resolveScanPolicyMaxMs();
/** 连续多少批 Gemini 超时后放弃后续 AI 目录判定；其余目录走本地兜底 */
const SCAN_POLICY_MAX_CONSECUTIVE_BATCH_TIMEOUTS = Math.max(
  2,
  Number(process.env.MEDIA_SCAN_POLICY_MAX_CONSECUTIVE_TIMEOUTS || 8) || 8
);

type RunStatus = "queued" | "running" | "success" | "failed";
type RunSummary = {
  id: string;
  triggerSource: string;
  status: RunStatus;
  dryRun: boolean;
  totalItems?: number;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
};
type RunEvent = {
  eventId: number;
  runId: string;
  level: "info" | "warn" | "error";
  node: string;
  message: string;
  payload?: unknown;
  createdAt: string;
};
type Candidate = {
  sourcePath: string;
  sourceName: string;
  sourceKind: "directory" | "file";
  sourceParentDir?: string;
  fromAggregateDir?: boolean;
};

type ResolvedMeta = {
  titleZh: string;
  titleEn: string;
  normalizedTitle: string;
  mediaType: "movie" | "tv";
  year: number | null;
  country: string | null;
  language: string | null;
  tmdbType: "movie" | "tv" | null;
  tmdbId: number | null;
  tmdbRating: number | null;
  doubanRating: number | null;
  summary: string | null;
  directors: string[];
  actors: string[];
  posterUrl: string | null;
  matchStatus: "matched" | "unresolved";
  tags: string[];
  fetchNotes: string[];
};
type NormalizedTitle = {
  titleZh: string;
  titleEn: string;
  normalizedTitle: string;
  source: string;
};

function nowIso() {
  return new Date().toISOString();
}

function getPersistenceRoot() {
  if (process.env.WALTER_DATA_DIR) return path.resolve(process.env.WALTER_DATA_DIR);
  return path.resolve(process.cwd(), "..", "walter_data");
}
function getMediaRoot() {
  return path.join(getPersistenceRoot(), "media");
}
function getMediaMetadataCacheDir() {
  return path.join(getMediaRoot(), "metadata");
}
function getMediaRunsDir() {
  return path.join(getMediaRoot(), "agent-runs");
}
function getRunsIndexPath() {
  return path.join(getMediaRunsDir(), "runs-index.json");
}
function getNormalizeCachePath() {
  return path.join(getMediaRoot(), "normalize-cache.json");
}
function ensureMediaDirs() {
  fs.mkdirSync(getMediaRoot(), { recursive: true });
  fs.mkdirSync(getMediaMetadataCacheDir(), { recursive: true });
  fs.mkdirSync(getMediaRunsDir(), { recursive: true });
}
function getDbPath() {
  return path.join(getPersistenceRoot(), "app.db");
}

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function safeFolderName(input: string) {
  return input.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}
function slugify(input: string) {
  const s = input.trim().toLowerCase().replace(/[\s/_]+/g, "-").replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "");
  return s || "unknown";
}

function uniqueJoin(zh: string, en: string) {
  const a = zh.trim();
  const b = en.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase() === b.toLowerCase()) return a;
  return `${a} ${b}`.trim();
}

function fallbackNormalizeTitle(rawName: string) {
  const cleaned = rawName
    .replace(/[【】\[\]（）\(\)]/g, " ")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const zhMatch = cleaned.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5 0-9·：\-]{0,}/);
  const englishSource = cleaned.replace(/[\u4e00-\u9fa5]/g, " ").replace(/\s+/g, " ").trim();
  const enMatch = englishSource.match(/[A-Za-z][A-Za-z0-9 :'\-]{1,}/);
  const titleZh = (zhMatch?.[0] || "").trim();
  const titleEn = (enMatch?.[0] || "").trim();
  const fallback = cleaned || rawName.trim();
  const normalizedTitle = uniqueJoin(titleZh, titleEn) || fallback;
  return {
    titleZh: titleZh || fallback,
    titleEn,
    normalizedTitle,
  };
}

function parseGeminiJson(rawText: string) {
  const text = rawText.trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

type GeminiCallOpts = { timeoutMs?: number };

async function callGeminiGenerateContent(prompt: string, model: string, opts?: GeminiCallOpts) {
  const url = `${GEMINI_PROXY_BASE}/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, opts?.timeoutMs ?? GEMINI_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
    signal: controller.signal,
  }).catch((err) => (err && typeof err === "object" && (err as any).name === "AbortError" ? "timeout" : null));
  clearTimeout(timer);
  if (resp === "timeout") return { ok: false as const, reason: "timeout" };
  if (!resp) return { ok: false as const, reason: "request-error" };
  if (!resp.ok) return { ok: false as const, reason: `http-${resp.status}` };
  const data = (await resp.json().catch(() => null)) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") return { ok: false as const, reason: "empty-text" };
  return { ok: true as const, text };
}

async function normalizeTitle(rawName: string) {
  const cacheKey = rawName.trim();
  const cached = normalizeCache[cacheKey];
  if (cached) {
    return { ...cached, source: `cache:${cached.source}` } as NormalizedTitle;
  }
  if (!GEMINI_API_KEY) {
    const result = { ...fallbackNormalizeTitle(rawName), source: "fallback-no-key" as const };
    normalizeCache[cacheKey] = {
      titleZh: result.titleZh,
      titleEn: result.titleEn,
      normalizedTitle: result.normalizedTitle,
      source: "fallback-no-key",
    };
    persistNormalizeCache();
    return result;
  }

  const prompt = [
    "你是影视资源文件名规范化助手。",
    "请把输入的原始名称规范化为中文名+外文名，仅输出 JSON，不要输出其他内容。",
    "必须遵守：",
    "1) 去掉分辨率、编码、音轨、字幕组、发布组等噪声（如 BluRay/720p/x264/AC3/CMCT/FRDS）。",
    "2) 保留季信息（如 1-16季）与年份（如 2004、1999-2005）。",
    "3) 如果中英文是同一作品名，分别写入 title_zh 和 title_en。",
    "4) 若缺失英文名，title_en 置空字符串。",
    "输出 JSON：{\"title_zh\":\"...\",\"title_en\":\"...\",\"normalized_title\":\"...\"}",
    `输入：${rawName}`,
  ].join("\n");

  const genResp = await callGeminiGenerateContent(prompt, GEMINI_MODEL);
  if (!genResp.ok) {
    const lastReason = genResp.reason;
    const result = { ...fallbackNormalizeTitle(rawName), source: `fallback-http-${lastReason}` as const };
    normalizeCache[cacheKey] = {
      titleZh: result.titleZh,
      titleEn: result.titleEn,
      normalizedTitle: result.normalizedTitle,
      source: String(result.source),
    };
    persistNormalizeCache();
    return result;
  }

  const parsed = parseGeminiJson(genResp.text);
  if (!parsed || typeof parsed !== "object") {
    const result = { ...fallbackNormalizeTitle(rawName), source: "fallback-parse" as const };
    normalizeCache[cacheKey] = {
      titleZh: result.titleZh,
      titleEn: result.titleEn,
      normalizedTitle: result.normalizedTitle,
      source: "fallback-parse",
    };
    persistNormalizeCache();
    return result;
  }

  const titleZh = String((parsed as any).title_zh || "").trim();
  const titleEn = String((parsed as any).title_en || "").trim();
  const normalizedTitleRaw = String((parsed as any).normalized_title || "").trim();
  const normalizedTitle = normalizedTitleRaw || uniqueJoin(titleZh, titleEn);
  if (!normalizedTitle) {
    const result = { ...fallbackNormalizeTitle(rawName), source: "fallback-empty-normalized" as const };
    normalizeCache[cacheKey] = {
      titleZh: result.titleZh,
      titleEn: result.titleEn,
      normalizedTitle: result.normalizedTitle,
      source: "fallback-empty-normalized",
    };
    persistNormalizeCache();
    return result;
  }
  const result = {
    titleZh: titleZh || normalizedTitle,
    titleEn,
    normalizedTitle,
    source: `gemini-generate:${GEMINI_MODEL}`,
  };
  normalizeCache[cacheKey] = {
    titleZh: result.titleZh,
    titleEn: result.titleEn,
    normalizedTitle: result.normalizedTitle,
    source: String(result.source),
  };
  persistNormalizeCache();
  return result;
}
const VIDEO_EXT_RE =
  /\.(mkv|mp4|avi|mov|wmv|flv|m4v|ts|m2ts|webm|mpg|mpeg|rmvb|iso)$/i;
const AGGREGATE_DIR_RE = /(备份|合集|汇总|片库|资源|电影|电视剧|剧集|纪录片|题材)/;
const SERIES_RANGE_RE = /\d+\s*[-~—～至到]+\s*\d+/;
const SERIES_SEASON_RANGE_RE = /\d+\s*[-~—～至到]+\s*\d+\s*季/;
const SERIES_KEYWORD_RE = /(系列|全集|全季|合集)/;
const GENERIC_COLLECTION_RE = /(待看电影|纪录片|题材电影|电影备份|待整理|片库|资源)/;

/** 用户自建「归类桶」：只按目录名（basename）命中时强制拆到单文件/子目录原子粒度，不做整体入库 */
const USER_COLLECTION_DIR_NAMES = new Set([
  "R级",
  "二战题材电影",
  "儿童电影",
  "待看电影",
  "电影备份",
  "纪录片",
  "高分经典电影",
]);

function fileStem(filePath: string) {
  return path.basename(filePath, path.extname(filePath));
}

function cleanDirTitle(dirName: string) {
  return dirName.replace(/[《》【】\[\]()]/g, "").trim();
}

/** 系列电影/剧集套装/单系列目录：应作为整体 unit，即使下面文件很多也不按「汇总目录」拆分 */
function isFranchiseOrSeriesBundleDir(dirName: string, relativeDir: string, files: string[]) {
  const n = cleanDirTitle(dirName);
  if (!n) return false;
  // 《星际迷航1-13》《碟中谍1-6》等：书名号 + 集数跨度
  if (/《[^》]+》/.test(dirName) && SERIES_RANGE_RE.test(n)) return true;
  // 宫崎骏系列、哈利波特 1-9合集 等（排除归类桶名里的「电影」误伤）
  if (/系列$/.test(n) && !USER_COLLECTION_DIR_NAMES.has(dirName)) return true;
  if (/(冰川时代|ice\s*age)/i.test(dirName)) return true;
  if (/战争与和平/.test(n) && SERIES_RANGE_RE.test(n)) return true;
  if (
    SERIES_RANGE_RE.test(n) &&
    /(星际迷航|星际旅行|碟中谍|不可能的任务|第一滴血|哈利波特|速度与激情|变形金刚|指环王|霍比特人|007|侏罗纪)/i.test(n)
  ) {
    return true;
  }
  // 待看电影/电影备份 下的单视频文件：原子作品，不按汇总目录拆（父级归类桶已在别处处理）
  const parentSegs = relativeDir.split("/").filter(Boolean);
  if (parentSegs.length >= 2) {
    const parent = parentSegs[parentSegs.length - 2];
    if (USER_COLLECTION_DIR_NAMES.has(parent) && files.length === 1 && VIDEO_EXT_RE.test(files[0] || "")) {
      return true;
    }
  }
  return false;
}

function isDirectUserCollectionDir(dirName: string) {
  const normalized = dirName.replace(/[《》【】\[\]()\s]/g, "");
  if (/^r级$/i.test(normalized)) return true;
  return USER_COLLECTION_DIR_NAMES.has(dirName);
}

function shouldSplitAggregateDir(dirName: string, files: string[], relativeDir: string) {
  if (isFranchiseOrSeriesBundleDir(dirName, relativeDir, files)) return false;
  if (isDirectUserCollectionDir(dirName)) return true;
  if (AGGREGATE_DIR_RE.test(dirName)) return true;
  if (files.length < 3) return false;
  const stems = files.map((f) => fileStem(f));
  const uniqueRoots = new Set(stems.map((s) => s.slice(0, 6)));
  return uniqueRoots.size >= 3;
}
type ScanPolicyAction = "unit" | "split" | "parent_unit";
type ScanPolicyDecision = {
  action: ScanPolicyAction;
  unitPath?: string;
  reason?: string;
  decidedBy: "ai" | "fallback";
};
type ScanDirInfo = {
  dir: string;
  dirName: string;
  relativeDir: string;
  fileCount: number;
  sampleFiles: string[];
};
function isEpisodeLikeFileName(name: string) {
  const n = name.toLowerCase();
  return /s\d{1,2}e\d{1,3}/i.test(n) || /第?\d{1,3}\s*(集|季)/.test(n) || /\d+\s*[-~]\s*\d+/.test(n);
}
function shouldAiRescueFallbackSplit(item: ScanDirInfo) {
  // 用户归类桶本身必须拆，不做「纠偏成整体」
  if (isDirectUserCollectionDir(item.dirName)) return false;
  if (item.relativeDir.startsWith("/剧/")) return true;
  if (/(系列|全季|全集|season|s\d{1,2})/i.test(item.dirName)) return true;
  const episodeLikeCount = item.sampleFiles.filter((x) => isEpisodeLikeFileName(x)).length;
  return episodeLikeCount >= Math.max(1, Math.floor(item.sampleFiles.length / 2));
}

async function refineFallbackSplitsWithGemini(runId: string, items: ScanDirInfo[]) {
  const result = new Map<string, ScanPolicyDecision>();
  if (!GEMINI_API_KEY || items.length === 0) return result;
  let aiApplied = 0;
  for (let i = 0; i < items.length; i += SCAN_POLICY_BATCH_SIZE) {
    const batch = items.slice(i, i + SCAN_POLICY_BATCH_SIZE);
    const prompt = [
      "你是影视入库策略纠偏助手。",
      "这些目录被兜底规则暂定为 split，请你复核是否应该整体处理。",
      "输出 JSON：{\"decisions\":[{\"dirPath\":\"...\",\"action\":\"unit|split|parent_unit\",\"unitPath\":\"可空\",\"reason\":\"...\"}]}",
      "判断准则：",
      "1) 电视剧目录（如剧名目录，包含 S01E01 等分集文件）通常应 action=unit。",
      "2) 系列电影/套装目录（如《星际迷航1-13》《碟中谍1-6》、宫崎骏系列、冰川时代 Ice Age、战争与和平1-4）应 action=unit。",
      "3) 只有用户自建归类桶才应 action=split（拆到单文件原子粒度）。归类桶目录名通常为：",
      "   R级、二战题材电影、儿童电影、待看电影、电影备份、纪录片、高分经典电影。",
      "4) 归类桶的子目录若是明显「单部作品/系列套装」（如 待看电影/战争与和平1-4），应 action=unit。",
      `待入库根目录：${NAS_INBOX_ROOT}`,
      "目录列表：",
      ...batch.map(
        (x, idx) =>
          `${idx + 1}. dirPath=${x.dir}; relative=${x.relativeDir}; fileCount=${x.fileCount}; sampleFiles=${x.sampleFiles.join(
            " | "
          )}`
      ),
    ].join("\n");
    const resp = await callGeminiGenerateContent(prompt, GEMINI_MODEL, {
      timeoutMs: GEMINI_SCAN_POLICY_TIMEOUT_MS,
    });
    if (!resp.ok) {
      appendRunEvent(runId, {
        level: "warn",
        node: "scanPolicy",
        message: `AI 纠偏失败（${resp.reason}），保留兜底拆分（batch=${batch.length}）`,
        payload: { reason: resp.reason, model: GEMINI_MODEL },
      });
      continue;
    }
    const parsed = parseGeminiJson(resp.text) as any;
    const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
    const dirSet = new Set(batch.map((x) => x.dir));
    for (const d of decisions) {
      const dirPath = String(d?.dirPath || "").trim();
      const action = String(d?.action || "").trim() as ScanPolicyAction;
      if (!dirSet.has(dirPath)) continue;
      if (action !== "unit" && action !== "split" && action !== "parent_unit") continue;
      const unitPath = String(d?.unitPath || "").trim();
      if (action === "parent_unit" && !isValidUnitPath(unitPath)) continue;
      result.set(dirPath, {
        action,
        unitPath: action === "parent_unit" ? unitPath : undefined,
        reason: String(d?.reason || ""),
        decidedBy: "ai",
      });
      aiApplied += 1;
    }
  }
  appendRunEvent(runId, {
    level: "info",
    node: "scanPolicy",
    message: `AI 纠偏完成：${aiApplied}/${items.length} 个候选目录获得 AI 复核结论`,
    payload: { candidates: items.length, aiApplied },
  });
  return result;
}

function normalizeInboxRelativePath(absPath: string) {
  if (absPath === NAS_INBOX_ROOT) return "/";
  if (absPath.startsWith(`${NAS_INBOX_ROOT}/`)) return absPath.slice(NAS_INBOX_ROOT.length);
  return absPath;
}

function isValidUnitPath(candidate: string) {
  if (!candidate) return false;
  if (!candidate.startsWith(NAS_INBOX_ROOT)) return false;
  return true;
}

async function decideDirectoryPoliciesWithGemini(runId: string, items: ScanDirInfo[]) {
  const result = new Map<string, ScanPolicyDecision>();
  if (!GEMINI_API_KEY || items.length === 0) return result;

  let processed = 0;
  let aiApplied = 0;
  let consecutiveTimeouts = 0;
  const totalBatches = Math.ceil(items.length / SCAN_POLICY_BATCH_SIZE);
  const startedAt = Date.now();
  appendRunEvent(runId, {
    level: "info",
    node: "scanPolicy",
    message: `开始 AI 目录策略判定：${items.length} 个目录，${totalBatches} 个批次`,
    payload: {
      directories: items.length,
      batchSize: SCAN_POLICY_BATCH_SIZE,
      totalBatches,
      maxMs: SCAN_POLICY_MAX_MS === 0 ? "unlimited" : SCAN_POLICY_MAX_MS,
      batchTimeoutMs: GEMINI_SCAN_POLICY_TIMEOUT_MS,
      model: GEMINI_MODEL,
    },
  });
  for (let i = 0; i < items.length; i += SCAN_POLICY_BATCH_SIZE) {
    const elapsedMs = Date.now() - startedAt;
    const batchNo = Math.floor(i / SCAN_POLICY_BATCH_SIZE) + 1;
    if (SCAN_POLICY_MAX_MS > 0 && elapsedMs > SCAN_POLICY_MAX_MS) {
      appendRunEvent(runId, {
        level: "warn",
        node: "scanPolicy",
        message: `AI 策略达到耗时上限，剩余目录改走兜底规则`,
        payload: {
          elapsedMs,
          maxMs: SCAN_POLICY_MAX_MS,
          processed,
          remaining: Math.max(0, items.length - processed),
          batchNo,
          totalBatches,
        },
      });
      break;
    }
    const batch = items.slice(i, i + SCAN_POLICY_BATCH_SIZE);
    appendRunEvent(runId, {
      level: "info",
      node: "scanPolicy",
      message: `AI 判定进度：批次 ${batchNo}/${totalBatches}`,
      payload: {
        batchNo,
        totalBatches,
        batchSize: batch.length,
        processed,
        remaining: Math.max(0, items.length - processed),
      },
    });
    const prompt = [
      "你是影视资源入库策略助手。",
      "目标：判断每个目录是“单作品/整剧集/系列”还是“汇总目录需要拆分到单文件”。",
      "输入目录均来自 NAS 待入库区，输出必须是 JSON。",
      "规则：",
      "1) action=unit：该目录本身就是一个处理对象（单电影、整部剧、系列电影套装如《星际迷航1-13》《碟中谍1-6》、冰川时代、战争与和平1-4、宫崎骏系列等）。",
      "2) action=split：仅当目录是用户自建的「归类桶」时拆分；归类桶名称通常为：",
      "   R级、二战题材电影、儿童电影、待看电影、电影备份、纪录片、高分经典电影。",
      "   这些目录内应拆成单文件/子目录原子作品再分别入库。",
      "3) action=parent_unit：当前目录属于某个更上层作品（如 S01/S02 属于剧名目录），需给出 unitPath（绝对路径，必须在待入库根下）。",
      "4) 归类桶的子目录若是单部作品或系列套装（例如 待看电影/战争与和平1-4），应 action=unit，不要 split。",
      "输出格式：{\"decisions\":[{\"dirPath\":\"...\",\"action\":\"unit|split|parent_unit\",\"unitPath\":\"...可空\",\"reason\":\"...\"}]}",
      `待入库根目录：${NAS_INBOX_ROOT}`,
      "目录列表：",
      ...batch.map(
        (x, idx) =>
          `${idx + 1}. dirPath=${x.dir}; relative=${x.relativeDir}; fileCount=${x.fileCount}; sampleFiles=${x.sampleFiles.join(
            " | "
          )}`
      ),
    ].join("\n");

    const resp = await callGeminiGenerateContent(prompt, GEMINI_MODEL, {
      timeoutMs: GEMINI_SCAN_POLICY_TIMEOUT_MS,
    });
    processed += batch.length;
    if (!resp.ok) {
      if (resp.reason === "timeout") consecutiveTimeouts += 1;
      appendRunEvent(runId, {
        level: "warn",
        node: "scanPolicy",
        message: `AI 目录策略批处理失败（${resp.reason}），本批回退规则兜底（batch=${batch.length}）`,
        payload: {
          reason: resp.reason,
          model: GEMINI_MODEL,
          timeoutMs: GEMINI_SCAN_POLICY_TIMEOUT_MS,
        },
      });
      if (consecutiveTimeouts >= SCAN_POLICY_MAX_CONSECUTIVE_BATCH_TIMEOUTS) {
        appendRunEvent(runId, {
          level: "warn",
          node: "scanPolicy",
          message: `AI 策略连续超时已达 ${consecutiveTimeouts} 批，后续目录直接使用兜底规则以保证可用性`,
          payload: {
            consecutiveTimeouts,
            threshold: SCAN_POLICY_MAX_CONSECUTIVE_BATCH_TIMEOUTS,
            remaining: Math.max(0, items.length - processed),
            model: GEMINI_MODEL,
          },
        });
        break;
      }
      continue;
    }
    appendRunEvent(runId, {
      level: "info",
      node: "scanPolicy",
      message: `AI 批次完成：${batchNo}/${totalBatches}`,
      payload: { batchNo, totalBatches, processed },
    });
    consecutiveTimeouts = 0;

    const parsed = parseGeminiJson(resp.text) as any;
    const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
    const dirSet = new Set(batch.map((x) => x.dir));
    for (const d of decisions) {
      const dirPath = String(d?.dirPath || "").trim();
      const action = String(d?.action || "").trim() as ScanPolicyAction;
      const reason = String(d?.reason || "").trim();
      if (!dirSet.has(dirPath)) continue;
      if (action !== "unit" && action !== "split" && action !== "parent_unit") continue;
      const unitPath = String(d?.unitPath || "").trim();
      if (action === "parent_unit" && !isValidUnitPath(unitPath)) continue;
      result.set(dirPath, {
        action,
        unitPath: action === "parent_unit" ? unitPath : undefined,
        reason,
        decidedBy: "ai",
      });
      aiApplied += 1;
    }
  }

  const uncovered = Math.max(0, items.length - aiApplied);
  appendRunEvent(runId, {
    level: "info",
    node: "scanPolicy",
    message: `AI 策略判定完成：共 ${items.length} 个目录，模型返回有效决策 ${aiApplied} 条${uncovered > 0 ? `，${uncovered} 个目录将用本地规则补全` : ""}`,
    payload: {
      directories: items.length,
      processed,
      aiApplied,
      model: GEMINI_MODEL,
      elapsedMs: Date.now() - startedAt,
      maxMs: SCAN_POLICY_MAX_MS === 0 ? "unlimited" : SCAN_POLICY_MAX_MS,
    },
  });
  return result;
}

function isSeriesLikeName(name: string) {
  const n = name.replace(/[《》【】\[\]()]/g, "").trim();
  if (!n) return false;
  if (SERIES_SEASON_RANGE_RE.test(n)) return true;
  if (SERIES_RANGE_RE.test(n) && /(合集|系列|季|部|集|篇|章|卷|部曲| trilogy | saga )/i.test(n)) return true;
  if (SERIES_RANGE_RE.test(n) && /[A-Za-z\u4e00-\u9fa5]{2,}/.test(n)) return true;
  if (SERIES_KEYWORD_RE.test(n) && !GENERIC_COLLECTION_RE.test(n)) return true;
  if (/^[\u4e00-\u9fa5A-Za-z0-9\s]+系列$/.test(n)) return true;
  return false;
}

function findSeriesUnitPath(filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const inboxParts = NAS_INBOX_ROOT.split("/").filter(Boolean);
  if (parts.length <= inboxParts.length) return null;
  let matchedAt = -1;
  for (let i = inboxParts.length; i < parts.length - 1; i++) {
    if (isSeriesLikeName(parts[i])) {
      matchedAt = i;
      break;
    }
  }
  if (matchedAt < 0) return null;
  return `/${parts.slice(0, matchedAt + 1).join("/")}`;
}

function resolveTvUnitPath(filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("剧");
  if (idx < 0 || idx + 1 >= parts.length) return null;
  return `/${parts.slice(0, idx + 2).join("/")}`;
}

function resolveMusicArtistUnitPath(filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("音乐");
  if (idx < 0 || idx + 1 >= parts.length) return null;
  return `/${parts.slice(0, idx + 2).join("/")}`;
}

function resolveMusicArtistUnitFromDir(dirPath: string): string | null {
  const parts = dirPath.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("音乐");
  // 需要至少 /音乐/艺术家/专辑 结构（目录层级）
  if (idx < 0 || idx + 2 >= parts.length) return null;
  return `/${parts.slice(0, idx + 2).join("/")}`;
}

function isUnderPath(targetPath: string, parentPath: string) {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

const runsIndexPath = getRunsIndexPath();
const normalizeCachePath = getNormalizeCachePath();
let normalizeCache: Record<string, Omit<NormalizedTitle, "source"> & { source: string }> = {};
let eventSeq = 0;
function readNormalizeCache() {
  ensureMediaDirs();
  if (!fs.existsSync(normalizeCachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(normalizeCachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function persistNormalizeCache() {
  ensureMediaDirs();
  fs.writeFileSync(normalizeCachePath, JSON.stringify(normalizeCache, null, 2), "utf8");
}
function runEventsPath(runId: string) {
  return path.join(getMediaRunsDir(), `run-${runId}.jsonl`);
}
function readRunsIndex(): RunSummary[] {
  ensureMediaDirs();
  if (!fs.existsSync(runsIndexPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(runsIndexPath, "utf8"));
    return Array.isArray(parsed) ? (parsed as RunSummary[]) : [];
  } catch {
    return [];
  }
}
function writeRunsIndex(runs: RunSummary[]) {
  ensureMediaDirs();
  fs.writeFileSync(runsIndexPath, JSON.stringify(runs, null, 2), "utf8");
}
function reconcileStaleRunsOnBoot() {
  const runs = readRunsIndex();
  let changed = false;
  const now = nowIso();
  const next = runs.map((run) => {
    if (run.status !== "running" && run.status !== "queued") return run;
    changed = true;
    return {
      ...run,
      status: "failed" as const,
      finishedAt: now,
      summary: run.summary || "Agent 重启：上一次运行未正常结束",
    };
  });
  if (changed) writeRunsIndex(next);
}
function upsertRun(run: RunSummary) {
  const runs = readRunsIndex();
  const idx = runs.findIndex((x) => x.id === run.id);
  if (idx >= 0) runs[idx] = run;
  else runs.unshift(run);
  writeRunsIndex(runs);
}
function appendRunEvent(runId: string, event: Omit<RunEvent, "runId" | "eventId" | "createdAt">) {
  eventSeq += 1;
  const full: RunEvent = { ...event, runId, eventId: eventSeq, createdAt: nowIso() };
  fs.appendFileSync(runEventsPath(runId), `${JSON.stringify(full)}\n`, "utf8");
}
function readRunEvents(runId: string): RunEvent[] {
  const file = runEventsPath(runId);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RunEvent;
      } catch {
        return null;
      }
    })
    .filter((x): x is RunEvent => x !== null);
}

async function ssh(command: string) {
  const { stdout } = await execFileAsync("ssh", [NAS_TARGET, command], { maxBuffer: 1024 * 1024 * 20 });
  return stdout;
}
async function scanInbox(runId: string): Promise<Candidate[]> {
  appendRunEvent(runId, {
    level: "info",
    node: "scanInbox",
    message: `开始扫描待入库目录：${NAS_INBOX_ROOT}`,
  });
  const cmd = `set -e; if [ -d ${shQuote(
    NAS_INBOX_ROOT
  )} ]; then find ${shQuote(
    NAS_INBOX_ROOT
  )} \\( -path '*/.*' -o -name '.*' \\) -prune -o -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.mov' -o -iname '*.wmv' -o -iname '*.flv' -o -iname '*.m4v' -o -iname '*.ts' -o -iname '*.m2ts' -o -iname '*.webm' -o -iname '*.mpg' -o -iname '*.mpeg' -o -iname '*.rmvb' -o -iname '*.iso' \\) -print; fi`;
  const stdout = await ssh(cmd);
  const videoFiles = stdout
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => Boolean(x) && VIDEO_EXT_RE.test(x) && !path.basename(x).startsWith("."));
  appendRunEvent(runId, {
    level: "info",
    node: "scanInbox",
    message: `扫描完成，发现 ${videoFiles.length} 个视频文件，开始进行目录策略判定`,
  });

  const byDir = new Map<string, string[]>();
  for (const f of videoFiles) {
    const dir = path.posix.dirname(f);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }
  // 强约束兜底：即使 AI 目录策略超时，也要保持“剧集季目录归并到剧名目录”等关键行为。
  const forcedParentUnitByDir = new Map<string, { unitPath: string; reason: string }>();
  for (const [dir, files] of byDir.entries()) {
    const unitCandidates: string[] = [];
    for (const file of files) {
      const tvUnit = resolveTvUnitPath(file);
      if (tvUnit) unitCandidates.push(tvUnit);
      const seriesUnit = findSeriesUnitPath(file);
      if (seriesUnit) unitCandidates.push(seriesUnit);
      const musicArtistUnit = resolveMusicArtistUnitPath(file);
      if (musicArtistUnit) unitCandidates.push(musicArtistUnit);
    }
    const uniqueCandidates = Array.from(new Set(unitCandidates.filter((x) => isValidUnitPath(x))));
    if (uniqueCandidates.length === 0) continue;
    // 选最“内层”的父级（路径最长），避免把条目错误提升到过高层级。
    uniqueCandidates.sort((a, b) => b.length - a.length);
    const chosen = uniqueCandidates[0];
    if (chosen !== dir) {
      forcedParentUnitByDir.set(dir, {
        unitPath: chosen,
        reason: "structured-parent-fallback",
      });
    }
  }
  if (forcedParentUnitByDir.size > 0) {
    appendRunEvent(runId, {
      level: "info",
      node: "scanInbox",
      message: `结构化兜底已启用：${forcedParentUnitByDir.size} 个目录将归并到父级作品`,
      payload: { forcedParentDirs: forcedParentUnitByDir.size },
    });
  }
  const dirInfos: ScanDirInfo[] = Array.from(byDir.entries())
    .map(([dir, files]) => ({
      dir,
      dirName: path.posix.basename(dir),
      relativeDir: normalizeInboxRelativePath(dir),
      fileCount: files.length,
      sampleFiles: files.slice(0, 8).map((f) => path.posix.basename(f)),
    }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
  const aiDecisions = await decideDirectoryPoliciesWithGemini(runId, dirInfos);

  const unitMap = new Map<string, ScanPolicyDecision>();
  const splitMap = new Map<string, ScanPolicyDecision>();
  const fallbackSplitCandidates: ScanDirInfo[] = [];
  for (const [dir, files] of byDir.entries()) {
    const dirName = path.posix.basename(dir);
    const forced = forcedParentUnitByDir.get(dir);
    if (forced) {
      unitMap.set(forced.unitPath, {
        action: "parent_unit",
        unitPath: forced.unitPath,
        reason: forced.reason,
        decidedBy: "fallback",
      });
      continue;
    }
    const ai = aiDecisions.get(dir);
    if (ai?.action === "split") {
      splitMap.set(dir, ai);
      continue;
    }
    if (ai?.action === "parent_unit" && ai.unitPath && isValidUnitPath(ai.unitPath)) {
      unitMap.set(ai.unitPath, ai);
      continue;
    }
    if (ai?.action === "unit") {
      unitMap.set(dir, ai);
      continue;
    }

    const dirRelative = normalizeInboxRelativePath(dir);
    if (shouldSplitAggregateDir(dirName, files, dirRelative)) {
      splitMap.set(dir, { action: "split", decidedBy: "fallback", reason: "aggregate-dir-heuristic" });
      const info = dirInfos.find((x) => x.dir === dir);
      if (info && shouldAiRescueFallbackSplit(info)) fallbackSplitCandidates.push(info);
    } else {
      unitMap.set(dir, { action: "unit", decidedBy: "fallback", reason: "default-unit" });
    }
  }

  if (fallbackSplitCandidates.length > 0) {
    const rescueDecisions = await refineFallbackSplitsWithGemini(runId, fallbackSplitCandidates);
    for (const [dir, d] of rescueDecisions.entries()) {
      if (d.action === "split") continue;
      splitMap.delete(dir);
      if (d.action === "parent_unit" && d.unitPath && isValidUnitPath(d.unitPath)) {
        unitMap.set(d.unitPath, d);
      } else {
        unitMap.set(dir, d.action === "unit" ? d : { action: "unit", decidedBy: "ai", reason: d.reason || "" });
      }
      appendRunEvent(runId, {
        level: "info",
        node: "scanInbox",
        message: `AI 纠偏改判为整体处理：${dir}`,
        payload: { type: "ai-rescue-unit", dir, action: d.action, unitPath: d.unitPath || dir, reason: d.reason || "" },
      });
    }
  }

  const sortedUnits = Array.from(unitMap.keys()).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const keptUnits: string[] = [];
  for (const unitPath of sortedUnits) {
    if (keptUnits.some((existing) => isUnderPath(unitPath, existing))) continue;
    keptUnits.push(unitPath);
  }

  const candidates: Candidate[] = [];
  const candidatePathSet = new Set<string>();
  for (const unitPath of keptUnits) {
    if (candidatePathSet.has(unitPath)) continue;
    const policy = unitMap.get(unitPath);
    candidates.push({
      sourcePath: unitPath,
      sourceName: path.posix.basename(unitPath),
      sourceKind: "directory",
      sourceParentDir: path.posix.dirname(unitPath),
      fromAggregateDir: false,
    });
    candidatePathSet.add(unitPath);
    if (policy?.decidedBy === "ai") {
      appendRunEvent(runId, {
        level: "info",
        node: "scanInbox",
        message: `AI 判定按整体处理：${unitPath}`,
        payload: { type: "ai-unit", unitPath, reason: policy.reason || "" },
      });
    }
  }

  for (const [dir, files] of Array.from(byDir.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const policy = splitMap.get(dir);
    if (!policy) continue;
    if (keptUnits.some((unitPath) => isUnderPath(dir, unitPath))) continue;
    const dirName = path.posix.basename(dir);
    appendRunEvent(runId, {
      level: "warn",
      node: "scanInbox",
      message: `检测到疑似汇总目录，按单文件拆分：${dir}`,
      payload: {
        type: "aggregate-split",
        dir,
        dirName,
        fileCount: files.length,
        sampleFiles: files.slice(0, 8).map((f) => path.posix.basename(f)),
        decidedBy: policy.decidedBy,
        reason: policy.reason || "",
      },
    });
    for (const file of files) {
      if (candidatePathSet.has(file)) continue;
      candidates.push({
        sourcePath: file,
        sourceName: fileStem(file),
        sourceKind: "file",
        sourceParentDir: dir,
        fromAggregateDir: true,
      });
      candidatePathSet.add(file);
    }
  }

  appendRunEvent(runId, {
    level: "info",
    node: "scanInbox",
    message: `发现 ${videoFiles.length} 个视频文件，归并为 ${candidates.length} 个待处理对象`,
    payload: { directories: byDir.size, aiDecisions: aiDecisions.size },
  });
  return candidates;
}
async function tmdbFetch(url: string) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: "application/json" } });
  if (!resp.ok) throw new Error(`TMDB HTTP ${resp.status}`);
  return resp.json();
}
function mapGenres(genres: string[]) {
  const tags = new Set<string>();
  for (const g of genres) {
    tags.add(g);
    const l = g.toLowerCase();
    if (l.includes("war") || g.includes("战争")) tags.add("战争");
    if (l.includes("romance") || g.includes("爱情")) tags.add("爱情");
    if (l.includes("science fiction") || g.includes("科幻")) tags.add("科幻");
  }
  return Array.from(tags);
}
async function resolveMetadata(candidate: Candidate): Promise<ResolvedMeta> {
  const normalized = await normalizeTitle(candidate.sourceName);
  const base: ResolvedMeta = {
    ...normalized,
    mediaType: "movie",
    year: null,
    country: null,
    language: null,
    tmdbType: null,
    tmdbId: null,
    tmdbRating: null,
    doubanRating: null,
    summary: null,
    directors: [],
    actors: [],
    posterUrl: null,
    matchStatus: "unresolved",
    tags: [],
    fetchNotes: [],
  };
  if (!TMDB_TOKEN) {
    base.fetchNotes.push("TMDB token 未配置");
    return base;
  }
  const queries = [normalized.titleZh, normalized.titleEn, normalized.normalizedTitle].filter(Boolean);
  let picked: any = null;
  let pickedType: "movie" | "tv" = "movie";
  for (const q of queries) {
    for (const t of ["movie", "tv"] as const) {
      const url = `${TMDB_BASE}/search/${t}?query=${encodeURIComponent(q)}&language=zh-CN&page=1`;
      const data = await tmdbFetch(url).catch(() => null);
      const first = data?.results?.[0];
      if (first) {
        picked = first;
        pickedType = t;
        break;
      }
    }
    if (picked) break;
  }
  if (!picked) return base;
  const detail = await tmdbFetch(`${TMDB_BASE}/${pickedType}/${picked.id}?language=zh-CN&append_to_response=credits`).catch(() => null);
  if (!detail) return base;
  const genres = Array.isArray(detail.genres) ? detail.genres.map((x: any) => String(x.name || "")) : [];
  const directors = pickedType === "movie" ? (detail.credits?.crew || []).filter((x: any) => x.job === "Director").slice(0, 4).map((x: any) => String(x.name)) : [];
  const actors = (detail.credits?.cast || []).slice(0, 10).map((x: any) => String(x.name));
  return {
    ...base,
    titleZh: detail.title || detail.name || base.titleZh,
    titleEn: detail.original_title || detail.original_name || base.titleEn,
    normalizedTitle: `${detail.title || detail.name || base.titleZh} ${detail.original_title || detail.original_name || base.titleEn}`.trim(),
    mediaType: pickedType,
    year: Number((detail.release_date || detail.first_air_date || "").slice(0, 4)) || null,
    country: pickedType === "tv" ? (detail.origin_country || []).join(",") : ((detail.production_countries || []).map((x: any) => x.iso_3166_1).join(",") || null),
    language: detail.original_language || null,
    tmdbType: pickedType,
    tmdbId: detail.id || null,
    tmdbRating: typeof detail.vote_average === "number" ? detail.vote_average : null,
    summary: detail.overview || null,
    directors,
    actors,
    posterUrl: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
    matchStatus: "matched",
    tags: mapGenres(genres),
  };
}

let db: Database.Database | null = null;
function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_work (
        id INTEGER PRIMARY KEY AUTOINCREMENT,title_zh TEXT NOT NULL,title_en TEXT NOT NULL DEFAULT '',
        normalized_title TEXT NOT NULL DEFAULT '',media_type TEXT NOT NULL DEFAULT 'movie',year INTEGER,country TEXT,language TEXT,
        tmdb_type TEXT,tmdb_id INTEGER,tmdb_rating REAL,douban_rating REAL,match_status TEXT NOT NULL DEFAULT 'unresolved',summary TEXT,
        directors_json TEXT NOT NULL DEFAULT '[]',actors_json TEXT NOT NULL DEFAULT '[]',poster_url TEXT,nas_library_path TEXT NOT NULL,
        metadata_path TEXT,search_text TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS media_work_path_unique ON media_work(nas_library_path);
      CREATE TABLE IF NOT EXISTS media_tag (id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_work_tag (work_id INTEGER NOT NULL,tag_id INTEGER NOT NULL,PRIMARY KEY(work_id, tag_id));
    `);
  }
  return db;
}
function upsertIndex(meta: ResolvedMeta, metadataPath: string, nasPath: string) {
  const raw = getDb();
  const now = Date.now();
  const searchText = [meta.titleZh, meta.titleEn, meta.summary || "", meta.directors.join(" "), meta.actors.join(" "), meta.tags.join(" "), meta.country || ""].join(" ").trim();
  raw.prepare(`INSERT INTO media_work(title_zh,title_en,normalized_title,media_type,year,country,language,tmdb_type,tmdb_id,tmdb_rating,douban_rating,match_status,summary,directors_json,actors_json,poster_url,nas_library_path,metadata_path,search_text,created_at,updated_at)
    VALUES(@titleZh,@titleEn,@normalizedTitle,@mediaType,@year,@country,@language,@tmdbType,@tmdbId,@tmdbRating,@doubanRating,@matchStatus,@summary,@directorsJson,@actorsJson,@posterUrl,@nasLibraryPath,@metadataPath,@searchText,@now,@now)
    ON CONFLICT(nas_library_path) DO UPDATE SET
      title_zh=excluded.title_zh,title_en=excluded.title_en,normalized_title=excluded.normalized_title,media_type=excluded.media_type,year=excluded.year,country=excluded.country,language=excluded.language,
      tmdb_type=excluded.tmdb_type,tmdb_id=excluded.tmdb_id,tmdb_rating=excluded.tmdb_rating,douban_rating=excluded.douban_rating,match_status=excluded.match_status,summary=excluded.summary,
      directors_json=excluded.directors_json,actors_json=excluded.actors_json,poster_url=excluded.poster_url,metadata_path=excluded.metadata_path,search_text=excluded.search_text,updated_at=excluded.updated_at`).run({
    titleZh: meta.titleZh, titleEn: meta.titleEn || "", normalizedTitle: meta.normalizedTitle, mediaType: meta.mediaType, year: meta.year, country: meta.country, language: meta.language,
    tmdbType: meta.tmdbType, tmdbId: meta.tmdbId, tmdbRating: meta.tmdbRating, doubanRating: meta.doubanRating, matchStatus: meta.matchStatus, summary: meta.summary,
    directorsJson: JSON.stringify(meta.directors), actorsJson: JSON.stringify(meta.actors), posterUrl: meta.posterUrl, nasLibraryPath: nasPath, metadataPath, searchText, now,
  });
}

const ItemState = Annotation.Root({
  runId: Annotation<string>(),
  dryRun: Annotation<boolean>(),
  candidate: Annotation<Candidate>(),
  metadata: Annotation<ResolvedMeta>(),
});
const graph = new StateGraph(ItemState)
  .addNode("fetchMetadata", async (state) => ({ metadata: await resolveMetadata(state.candidate) }))
  .addNode("persist", async (state) => {
    const folder = safeFolderName(
      state.metadata.titleEn ? `${state.metadata.titleZh}_${state.metadata.titleEn}` : state.metadata.titleZh
    );
    const targetPath = path.posix.join(NAS_LIBRARY_ROOT, folder);
    if (!state.dryRun) {
      if (state.candidate.sourceKind === "file") {
        await ssh(
          `set -e; mkdir -p ${shQuote(targetPath)}; mv ${shQuote(state.candidate.sourcePath)} ${shQuote(
            path.posix.join(targetPath, path.posix.basename(state.candidate.sourcePath))
          )}`
        );
      } else {
        await ssh(
          `set -e; mkdir -p ${shQuote(NAS_LIBRARY_ROOT)}; mv ${shQuote(state.candidate.sourcePath)} ${shQuote(
            targetPath
          )}`
        );
      }
      appendRunEvent(state.runId, { level: "info", node: "persist", message: `已移动到资源库：${targetPath}` });
    } else {
      appendRunEvent(state.runId, {
        level: "info",
        node: "persist",
        message: `dry-run 预览：${state.candidate.sourcePath} (${state.candidate.sourceKind}) -> ${targetPath}`,
        payload: {
          itemKey: state.candidate.sourcePath,
          sourceName: state.candidate.sourceName,
          sourcePath: state.candidate.sourcePath,
          targetPath,
        },
      });
    }
    const metadataPath = path.join(getMediaMetadataCacheDir(), `${slugify(state.metadata.titleZh)}-${Date.now()}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify({ ...state.metadata, sourcePath: state.candidate.sourcePath, targetPath, generatedAt: nowIso(), dryRun: state.dryRun }, null, 2), "utf8");
    upsertIndex(state.metadata, metadataPath, state.dryRun ? state.candidate.sourcePath : targetPath);
    appendRunEvent(state.runId, {
      level: "info",
      node: "persist",
      message: `已写入 metadata 与索引`,
      payload: {
        itemKey: state.candidate.sourcePath,
        sourceName: state.candidate.sourceName,
        sourcePath: state.candidate.sourcePath,
        targetPath,
        metadataPath,
      },
    });
    return {};
  })
  .addEdge("__start__", "fetchMetadata")
  .addEdge("fetchMetadata", "persist")
  .addEdge("persist", "__end__")
  .compile();

async function executeRun(run: RunSummary) {
  const running = { ...run, status: "running" as const };
  upsertRun(running);
  appendRunEvent(run.id, { level: "info", node: "run", message: `开始执行（dry-run=${run.dryRun}）` });
  try {
    const candidates = await scanInbox(run.id);
    running.totalItems = candidates.length;
    upsertRun(running);
    const processCandidate = async (candidate: Candidate) => {
      appendRunEvent(run.id, {
        level: "info",
        node: "normalize",
        message: `处理：${candidate.sourceName}`,
        payload: {
          itemKey: candidate.sourcePath,
          sourceName: candidate.sourceName,
          sourcePath: candidate.sourcePath,
          sourceKind: candidate.sourceKind,
        },
      });
      if (candidate.fromAggregateDir && candidate.sourceParentDir) {
        appendRunEvent(run.id, {
          level: "warn",
          node: "normalize",
          message: `该条目来自汇总目录拆分，请人工复核：${candidate.sourceName}`,
          payload: {
            itemKey: candidate.sourcePath,
            type: "needs-review",
            sourceName: candidate.sourceName,
            sourcePath: candidate.sourcePath,
            sourceParentDir: candidate.sourceParentDir,
          },
        });
      }
      const normalized = await normalizeTitle(candidate.sourceName);
      const sourceLabel = String(normalized.source);
      const usedGemini = sourceLabel.startsWith("gemini") || sourceLabel.startsWith("cache:gemini");
      appendRunEvent(run.id, {
        level: usedGemini ? "info" : "warn",
        node: "normalize",
        message:
          usedGemini
            ? `规范化：${normalized.normalizedTitle}`
            : `规范化（fallback）：${normalized.normalizedTitle}`,
        payload: {
          itemKey: candidate.sourcePath,
          sourceName: candidate.sourceName,
          sourcePath: candidate.sourcePath,
          source: normalized.source,
          normalizedTitle: normalized.normalizedTitle,
        },
      });
      try {
        await graph.invoke({
          runId: run.id,
          dryRun: run.dryRun,
          candidate,
          metadata: {
            ...normalized,
            mediaType: "movie",
            year: null,
            country: null,
            language: null,
            tmdbType: null,
            tmdbId: null,
            tmdbRating: null,
            doubanRating: null,
            summary: null,
            directors: [],
            actors: [],
            posterUrl: null,
            matchStatus: "unresolved",
            tags: [],
            fetchNotes: [],
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        appendRunEvent(run.id, {
          level: "error",
          node: "persist",
          message: `条目处理失败：${candidate.sourceName} - ${msg}`,
          payload: {
            itemKey: candidate.sourcePath,
            sourceName: candidate.sourceName,
            sourcePath: candidate.sourcePath,
            error: msg,
          },
        });
        throw err;
      }
    };

    const workerCount = Math.min(MEDIA_AGENT_CONCURRENCY, Math.max(1, candidates.length));
    appendRunEvent(run.id, {
      level: "info",
      node: "run",
      message: `并发处理已启用：${workerCount} worker(s)`,
      payload: { concurrency: workerCount, totalItems: candidates.length },
    });

    let cursor = 0;
    let firstError: unknown = null;
    const worker = async () => {
      while (true) {
        if (firstError) return;
        const idx = cursor;
        if (idx >= candidates.length) return;
        cursor += 1;
        try {
          await processCandidate(candidates[idx]);
        } catch (err) {
          firstError = err;
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (firstError) throw firstError;

    upsertRun({ ...running, status: "success", finishedAt: nowIso(), summary: `完成，处理 ${candidates.length} 项` });
    appendRunEvent(run.id, { level: "info", node: "run", message: `执行结束，处理 ${candidates.length} 项` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    upsertRun({ ...running, status: "failed", finishedAt: nowIso(), summary: msg });
    appendRunEvent(run.id, { level: "error", node: "run", message: `执行失败：${msg}` });
  }
}

function json(res: import("http").ServerResponse, body: any, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function readReqJson(req: import("http").IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

ensureMediaDirs();
if (!fs.existsSync(runsIndexPath)) writeRunsIndex([]);
normalizeCache = readNormalizeCache();
reconcileStaleRunsOnBoot();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health") return json(res, { ok: true, service: "media-agent", time: nowIso() });
  if (url.pathname === "/runs" && req.method === "GET") return json(res, { ok: true, items: readRunsIndex() });
  if (url.pathname === "/runs" && req.method === "POST") {
    const body = await readReqJson(req);
    const hasActiveRun = readRunsIndex().some((x) => x.status === "running" || x.status === "queued");
    if (hasActiveRun) {
      return json(res, { ok: false, error: "已有运行中的任务，请等待当前任务结束后再触发" }, 409);
    }
    const run: RunSummary = { id: randomUUID(), triggerSource: String(body.triggerSource || "manual"), dryRun: body.dryRun !== false, status: "queued", startedAt: nowIso() };
    upsertRun(run);
    void executeRun(run);
    return json(res, { ok: true, run });
  }
  const m = url.pathname.match(/^\/runs\/([^/]+)$/);
  if (m && req.method === "GET") {
    const id = m[1];
    const run = readRunsIndex().find((x) => x.id === id);
    if (!run) return json(res, { ok: false, error: "run not found" }, 404);
    return json(res, { ok: true, run, events: readRunEvents(id) });
  }
  return json(res, { ok: false, error: "not found" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[media-agent] listening at http://127.0.0.1:${PORT}`);
  console.log(`[media-agent] NAS target=${NAS_TARGET}`);
  console.log(`[media-agent] inbox=${NAS_INBOX_ROOT}`);
  console.log(`[media-agent] library=${NAS_LIBRARY_ROOT}`);
});
