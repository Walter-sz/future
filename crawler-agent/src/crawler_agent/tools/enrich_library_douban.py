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
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import get_settings
from crawler_agent.graphs.douban_subject import run_douban_resolve_by_title

# 豆瓣补全默认走局域网 crawler-agent HTTP（可用 CRAWLER_AGENT_URL 覆盖）；``--local-douban`` 时用本机 Playwright。
DEFAULT_CRAWLER_AGENT_URL = "http://192.168.124.24:5533"
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
    only_incomplete_douban: bool = False,
) -> list[dict[str, Any]]:
    """与 Portal ``whereNasPathIsIndexedLibrary`` 一致：资源库路径下、排除待入库。"""
    root = (nas_root or _nas_library_root()).strip().rstrip("/") or "/"
    like = f"{root}/%"
    conn = sqlite3.connect(str(db_path))
    try:
        where_skip = ""
        params: list[Any] = [root, like]
        if skip_if_douban_rating or only_incomplete_douban:
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


def _meta_source_urls_from_task_payload(payload: dict[str, Any]) -> list[str]:
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        return []
    su = meta.get("source_urls")
    return [str(x) for x in su] if isinstance(su, list) else []


def run_douban_resolve_http_sync(
    base_url: str,
    *,
    title: str,
    kind_hint: str,
    api_key: str | None,
    timeout_s: float,
) -> tuple[dict[str, Any] | None, list[str], dict[str, Any] | None]:
    """同步调用局域网 crawler-agent ``POST /v1/tasks/run``（由 asyncio.to_thread 包装）。"""
    url = base_url.rstrip("/") + "/v1/tasks/run"
    body = {
        "site": "douban",
        "task": "subject.resolve_by_title",
        "params": {"title": title, "kind_hint": kind_hint},
    }
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=raw, method="POST", headers={"Content-Type": "application/json"})
    if api_key:
        req.add_header("X-Api-Key", api_key)
    try:
        with urllib.request.urlopen(req, timeout=max(20.0, timeout_s)) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", errors="replace"))
        except (json.JSONDecodeError, TypeError, OSError):
            return None, [], {"code": "HTTP_ERROR", "message": f"HTTP {e.code}: {e.reason}"[:400]}
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        return None, [], {"code": "HTTP_TRANSPORT", "message": str(e)[:400]}

    if not isinstance(payload, dict):
        return None, [], {"code": "BAD_RESPONSE", "message": "任务响应不是 JSON 对象"}
    if not payload.get("ok"):
        err_o = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        return None, _meta_source_urls_from_task_payload(payload), {
            "code": str(err_o.get("code", "TASK_FAILED")),
            "message": str(err_o.get("message", ""))[:500],
        }
    data = payload.get("data")
    if not isinstance(data, dict):
        return None, _meta_source_urls_from_task_payload(payload), {"code": "EMPTY_DATA", "message": "任务 data 为空"}
    return data, _meta_source_urls_from_task_payload(payload), None


