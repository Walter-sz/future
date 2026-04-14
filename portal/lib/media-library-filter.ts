import { and, eq, like, not, or, sql, type SQL } from "drizzle-orm";
import { mediaWork } from "@/lib/db/schema";

/** 与 agent-media 默认一致；部署时建议 Portal 与 Agent 同配 `NAS_LIBRARY_ROOT` */
export function getNasLibraryRootForFilter(): string {
  const raw = process.env.NAS_LIBRARY_ROOT || "/volume1/homes/影视资源库";
  return raw.replace(/\/+$/, "") || "/";
}

/**
 * 列表/合集/搜索只展示「资源库」索引：排除待入库路径及历史误写入的 NAS 路径。
 */
export function whereNasPathIsIndexedLibrary(): SQL {
  const root = getNasLibraryRootForFilter();
  return and(
    sql`coalesce(${mediaWork.nasLibraryPath}, '') not like ${"%影视资源待入库%"}`,
    or(eq(mediaWork.nasLibraryPath, root), like(mediaWork.nasLibraryPath, `${root}/%`))
  ) as SQL;
}

/**
 * 单行判定，与 {@link whereNasPathIsIndexedLibrary} 的筛选语义一致（详情页等）。
 */
export function isNasLibraryPathIndexedPlayable(nasPath: string | null | undefined): boolean {
  const p = (nasPath ?? "").trim();
  if (!p || p.includes("影视资源待入库")) return false;
  const root = getNasLibraryRootForFilter();
  return p === root || p.startsWith(`${root}/`);
}

/** TMDB 常用 GB；部分数据或 Gemini 会写 UK / United Kingdom / 英国 */
export function sqlTvOriginLooksUk(): SQL {
  return sql`(
    lower(coalesce(${mediaWork.country}, '')) like '%gb%'
    or coalesce(${mediaWork.country}, '') like '%英国%'
    or lower(coalesce(${mediaWork.country}, '')) like '%united kingdom%'
    or trim(coalesce(${mediaWork.country}, '')) in ('UK', 'Uk', 'uK', 'uk')
    or ${mediaWork.country} like 'UK,%'
    or ${mediaWork.country} like '%,UK'
    or ${mediaWork.country} like '%,UK,%'
  )`;
}

export function sqlTvOriginLooksUs(): SQL {
  return sql`(
    coalesce(${mediaWork.country}, '') like '%US%'
    or coalesce(${mediaWork.country}, '') like '%美国%'
    or lower(coalesce(${mediaWork.country}, '')) like '%usa%'
  )`;
}

/** 美、英以外常见产地（可与美剧/英剧重叠，如美加合拍） */
export const TV_EXTRA_COUNTRY_ORIGIN_SLUGS = [
  "ca-tv",
  "au-tv",
  "jp-tv",
  "kr-tv",
  "cn-tv",
  "fr-tv",
  "de-tv",
  "it-tv",
  "es-tv",
] as const;

export type TvExtraCountryOriginSlug = (typeof TV_EXTRA_COUNTRY_ORIGIN_SLUGS)[number];

const c = mediaWork.country;

/** 加拿大（含与美/英合拍中标注加拿大） */
export function sqlTvOriginLooksCanada(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%canada%'
    or coalesce(${c}, '') like '%加拿大%'
    or coalesce(${c}, '') like 'CA'
    or ${c} like 'CA,%'
    or ${c} like '%,CA'
    or ${c} like '%, CA%'
    or ${c} like '%CA,%'
  )`;
}

export function sqlTvOriginLooksAustralia(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%australia%'
    or coalesce(${c}, '') like '%澳大利亚%'
    or ${c} like 'AU'
    or ${c} like 'AU,%'
    or ${c} like '%,AU'
    or ${c} like '%, AU%'
    or ${c} like '%AU,%'
  )`;
}

