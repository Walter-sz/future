import { and, eq, like, or, sql, type SQL } from "drizzle-orm";
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
