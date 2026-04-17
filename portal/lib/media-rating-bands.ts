import type { MediaWorkCard } from "@/lib/media-data";

/** 合集页评分档分页工具：基础 4 档 + 无评分，>80 自动 0.5 细拆。 */

export type RatingBandId =
  | "9-10"
  | "8-9"
  | "8.5-9"
  | "8-8.5"
  | "7-8"
  | "7.5-8"
  | "7-7.5"
  | "0-7"
  | "none";

export type RatingBand = {
  id: RatingBandId;
  label: string;
  /** null 表示 douban_rating IS NULL（仅用于 id=none） */
  min: number | null;
  /** 上界开区间；null 表示 douban_rating IS NULL（仅用于 id=none） */
  max: number | null;
};

/** 单条记录属于哪一个「基础档」（不细拆）。 */
export type BaseBandId = "9-10" | "8-9" | "7-8" | "0-7" | "none";

const BASE_BANDS: Record<BaseBandId, RatingBand> = {
  "9-10": { id: "9-10", label: "9.0 及以上", min: 9.0, max: 10.001 },
  "8-9": { id: "8-9", label: "8.0 – 8.9", min: 8.0, max: 9.0 },
  "7-8": { id: "7-8", label: "7.0 – 7.9", min: 7.0, max: 8.0 },
  "0-7": { id: "0-7", label: "7.0 以下", min: 0.0, max: 7.0 },
  none: { id: "none", label: "无评分", min: null, max: null },
};

/** 0.5 细拆；仅当对应基础档 >80 时启用。 */
const SPLIT_MAP: Record<"8-9" | "7-8", RatingBand[]> = {
  "8-9": [
    { id: "8.5-9", label: "8.5 – 8.9", min: 8.5, max: 9.0 },
    { id: "8-8.5", label: "8.0 – 8.4", min: 8.0, max: 8.5 },
  ],
  "7-8": [
    { id: "7.5-8", label: "7.5 – 7.9", min: 7.5, max: 8.0 },
    { id: "7-7.5", label: "7.0 – 7.4", min: 7.0, max: 7.5 },
  ],
};

/** 选择性细拆的档。 */
const SPLITTABLE_BASE_IDS: Array<"8-9" | "7-8"> = ["8-9", "7-8"];

/** 基础档展示顺序（高 → 低 → 无评分）。 */
const BASE_ORDER: BaseBandId[] = ["9-10", "8-9", "7-8", "0-7", "none"];

const SPLIT_THRESHOLD = 80;

const VALID_IDS = new Set<RatingBandId>([
  "9-10",
  "8-9",
  "8.5-9",
  "8-8.5",
  "7-8",
  "7.5-8",
  "7-7.5",
  "0-7",
  "none",
]);

export function isValidBandId(v: unknown): v is RatingBandId {
  return typeof v === "string" && VALID_IDS.has(v as RatingBandId);
}

export function classifyBaseBand(rating: number | null): BaseBandId {
  if (rating == null) return "none";
  if (rating >= 9.0) return "9-10";
  if (rating >= 8.0) return "8-9";
  if (rating >= 7.0) return "7-8";
  return "0-7";
}

/** 将评分精确映射到 0.5 子档；rating 必须落在基础档范围内。 */
function classifySubBand(base: "8-9" | "7-8", rating: number): RatingBandId {
  if (base === "8-9") return rating >= 8.5 ? "8.5-9" : "8-8.5";
  return rating >= 7.5 ? "7.5-8" : "7-7.5";
}

export type BandList = {
  /** 最终展示的 Tab（有计数，保持顺序） */
  bands: RatingBand[];
  /** 每个档的数量（仅包含会展示的档 id） */
  counts: Record<string, number>;
  /** 每个作品归属的档 id（基础或细拆后的叶子档） */
  bandIdByWorkId: Map<number, RatingBandId>;
};

/**
 * 计算合集里每一档的数量，并决定是否 0.5 细拆（>80 触发）。
 * 细拆后 **不再展示基础档**（避免冗余）。空档不展示。
 */
export function computeBandsForWorks(works: MediaWorkCard[]): BandList {
  const baseCounts: Record<BaseBandId, number> = {
    "9-10": 0,
    "8-9": 0,
    "7-8": 0,
    "0-7": 0,
    none: 0,
  };
  const baseById = new Map<number, BaseBandId>();
  for (const w of works) {
    const b = classifyBaseBand(w.doubanRating);
    baseCounts[b] += 1;
    baseById.set(w.id, b);
  }

  const splitEnabled: Record<"8-9" | "7-8", boolean> = {
    "8-9": baseCounts["8-9"] > SPLIT_THRESHOLD,
    "7-8": baseCounts["7-8"] > SPLIT_THRESHOLD,
  };

  const subCounts: Partial<Record<RatingBandId, number>> = {};
  const bandIdByWorkId = new Map<number, RatingBandId>();

  for (const w of works) {
    const base = baseById.get(w.id)!;
    if ((base === "8-9" || base === "7-8") && splitEnabled[base]) {
      const sub = classifySubBand(base, w.doubanRating as number);
      subCounts[sub] = (subCounts[sub] ?? 0) + 1;
      bandIdByWorkId.set(w.id, sub);
    } else {
      bandIdByWorkId.set(w.id, base);
    }
  }

  const bands: RatingBand[] = [];
  const counts: Record<string, number> = {};
  for (const base of BASE_ORDER) {
    if (SPLITTABLE_BASE_IDS.includes(base as "8-9" | "7-8") && splitEnabled[base as "8-9" | "7-8"]) {
      for (const sub of SPLIT_MAP[base as "8-9" | "7-8"]) {
        const c = subCounts[sub.id] ?? 0;
        if (c > 0) {
          bands.push(sub);
          counts[sub.id] = c;
        }
      }
    } else {
      const c = baseCounts[base];
      if (c > 0) {
        bands.push(BASE_BANDS[base]);
        counts[base] = c;
      }
    }
  }

  return { bands, counts, bandIdByWorkId };
}

/** 默认 Tab：按展示顺序选第一个非空档的 id。 */
export function pickDefaultBand(bandList: BandList): RatingBandId | null {
  return bandList.bands[0]?.id ?? null;
}

export function filterWorksByBand(
  works: MediaWorkCard[],
  bandList: BandList,
  bandId: RatingBandId
): MediaWorkCard[] {
  return works.filter((w) => bandList.bandIdByWorkId.get(w.id) === bandId);
}

/** 档内排序：优先 douban_rating desc；同分按 updatedAt desc（当前无 updatedAt 字段在卡里，用 id desc 作稳定兜底）。
 *  「无评分」档仅保留原顺序。 */
export function sortWorksForBand(works: MediaWorkCard[], bandId: RatingBandId): MediaWorkCard[] {
  if (bandId === "none") return works;
  return [...works].sort((a, b) => {
    const ra = a.doubanRating ?? -Infinity;
    const rb = b.doubanRating ?? -Infinity;
    if (rb !== ra) return rb - ra;
    return b.id - a.id;
  });
}