export function sqlTvOriginLooksJapan(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%japan%'
    or coalesce(${c}, '') like '%日本%'
    or ${c} like 'JP'
    or ${c} like 'JP,%'
    or ${c} like '%,JP'
    or ${c} like '%, JP%'
    or ${c} like '%JP,%'
  )`;
}

export function sqlTvOriginLooksSouthKorea(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%south korea%'
    or lower(coalesce(${c}, '')) like '%republic of korea%'
    or lower(coalesce(${c}, '')) like '%korea, republic%'
    or coalesce(${c}, '') like '%韩国%'
    or coalesce(${c}, '') like '%南韩%'
    or ${c} like 'KR'
    or ${c} like 'KR,%'
    or ${c} like '%,KR'
    or ${c} like '%, KR%'
    or ${c} like '%KR,%'
  )`;
}

export function sqlTvOriginLooksChina(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%china%'
    or coalesce(${c}, '') like '%中国%'
    or coalesce(${c}, '') like '%大陆%'
    or ${c} like 'CN'
    or ${c} like 'CN,%'
    or ${c} like '%,CN'
    or ${c} like '%, CN%'
    or ${c} like '%CN,%'
  )`;
}

export function sqlTvOriginLooksFrance(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%france%'
    or coalesce(${c}, '') like '%法国%'
    or ${c} like 'FR'
    or ${c} like 'FR,%'
    or ${c} like '%,FR'
    or ${c} like '%, FR%'
    or ${c} like '%FR,%'
  )`;
}

export function sqlTvOriginLooksGermany(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%germany%'
    or coalesce(${c}, '') like '%德国%'
    or ${c} like 'DE'
    or ${c} like 'DE,%'
    or ${c} like '%,DE'
    or ${c} like '%, DE%'
    or ${c} like '%DE,%'
  )`;
}

export function sqlTvOriginLooksItaly(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%italy%'
    or coalesce(${c}, '') like '%意大利%'
    or ${c} like 'IT'
    or ${c} like 'IT,%'
    or ${c} like '%,IT'
    or ${c} like '%, IT%'
    or ${c} like '%IT,%'
  )`;
}

export function sqlTvOriginLooksSpain(): SQL {
  return sql`(
    lower(coalesce(${c}, '')) like '%spain%'
    or coalesce(${c}, '') like '%西班牙%'
    or ${c} like 'ES'
    or ${c} like 'ES,%'
    or ${c} like '%,ES'
    or ${c} like '%, ES%'
    or ${c} like '%ES,%'
  )`;
}

export function isTvExtraCountryOriginSlug(slug: string): slug is TvExtraCountryOriginSlug {
  return (TV_EXTRA_COUNTRY_ORIGIN_SLUGS as readonly string[]).includes(slug);
}

export function tvExtraCountryOriginCondition(slug: TvExtraCountryOriginSlug): SQL {
  switch (slug) {
    case "ca-tv":
      return sqlTvOriginLooksCanada();
    case "au-tv":
      return sqlTvOriginLooksAustralia();
    case "jp-tv":
      return sqlTvOriginLooksJapan();
    case "kr-tv":
      return sqlTvOriginLooksSouthKorea();
    case "cn-tv":
      return sqlTvOriginLooksChina();
    case "fr-tv":
      return sqlTvOriginLooksFrance();
    case "de-tv":
      return sqlTvOriginLooksGermany();
    case "it-tv":
      return sqlTvOriginLooksItaly();
    case "es-tv":
      return sqlTvOriginLooksSpain();
  }
}

/** 未命中美、英及 TV_EXTRA 所列国家信号的剧集（其余进「其他剧集」） */
export function sqlTvOriginOtherTvResidual(): SQL {
  return and(
    not(sqlTvOriginLooksUs()),
    not(sqlTvOriginLooksUk()),
    not(sqlTvOriginLooksCanada()),
    not(sqlTvOriginLooksAustralia()),
    not(sqlTvOriginLooksJapan()),
    not(sqlTvOriginLooksSouthKorea()),
    not(sqlTvOriginLooksChina()),
    not(sqlTvOriginLooksFrance()),
    not(sqlTvOriginLooksGermany()),
    not(sqlTvOriginLooksItaly()),
    not(sqlTvOriginLooksSpain())
  ) as SQL;
}