def ensure_cover_downloaded_local(sd: dict[str, Any], cover_cache_dir: Path) -> None:
    """将 ``coverUrlCached`` / ``coverUrl`` 拉取到本机 ``data/covers``，供 ``_poster_url`` 命中。"""
    did = sd.get("doubanId")
    if did is None:
        return
    sid = str(did).strip()
    if not sid.isdigit():
        return
    cover_cache_dir.mkdir(parents=True, exist_ok=True)
    for ext in (".webp", ".jpg", ".jpeg", ".png"):
        if (cover_cache_dir / f"{sid}{ext}").is_file():
            return
    url = sd.get("coverUrlCached") if isinstance(sd.get("coverUrlCached"), str) else None
    if not url or not url.startswith(("http://", "https://")):
        url = sd.get("coverUrl") if isinstance(sd.get("coverUrl"), str) else None
    if not url or not url.startswith(("http://", "https://")):
        return
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Walter-enrich-library-douban/1.0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            blob = r.read()
        if len(blob) > 3 and blob[:3] == b"\xff\xd8\xff":
            (cover_cache_dir / f"{sid}.jpg").write_bytes(blob)
        else:
            (cover_cache_dir / f"{sid}.webp").write_bytes(blob)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        pass


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
    bm: BrowserManager | None,
    *,
    use_http: bool,
    crawler_agent_base: str | None,
    crawler_api_key: str | None,
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
    timeout_s = min(900.0, max(15.0, timeout_ms / 1000.0 + 20.0))
    backend = "http" if (use_http and crawler_agent_base) else "local"

    async def _resolve_one_query(q: str) -> tuple[dict[str, Any] | None, list[str], dict[str, Any] | None]:
        if use_http and crawler_agent_base:
            return await asyncio.to_thread(
                run_douban_resolve_http_sync,
                crawler_agent_base,
                title=q,
                kind_hint=kind_hint,
                api_key=crawler_api_key,
                timeout_s=timeout_s,
            )
        if bm is None:
            return None, [], {"code": "NO_BROWSER", "message": "未启用 HTTP 且 BrowserManager 为空"}
        return await run_douban_resolve_by_title(
            bm,
            title=q,
            kind_hint=kind_hint,
            force_headed=force_headed,
            timeout_ms=timeout_ms,
            cover_cache_dir=cover_cache_dir,
            public_base_url=public_base_url,
        )

    for qi, q in enumerate(queries):
        if qi:
            await asyncio.sleep(0.85)
        suffix = f" (尝试 {qi + 1}/{len(queries)})" if len(queries) > 1 and qi else ""
        print(
            f"[fetch] id={work_id} title={title_zh_existing!r} path={nas_library_path!r} "
            f"douban_query={q!r} kind={kind_hint} backend={backend}{suffix}",
            flush=True,
        )
        data, urls, err = await _resolve_one_query(q)
        if not err and data:
            break
    tried = set(queries)
    if (not data or err) and err and err.get("code") == "NOT_FOUND":
        g = gemini_resolve_series_search_title(search_title)
        if g and g not in tried:
            await asyncio.sleep(0.85)
            print(
                f"[fetch] id={work_id} title={title_zh_existing!r} path={nas_library_path!r} "
                f"douban_query={g!r} kind={kind_hint} backend={backend} (NOT_FOUND 后 Gemini 补试)",
                flush=True,
            )
            data, urls, err = await _resolve_one_query(g)
    if err:
        print(f"[error] 豆瓣失败: {err}")
        return
    if not data:
        print("[error] 豆瓣返回空 data")
        return

    if use_http and not dry_run:
        ensure_cover_downloaded_local(data, cover_cache_dir)

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
        help="仅处理 douban_rating 为空的条目（与 --only-incomplete-douban 二选一或并存，语义相同）",
    )
    parser.add_argument(
        "--only-incomplete-douban",
        action="store_true",
        help="与 --all-library 联用：仅补全尚无豆瓣评分的电影/电视剧（推荐）",
    )
    parser.add_argument(
        "--crawler-agent-url",
        default=None,
        help="豆瓣解析 HTTP 基址（默认环境变量 CRAWLER_AGENT_URL，否则 http://192.168.124.24:5533）",
    )
    parser.add_argument(
        "--local-douban",
        action="store_true",
        help="不调用局域网 crawler-agent，改用本机 Playwright（需已安装 Chromium）",
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

    if args.all_library and not (args.only_incomplete_douban or args.skip_if_douban_rating):
        parser.error(
            "与 --all-library 批量补全时须指定 --only-incomplete-douban 或 --skip-if-douban-rating，"
            "以免对已写入 douban_rating 的条目全量重跑"
        )

    if args.all_library:
        dbp = app_db_path()
        if not dbp.is_file():
            print(f"未找到数据库: {dbp}", flush=True)
            return 2
        only_inc = bool(args.only_incomplete_douban or args.skip_if_douban_rating)
        entries = load_all_library_entries(
            dbp,
            nas_root=args.nas_library_root,
            limit=args.limit,
            offset=args.offset,
            skip_if_douban_rating=args.skip_if_douban_rating,
            only_incomplete_douban=args.only_incomplete_douban,
        )
        print(
            f"[all-library] 共 {len(entries)} 条待处理（only_incomplete_douban={only_inc}）",
            flush=True,
        )
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

    use_http = not args.local_douban
    raw_url = (args.crawler_agent_url or os.environ.get("CRAWLER_AGENT_URL") or "").strip()
    crawler_base = None if args.local_douban else (raw_url or DEFAULT_CRAWLER_AGENT_URL).rstrip("/")
    crawler_api_key = (os.environ.get("CRAWLER_API_KEY") or "").strip() or None

    if use_http:
        print(f"[enrich] 豆瓣后端: HTTP {crawler_base}", flush=True)
    else:
        print("[enrich] 豆瓣后端: 本机 Playwright（--local-douban）", flush=True)

    bm: BrowserManager | None = BrowserManager(settings) if args.local_douban else None
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
                    use_http=use_http,
                    crawler_agent_base=crawler_base,
                    crawler_api_key=crawler_api_key,
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
        if bm is not None:
            await bm.shutdown()
    if failed:
        print(f"\n[summary] 共 {total} 条，其中 {failed} 条因异常失败，其余已处理。", flush=True)
    return 1 if failed else 0


def main() -> None:
    raise SystemExit(asyncio.run(amain()))


if __name__ == "__main__":
    main()
