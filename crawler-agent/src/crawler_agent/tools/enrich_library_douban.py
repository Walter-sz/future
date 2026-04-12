"""Update Walter ``media_work`` + sidecar metadata JSON from Douban via CrawlerAgent graph (standalone, no agent-media)."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import get_settings
from crawler_agent.graphs.douban_subject import run_douban_resolve_by_title
from crawler_agent.tools.gemini_series_search import (
    gemini_resolve_series_search_title,
    planned_douban_search_titles,
    strip_tv_season_display_zh,
)


def _repo_future_root() -> Path:
    """``future/`` when this file lives under ``future/crawler-agent/src/crawler_agent/tools/...``."""
    return Path(__file__).resolve().parents[4]


def walter_data_dir() -> Path:
    raw = os.environ.get("WALTER_DATA_DIR")
    if raw:
        return Path(raw).resolve()
    return _repo_future_root() / "walter_data"


def app_db_path() -> Path:
    return walter_data_dir() / "app.db"


def metadata_dir() -> Path:
    d = walter_data_dir() / "media" / "metadata"
    d.mkdir(parents=True, exist_ok=True)
    return d


def slugify(title: str) -> str:
    s = title.strip().lower().replace(" ", "-").replace("_", "-")
    s = re.sub(r"[\s/]+", "-", s)
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff-]", "", s)
    return s or "unknown"


def split_canonical_title(canonical: str | None) -> tuple[str, str]:
    s = (canonical or "").strip()
    if not s:
        return "", ""
    m = re.match(r"^(.+?)\s+([A-Za-z0-9].*)$", s, re.DOTALL)
    if m:
        zh, en = m.group(1).strip(), m.group(2).strip()
        if zh and en:
            return zh, en
    return s, ""


def _year_int(year_raw: Any) -> int | None:
    if year_raw is None:
        return None
    s = str(year_raw).strip().strip("()（） ")
    if not s:
        return None
    m = re.search(r"(19|20)\d{2}", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def _poster_url(sd: dict[str, Any], cover_cache_dir: Path) -> str | None:
    """优先同域代理 URL（Portal `/api/media/douban-cover/<id>`），避免豆瓣图床防盗链导致网页不显示。"""
    did = sd.get("doubanId")
    if did is not None:
        sid = str(did).strip()
        if sid.isdigit() and len(sid) >= 5:
            base = cover_cache_dir.resolve()
            for ext in (".webp", ".jpg", ".jpeg", ".png"):
                if (base / f"{sid}{ext}").is_file():
                    return f"/api/media/douban-cover/{sid}"
    for k in ("coverUrlCached", "coverUrl"):
        v = sd.get(k)
        if isinstance(v, str) and v.startswith(("http://", "https://")):
            return v.strip()
    return None


def _media_type(kind_hint: str) -> str:
    if kind_hint == "tv":
        return "tv"
    return "movie"


def _strip_tv_season_en(en: str, *, is_tv: bool) -> str:
    if not is_tv or not (en or "").strip():
        return (en or "").strip()
    return re.sub(r"\s+Season\s*\d+\s*$", "", en.strip(), flags=re.IGNORECASE).strip()


def subject_data_to_update(sd: dict[str, Any], *, kind_hint: str, cover_cache_dir: Path) -> dict[str, Any]:
    is_tv = _media_type(kind_hint) == "tv"
    zh, en = split_canonical_title(sd.get("canonicalTitle"))
    if not zh and sd.get("canonicalTitle"):
        zh = str(sd["canonicalTitle"]).strip()
    zh = strip_tv_season_display_zh(zh, is_tv=is_tv)
    en = _strip_tv_season_en(en, is_tv=is_tv)
    directors = sd.get("directors") if isinstance(sd.get("directors"), list) else []
    casts = sd.get("casts") if isinstance(sd.get("casts"), list) else []
    countries = sd.get("countries") if isinstance(sd.get("countries"), list) else []
    languages = sd.get("languages") if isinstance(sd.get("languages"), list) else []

    normalized = f"{zh} {en}".strip() or zh
    search_bits = [zh, en, sd.get("summary") or "", " ".join(str(x) for x in directors), " ".join(str(x) for x in casts)]
    search_bits.append(" ".join(str(x) for x in countries))
    search_text = " ".join(x for x in search_bits if x).strip()

    return {
        "title_zh": zh or "",
        "title_en": en or "",
        "normalized_title": normalized,
        "media_type": _media_type(kind_hint),
        "year": _year_int(sd.get("year")),
        "country": ", ".join(str(x) for x in countries) if countries else None,
        "language": ", ".join(str(x) for x in languages) if languages else None,
        "douban_rating": sd.get("doubanRating"),
        "summary": sd.get("summary") if isinstance(sd.get("summary"), str) else None,
        "directors_json": json.dumps([str(x) for x in directors], ensure_ascii=False),
        "actors_json": json.dumps([str(x) for x in casts], ensure_ascii=False),
        "poster_url": _poster_url(sd, cover_cache_dir),
        "match_status": "matched",
        "search_text": search_text,
    }


def _nas_library_root() -> str:
    return (os.environ.get("NAS_LIBRARY_ROOT") or "/volume1/homes/影视资源库").strip().rstrip("/") or "/"


def load_all_library_entries(
    db_path: Path,
    *,
    nas_root: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    skip_if_douban_rating: bool = False,
) -> list[dict[str, Any]]:
    """与 Portal ``whereNasPathIsIndexedLibrary`` 一致：资源库路径下、排除待入库。"""
    root = (nas_root or _nas_library_root()).strip().rstrip("/") or "/"
    like = f"{root}/%"
    conn = sqlite3.connect(str(db_path))
    try:
        where_skip = ""
        params: list[Any] = [root, like]
        if skip_if_douban_rating:
            where_skip = " AND douban_rating IS NULL "
        lim_sql = ""
        if limit is not None and limit > 0:
            lim_sql = " LIMIT ? OFFSET ? "
            params.extend([limit, offset])
        elif offset > 0:
            lim_sql = " LIMIT -1 OFFSET ? "
            params.append(offset)
        sql = f"""
          SELECT
            COALESCE(NULLIF(TRIM(title_zh), ''), NULLIF(TRIM(normalized_title), ''), nas_library_path) AS q,
            LOWER(COALESCE(media_type, 'movie')) AS mt,
            nas_library_path
          FROM media_work
          WHERE COALESCE(nas_library_path, '') NOT LIKE '%影视资源待入库%'
            AND (nas_library_path = ? OR nas_library_path LIKE ?)
            {where_skip}
          ORDER BY id ASC
          {lim_sql}
        """
        cur = conn.execute(sql, tuple(params))
        rows = cur.fetchall()
    finally:
        conn.close()

    out: list[dict[str, Any]] = []
    for q, mt, nas in rows:
        st = (q or "").strip()
        if not st:
            continue
        kh = "tv" if (mt or "") == "tv" else "movie"
        out.append({"search_title": st, "nas_library_path": str(nas).strip(), "kind_hint": kh})
    return out


def load_config(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    if not isinstance(data, dict) or "entries" not in data:
        raise ValueError("配置文件须为 { entries: [ ... ] } 结构")
    entries = data["entries"]
    if not isinstance(entries, list) or not entries:
        raise ValueError("entries 须为非空数组")
    out: list[dict[str, Any]] = []
    for i, row in enumerate(entries):
        if not isinstance(row, dict):
            raise ValueError(f"entries[{i}] 须为对象")
        st = row.get("search_title")
        nas = row.get("nas_library_path")
        kh = str(row.get("kind_hint", "auto")).strip().lower()
        if not isinstance(st, str) or not st.strip():
            raise ValueError(f"entries[{i}].search_title 必填")
        if not isinstance(nas, str) or not nas.strip():
            raise ValueError(f"entries[{i}].nas_library_path 必填")
        if kh not in ("auto", "movie", "tv"):
            raise ValueError(f"entries[{i}].kind_hint 须为 auto|movie|tv")
        out.append({"search_title": st.strip(), "nas_library_path": nas.strip(), "kind_hint": kh})
    return out


def load_previous_metadata_json(metadata_path: str | None) -> dict[str, Any]:
    if not metadata_path:
        return {}
    p = Path(metadata_path)
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def build_merged_metadata(
    previous: dict[str, Any],
    sd: dict[str, Any],
    *,
    nas_library_path: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    merged: dict[str, Any] = {**previous}
    merged.update(
        {
            "titleZh": patch["title_zh"],
            "titleEn": patch["title_en"],
            "normalizedTitle": patch["normalized_title"],
            "mediaType": patch["media_type"],
            "year": patch["year"],
            "country": patch["country"],
            "language": patch["language"],
            "doubanRating": patch["douban_rating"],
            "summary": patch["summary"],
            "directors": json.loads(patch["directors_json"]),
            "actors": json.loads(patch["actors_json"]),
            "posterUrl": patch["poster_url"],
            "matchStatus": patch["match_status"],
        }
    )
    merged["doubanId"] = sd.get("doubanId")
    merged["doubanGenres"] = sd.get("genres")
    merged["doubanWriters"] = sd.get("writers")
    merged["doubanRatingCount"] = sd.get("ratingCount")
    merged["coverHttpPath"] = sd.get("coverHttpPath")
    merged["coverLocalPath"] = sd.get("coverLocalPath")
    merged["coverSaveMode"] = sd.get("coverSaveMode")
    merged["coverUrlCached"] = sd.get("coverUrlCached")
    merged["doubanFetchedAt"] = sd.get("fetchedAt")
    merged["targetPath"] = nas_library_path
    merged["doubanEnrich"] = {"source": "crawler-agent enrich_library_douban", "subjectData": sd}
    merged["generatedAt"] = datetime.now(timezone.utc).isoformat()
    return merged


def run_fix_tv_display_titles_in_db() -> int:
    """去掉已入库剧集 title_zh 中的「第X季」等后缀（不调用豆瓣）。"""
    dbp = app_db_path()
    if not dbp.is_file():
        print(f"未找到数据库: {dbp}", flush=True)
        return 2
    conn = sqlite3.connect(str(dbp))
    now_ms = int(time.time() * 1000)
    changed = 0
    rows: list[tuple[Any, ...]] = []
    try:
        rows = conn.execute(
            "SELECT id, title_zh, title_en, normalized_title FROM media_work WHERE LOWER(media_type) = 'tv'"
        ).fetchall()
        for wid, zh, ten, norm in rows:
            zh = zh or ""
            ten = ten or ""
            new_zh = strip_tv_season_display_zh(zh, is_tv=True)
            new_en = _strip_tv_season_en(ten, is_tv=True)
            new_norm = f"{new_zh} {new_en}".strip() or new_zh
            if new_zh != zh.strip() or new_en != ten.strip() or (norm or "").strip() != new_norm:
                conn.execute(
                    "UPDATE media_work SET title_zh = ?, title_en = ?, normalized_title = ?, updated_at = ? WHERE id = ?",
                    (new_zh, new_en, new_norm, now_ms, wid),
                )
                changed += 1
        conn.commit()
    finally:
        conn.close()
    print(f"[fix-tv-display] 已更新 {changed} 条剧集展示标题（共扫描 {len(rows)} 条 tv）", flush=True)
    return 0


async def process_one(
    bm: BrowserManager,
    *,
    search_title: str,
    kind_hint: str,
    nas_library_path: str,
    cover_cache_dir: Path,
    public_base_url: str | None,
    timeout_ms: int,
    force_headed: bool,
    dry_run: bool,
) -> None:
    dbp = app_db_path()
    if not dbp.is_file():
        raise FileNotFoundError(f"未找到 SQLite 数据库: {dbp}（请设置 WALTER_DATA_DIR）")

    conn = sqlite3.connect(str(dbp))
    try:
        cur = conn.execute(
            "SELECT id, metadata_path, title_zh FROM media_work WHERE nas_library_path = ? LIMIT 1",
            (nas_library_path,),
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        print(f"[skip] 无匹配行 nas_library_path={nas_library_path!r}")
        return

    work_id, metadata_path, title_zh_existing = row
    queries = planned_douban_search_titles(search_title)
    data = None
    urls: list[str] = []
    err: dict[str, Any] | None = None
    for qi, q in enumerate(queries):
        if qi:
            await asyncio.sleep(0.85)
        suffix = f" (尝试 {qi + 1}/{len(queries)})" if len(queries) > 1 and qi else ""
        print(
            f"[fetch] id={work_id} title={title_zh_existing!r} path={nas_library_path!r} "
            f"douban_query={q!r} kind={kind_hint}{suffix}",
            flush=True,
        )
        data, urls, err = await run_douban_resolve_by_title(
            bm,
            title=q,
            kind_hint=kind_hint,
            force_headed=force_headed,
            timeout_ms=timeout_ms,
            cover_cache_dir=cover_cache_dir,
            public_base_url=public_base_url,
        )
        if not err and data:
            break
    tried = set(queries)
    if (not data or err) and err and err.get("code") == "NOT_FOUND":
        g = gemini_resolve_series_search_title(search_title)
        if g and g not in tried:
            await asyncio.sleep(0.85)
            print(
                f"[fetch] id={work_id} title={title_zh_existing!r} path={nas_library_path!r} "
                f"douban_query={g!r} kind={kind_hint} (NOT_FOUND 后 Gemini 补试)",
                flush=True,
            )
            data, urls, err = await run_douban_resolve_by_title(
                bm,
                title=g,
                kind_hint=kind_hint,
                force_headed=force_headed,
                timeout_ms=timeout_ms,
                cover_cache_dir=cover_cache_dir,
                public_base_url=public_base_url,
            )
    if err:
        print(f"[error] 豆瓣失败: {err}")
        return
    if not data:
        print("[error] 豆瓣返回空 data")
        return

    patch = subject_data_to_update(data, kind_hint=kind_hint, cover_cache_dir=cover_cache_dir)
    prev = load_previous_metadata_json(metadata_path if isinstance(metadata_path, str) else None)
    merged = build_merged_metadata(prev, data, nas_library_path=nas_library_path, patch=patch)

    meta_dir = metadata_dir()
    fname = f"{slugify(patch['title_zh'] or search_title)}-{int(time.time() * 1000)}.json"
    new_meta_path = (meta_dir / fname).resolve()

    now_ms = int(time.time() * 1000)

    if dry_run:
        print("[dry-run] 将写入 metadata:", new_meta_path)
        print("[dry-run] 将 UPDATE:", json.dumps(patch, ensure_ascii=False, indent=2)[:800])
        return

    new_meta_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

    conn = sqlite3.connect(str(dbp))
    try:
        conn.execute(
            """
            UPDATE media_work SET
              title_zh = ?,
              title_en = ?,
              normalized_title = ?,
              media_type = ?,
              year = ?,
              country = ?,
              language = ?,
              douban_rating = ?,
              summary = ?,
              directors_json = ?,
              actors_json = ?,
              poster_url = ?,
              match_status = ?,
              search_text = ?,
              metadata_path = ?,
              updated_at = ?
            WHERE id = ?
            """,
            (
                patch["title_zh"],
                patch["title_en"],
                patch["normalized_title"],
                patch["media_type"],
                patch["year"],
                patch["country"],
                patch["language"],
                patch["douban_rating"],
                patch["summary"],
                patch["directors_json"],
                patch["actors_json"],
                patch["poster_url"],
                patch["match_status"],
                patch["search_text"],
                str(new_meta_path),
                now_ms,
                work_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"[ok] 已更新 id={work_id} metadata_path={new_meta_path}")
    if urls:
        print("     source_urls:", urls[:3])


async def amain(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="从豆瓣补全 Walter media_work 与 metadata JSON（独立流程）")
    parser.add_argument("--config", type=Path, default=None, help="YAML 配置（entries 列表）")
    parser.add_argument(
        "--all-library",
        action="store_true",
        help="从 app.db 读取资源库下全部电影/电视剧（与 Portal NAS_LIBRARY_ROOT 规则一致），用 title_zh 搜豆瓣",
    )
    parser.add_argument(
        "--nas-library-root",
        default=None,
        help="资源库根路径（默认环境变量 NAS_LIBRARY_ROOT 或 /volume1/homes/影视资源库）",
    )
    parser.add_argument("--limit", type=int, default=None, help="仅处理前 N 条（调试用）")
    parser.add_argument("--offset", type=int, default=0, help="跳过前 N 条（配合 limit 断点续跑）")
    parser.add_argument(
        "--skip-if-douban-rating",
        action="store_true",
        help="若已有 douban_rating 则跳过（适合补全缺口、节省已跑条目）",
    )
    parser.add_argument(
        "--fix-tv-display-titles-in-db",
        action="store_true",
        help="仅批量修正剧集 title_zh：去掉「第X季」等展示后缀（不访问豆瓣；与补全逻辑一致）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只拉豆瓣并打印，不写库")
    parser.add_argument("--force-headed", action=argparse.BooleanOptionalAction, default=True, help="是否 headed 浏览器（默认 true）")
    parser.add_argument("--timeout-ms", type=int, default=180_000)
    args = parser.parse_args(argv)

    if getattr(args, "fix_tv_display_titles_in_db", False):
        return run_fix_tv_display_titles_in_db()

    if args.all_library:
        dbp = app_db_path()
        if not dbp.is_file():
            print(f"未找到数据库: {dbp}", flush=True)
            return 2
        entries = load_all_library_entries(
            dbp,
            nas_root=args.nas_library_root,
            limit=args.limit,
            offset=args.offset,
            skip_if_douban_rating=args.skip_if_douban_rating,
        )
        print(f"[all-library] 共 {len(entries)} 条待处理（skip_douban_rating={args.skip_if_douban_rating}）", flush=True)
        if not entries:
            print("无条目，退出", flush=True)
            return 0
    elif args.config:
        cfg_path = args.config.expanduser().resolve()
        if not cfg_path.is_file():
            print(f"配置文件不存在: {cfg_path}", flush=True)
            return 2
        entries = load_config(cfg_path)
    else:
        parser.error("须指定 --config PATH 或 --all-library")
    settings = get_settings()
    public_base = settings.public_base_url or os.environ.get("CRAWLER_PUBLIC_BASE_URL")

    bm = BrowserManager(settings)
    failed = 0
    try:
        total = len(entries)
        for i, ent in enumerate(entries):
            if i:
                await asyncio.sleep(1.2)
            print(f"[{i + 1}/{total}] ", end="", flush=True)
            try:
                await process_one(
                    bm,
                    search_title=ent["search_title"],
                    kind_hint=ent["kind_hint"],
                    nas_library_path=ent["nas_library_path"],
                    cover_cache_dir=settings.cover_cache_dir,
                    public_base_url=public_base,
                    timeout_ms=args.timeout_ms,
                    force_headed=args.force_headed,
                    dry_run=args.dry_run,
                )
            except Exception as e:
                failed += 1
                print(
                    f"\n[exception] 本条中断，已跳过并继续下一条：{ent['search_title']!r} "
                    f"path={ent['nas_library_path']!r}\n  {type(e).__name__}: {e}",
                    flush=True,
                )
                traceback.print_exc(file=sys.stdout)
                await asyncio.sleep(2.0)
    finally:
        await bm.shutdown()
    if failed:
        print(f"\n[summary] 共 {total} 条，其中 {failed} 条因异常失败，其余已处理。", flush=True)
    return 1 if failed else 0


def main() -> None:
    raise SystemExit(asyncio.run(amain()))


if __name__ == "__main__":
    main()
