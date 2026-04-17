/** 无 NAS 实体、仅豆瓣/元数据占位行使用的 nas_library_path 前缀（不在 NAS_LIBRARY_ROOT 下 → Portal「无资源」） */

const PREFIX = "meta:douban:";

const SUBJECT_ID_RE = /^\d{5,12}$/;

export function isDoubanMetadataNasPath(nasPath: string | null | undefined): boolean {
  const p = (nasPath ?? "").trim();
  return p.startsWith(PREFIX) && SUBJECT_ID_RE.test(p.slice(PREFIX.length));
}

/** 生成唯一占位路径，subjectId 须为豆瓣数字 id */
export function doubanMetadataNasPath(subjectId: string): string {
  const s = subjectId.trim();
  if (!SUBJECT_ID_RE.test(s)) {
    throw new Error(`invalid douban subject id: ${subjectId}`);
  }
  return `${PREFIX}${s}`;
}

/** 从占位路径解析豆瓣 id；非占位则返回 null */
export function parseDoubanSubjectIdFromNasPath(nasPath: string | null | undefined): string | null {
  const p = (nasPath ?? "").trim();
  if (!p.startsWith(PREFIX)) return null;
  const id = p.slice(PREFIX.length);
  return SUBJECT_ID_RE.test(id) ? id : null;
}
