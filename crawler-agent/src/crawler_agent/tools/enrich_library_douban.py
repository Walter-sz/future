"""Update Walter ``media_work`` + sidecar metadata JSON from Douban via CrawlerAgent graph (standalone, no agent-media)."""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
import re
import sqlite3
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
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


_LOCK_FILE_NAME = ".enrich.lock"


def acquire_enrich_lock(*, allow_concurrent: bool = False):
    """进程级独占锁，防止两个 enrich 同时打豆瓣后端导致结果跨请求串位（昨晚事故根因之一）。"""
    if allow_concurrent:
        print("[lock] --allow-concurrent 已开启，不获取互斥锁（请确认你确实需要并发）", flush=True)
        return None
    lock_dir = walter_data_dir()
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / _LOCK_FILE_NAME
    f = open(lock_path, "w", encoding="utf-8")
    try:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.close()
        print(
            f"[lock] 检测到 {lock_path} 已被另一个 enrich 持有；并发跑会导致豆瓣后端串结果。\n"
            f"  请等待该任务结束，或显式加 --allow-concurrent 强行跑（不推荐）。",
            flush=True,
        )
        sys.exit(2)
    f.write(f"pid={os.getpid()}\nstarted_at={int(time.time())}\n")
    f.flush()
    return f


def _normalize_for_compare(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", s.strip().lower(), flags=re.UNICODE)


def _has_token_overlap(a: str | None, b: str | None, min_len: int = 2) -> bool:
    """两个标题归一化后是否存在长度 >= min_len 的连续子串重叠。"""
    na = _normalize_for_compare(a)
    nb = _normalize_for_compare(b)
    if not na or not nb:
        return False
    short, long_ = (na, nb) if len(na) <= len(nb) else (nb, na)
    if short in long_:
        return True
    if len(short) < min_len:
        return False
    for i in range(len(short) - min_len + 1):
        if short[i : i + min_len] in long_:
            return True
    return False


def _expected_title_candidates(
    *,
    search_title: str | None,
    existing_title_zh: str | None,
    nas_library_path: str | None,
) -> list[str]:
    out: list[str] = []
    for v in (search_title, existing_title_zh):
        if v and v.strip():
            out.append(v.strip())
    if nas_library_path and not nas_library_path.startswith("meta:douban:"):
        base = nas_library_path.rstrip("/").rsplit("/", 1)[-1].strip()
        if base:
            out.append(base)
            for piece in base.split("_"):
                p = piece.strip()
                if p:
                    out.append(p)
    return out


def verify_resolved_title(
    *,
    returned_title_zh: str | None,
    returned_title_en: str | None,
    search_title: str | None,
    existing_title_zh: str | None = None,
    nas_library_path: str | None = None,
) -> tuple[bool, str]:
    """返回 (ok, 原因)。任一候选标题与豆瓣返回的中/英文名有 >=2 字符重叠即视为通过；都不沾边则拒绝。"""
    candidates = _expected_title_candidates(
        search_title=search_title,
        existing_title_zh=existing_title_zh,
        nas_library_path=nas_library_path,
    )
    returned_main = (returned_title_zh or "").strip() or (returned_title_en or "").strip()
    if not returned_main:
        return False, "豆瓣返回的标题为空"
    if not candidates:
        return True, "无对照标题可用，跳过校验"
    for cand in candidates:
        if _has_token_overlap(cand, returned_title_zh) or _has_token_overlap(cand, returned_title_en):
            return True, "ok"
    return False, (
        f"返回标题与请求/现有/路径标题完全无 2 字符重叠 "
        f"returned={returned_main!r} candidates={candidates!r}"
    )


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


"""Walter 使用豆瓣账号的启用下限；早于此日期的观看日期视为页面发行日期误解析。"""
_DOUBAN_SEEN_MIN_YMD = "2015-01-01"


def _douban_seen_day_to_utc_noon_sec(day: str | None) -> int | None:
    """豆瓣常见仅有日期；用 UTC 正午落库（秒级），避免时区边界显示成前一天。

    若 ``day`` 早于 :data:`_DOUBAN_SEEN_MIN_YMD` 或晚于今天 +1 天，视为非法，返回 ``None``，
    以保护已有 ``watched_at`` 不被页面上的发行日期/评论日期覆盖。
    """
    if not day or not isinstance(day, str):
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", day.strip())
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        dt = datetime(y, mo, d, 12, 0, 0, tzinfo=timezone.utc)
    except ValueError:
        return None
    if day.strip() < _DOUBAN_SEEN_MIN_YMD:
        return None
    if dt > datetime.now(timezone.utc) + timedelta(days=1):
        return None
    return int(dt.timestamp())


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


def subject_data_to_update(
    sd: dict[str, Any],
    *,
    kind_hint: str,
    cover_cache_dir: Path,
    sync_douban_watch: bool = True,
) -> dict[str, Any]:
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

    douban_subject_id: str | None = None
    did_raw = sd.get("doubanId")
    if did_raw is not None:
        sid = str(did_raw).strip()
        if sid.isdigit() and len(sid) >= 5:
            douban_subject_id = sid

    out: dict[str, Any] = {
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
        "douban_subject_id": douban_subject_id,
    }
    if sync_douban_watch and sd.get("doubanUserSeen") is True:
        out["watch_status"] = "watched"
        seen_day = sd.get("doubanSeenAt") if isinstance(sd.get("doubanSeenAt"), str) else None
        sec = _douban_seen_day_to_utc_noon_sec(seen_day)
        if sec is not None:
            out["watched_at_sec"] = sec
    return out


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


def load_movie_library_entries_by_min_douban_rating(
    db_path: Path,
    *,
    min_rating: float,
    nas_root: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    strict_greater_than: bool = False,
    seed_source: str = "nas",
) -> list[dict[str, Any]]:
    """已有豆瓣评分的电影，按评分降序（再按 id）选批次种子。

    比较符：默认 ``>= min_rating``；``strict_greater_than=True`` 时为严格 ``> min_rating``。
    seed_source：
      - ``"nas"``（默认）：只挑 NAS 资源库下的真实条目（与 Portal 列表一致）。
      - ``"placeholder"``：只挑 ``meta:douban:`` 占位条目（来自一跳扩散写入的、库里没有实体资源的电影）。
      - ``"all"``：上述两者并集。
    """
    if seed_source not in ("nas", "placeholder", "all"):
        raise ValueError("seed_source 须为 nas|placeholder|all")
    root = (nas_root or _nas_library_root()).strip().rstrip("/") or "/"
    nas_like = f"{root}/%"
    cmp_sql = ">" if strict_greater_than else ">="

    if seed_source == "nas":
        path_clause = "(nas_library_path = ? OR nas_library_path LIKE ?)"
        path_params: list[Any] = [root, nas_like]
    elif seed_source == "placeholder":
        path_clause = "nas_library_path LIKE 'meta:douban:%'"
        path_params = []
    else:
        path_clause = "(nas_library_path = ? OR nas_library_path LIKE ? OR nas_library_path LIKE 'meta:douban:%')"
        path_params = [root, nas_like]

    conn = sqlite3.connect(str(db_path))
    try:
        lim_sql = ""
        params: list[Any] = [*path_params, min_rating]
        if limit is not None and limit > 0:
            lim_sql = " LIMIT ? OFFSET ? "
            params.extend([limit, offset])
        elif offset > 0:
            lim_sql = " LIMIT -1 OFFSET ? "
            params.append(offset)
        sql = f"""
          SELECT
            COALESCE(NULLIF(TRIM(title_zh), ''), NULLIF(TRIM(normalized_title), ''), nas_library_path) AS q,
            nas_library_path
          FROM media_work
          WHERE COALESCE(nas_library_path, '') NOT LIKE '%影视资源待入库%'
            AND {path_clause}
            AND LOWER(COALESCE(media_type, 'movie')) = 'movie'
            AND douban_rating IS NOT NULL
            AND douban_rating {cmp_sql} ?
          ORDER BY douban_rating DESC, id ASC
          {lim_sql}
        """
        cur = conn.execute(sql, tuple(params))
        rows = cur.fetchall()
    finally:
        conn.close()

    out: list[dict[str, Any]] = []
    for q, nas in rows:
        st = (q or "").strip()
        if not st:
            continue
        out.append({"search_title": st, "nas_library_path": str(nas).strip(), "kind_hint": "movie"})
    return out


def load_config(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """返回 ``(entries, options)``。

    支持的根级字段（均可省略，由 CLI 覆盖）:

    - ``expand_recommendations``: bool
    - ``force_refresh_seeds``: bool，强制忽略「种子缓存已完整」判定，重跑豆瓣抓取
    - ``seed_cache_min_recommend``: int，判断「已完整」的推荐列表最小长度（默认 8）
    """
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    if not isinstance(data, dict) or "entries" not in data:
        raise ValueError("配置文件须为 { entries: [ ... ] } 结构")
    options: dict[str, Any] = {}
    raw_expand = data.get("expand_recommendations")
    if raw_expand is not None:
        if not isinstance(raw_expand, bool):
            raise ValueError("expand_recommendations 须为布尔值（可选）")
        options["expand_recommendations"] = raw_expand
    raw_force = data.get("force_refresh_seeds")
    if raw_force is not None:
        if not isinstance(raw_force, bool):
            raise ValueError("force_refresh_seeds 须为布尔值（可选）")
        options["force_refresh_seeds"] = raw_force
    raw_min = data.get("seed_cache_min_recommend")
    if raw_min is not None:
        if not isinstance(raw_min, int) or raw_min < 1:
            raise ValueError("seed_cache_min_recommend 须为 ≥1 的整数（可选）")
        options["seed_cache_min_recommend"] = raw_min
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
    return out, options


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
    if sd.get("doubanUserSeen") is not None:
        merged["doubanUserSeen"] = sd.get("doubanUserSeen")
    if sd.get("doubanSeenAt"):
        merged["doubanSeenAt"] = sd.get("doubanSeenAt")
    if sd.get("doubanUserCollectStatus"):
        merged["doubanUserCollectStatus"] = sd.get("doubanUserCollectStatus")
    rs = sd.get("recommendSameSubjects")
    if isinstance(rs, list) and rs:
        merged["doubanRecommendSameSubjects"] = rs[:10]
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


_DOUBAN_PLACEHOLDER_PREFIX = "meta:douban:"

_GENRE_SLUG_MAP: list[tuple[str, re.Pattern[str]]] = [
    ("action", re.compile(r"动作|action", re.I)),
    ("comedy", re.compile(r"喜剧|comedy", re.I)),
    ("drama", re.compile(r"剧情|drama", re.I)),
    ("sci-fi", re.compile(r"科幻|science\s*fiction|sci[-\s]?fi", re.I)),
    ("thriller", re.compile(r"惊悚|悬疑|thriller|suspense", re.I)),
    ("horror", re.compile(r"恐怖|horror", re.I)),
    ("animation", re.compile(r"动画|animation|anime", re.I)),
    ("war", re.compile(r"战争|war|military|二战|一战", re.I)),
    ("romance", re.compile(r"爱情|romance", re.I)),
    ("documentary", re.compile(r"纪录|documentary", re.I)),
    ("fantasy", re.compile(r"奇幻|fantasy", re.I)),
    ("crime", re.compile(r"犯罪|crime", re.I)),
    ("family", re.compile(r"家庭|family", re.I)),
    ("history", re.compile(r"历史|history", re.I)),
    ("mystery", re.compile(r"推理|mystery", re.I)),
    ("adventure", re.compile(r"冒险|adventure", re.I)),
    ("western", re.compile(r"西部|western", re.I)),
    ("music", re.compile(r"音乐|musical|music", re.I)),
    ("biography", re.compile(r"传记|biography|biopic", re.I)),
]


def _genres_to_slugs(genres: list[str]) -> list[str]:
    out: set[str] = set()
    for g in genres:
        t = (g or "").strip()
        if not t:
            continue
        for slug, pat in _GENRE_SLUG_MAP:
            if pat.search(t):
                out.add(slug)
    return sorted(out)


_EXTRA_TAG_SEEDS: list[tuple[str, str]] = [
    ("adventure", "冒险"),
    ("western", "西部"),
    ("music", "音乐"),
    ("biography", "传记"),
]


def _ensure_extra_tag_seeds(conn: sqlite3.Connection) -> None:
    for slug, name in _EXTRA_TAG_SEEDS:
        conn.execute("INSERT OR IGNORE INTO media_tag(slug, name) VALUES (?, ?)", (slug, name))


def _sync_work_tags(conn: sqlite3.Connection, work_id: int, slugs: list[str]) -> None:
    if not slugs:
        return
    _ensure_extra_tag_seeds(conn)
    for slug in slugs:
        row = conn.execute("SELECT id FROM media_tag WHERE slug = ?", (slug,)).fetchone()
        if row:
            conn.execute(
                "INSERT OR IGNORE INTO media_work_tag(work_id, tag_id) VALUES(?, ?)",
                (work_id, row[0]),
            )


def _douban_placeholder_nas_path(subject_id: str) -> str:
    return f"{_DOUBAN_PLACEHOLDER_PREFIX}{subject_id.strip()}"


"""判断「种子缓存已完整」所需的默认推荐区最小长度。"""
SEED_CACHE_MIN_RECOMMEND_DEFAULT = 8


def _is_blankish(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) == 0
    return False


def evaluate_seed_cache(
    conn: sqlite3.Connection,
    work_id: int,
    *,
    min_recommend: int,
) -> dict[str, Any]:
    """判断本条种子是否 **已充分抓取**，可跳过豆瓣抓取阶段。

    判定口径（任一条不满足 → miss）：

    1. ``media_work`` 主要字段齐全：``title_zh / year / douban_subject_id / douban_rating /
       summary / directors_json(≥1 项) / poster_url``
    2. ``metadata_path`` 指向可读文件
    3. metadata JSON 里 ``doubanRecommendSameSubjects`` 是列表，且其中有效条目（含数字
       ``subjectId`` + 非空 ``title``）≥ ``min_recommend``

    返回 ``{"hit": bool, "reasons": [...], "recs": [...], "title_zh": str | None}``。
    即使 ``hit=False``，若已能解析出部分推荐列表，仍会把 ``recs`` 一并返回，便于上层酌情使用。
    """
    row = conn.execute(
        "SELECT title_zh, year, douban_subject_id, douban_rating, summary, "
        "directors_json, poster_url, metadata_path "
        "FROM media_work WHERE id = ?",
        (work_id,),
    ).fetchone()
    if not row:
        return {"hit": False, "reasons": ["row_not_found"], "recs": [], "title_zh": None}
    title_zh, year, sid, rating, summary, directors_json, poster_url, mp = row
    reasons: list[str] = []
    if _is_blankish(title_zh):
        reasons.append("missing_title_zh")
    if year is None:
        reasons.append("missing_year")
    if _is_blankish(sid):
        reasons.append("missing_douban_subject_id")
    if rating is None:
        reasons.append("missing_douban_rating")
    if _is_blankish(summary):
        reasons.append("missing_summary")
    try:
        dirs = json.loads(directors_json or "[]")
    except (ValueError, TypeError):
        dirs = []
    if not (isinstance(dirs, list) and len(dirs) >= 1):
        reasons.append("missing_directors")
    if _is_blankish(poster_url):
        reasons.append("missing_poster_url")

    valid_recs: list[dict[str, str]] = []
    if not mp or not isinstance(mp, str) or not Path(mp).is_file():
        reasons.append("missing_metadata_file")
    else:
        try:
            meta = json.loads(Path(mp).read_text(encoding="utf-8"))
        except (ValueError, OSError):
            meta = None
            reasons.append("bad_metadata_json")
        if isinstance(meta, dict):
            recs_all = meta.get("doubanRecommendSameSubjects")
            if not isinstance(recs_all, list):
                reasons.append("no_recommend_list")
            else:
                for r in recs_all:
                    if not isinstance(r, dict):
                        continue
                    sid_r = str(r.get("subjectId", "")).strip()
                    ttl = str(r.get("title", "")).strip()
                    if sid_r.isdigit() and ttl:
                        entry = {"subjectId": sid_r, "title": ttl}
                        if isinstance(r.get("url"), str):
                            entry["url"] = r["url"]
                        valid_recs.append(entry)
                if len(valid_recs) < min_recommend:
                    reasons.append(f"recommend_count<{min_recommend}")

    return {
        "hit": not reasons,
        "reasons": reasons,
        "recs": valid_recs,
        "title_zh": title_zh,
    }


def _existing_douban_subject_ids(conn: sqlite3.Connection, sids: list[str]) -> set[str]:
    if not sids:
        return set()
    placeholders = ",".join("?" for _ in sids)
    rows = conn.execute(
        f"SELECT douban_subject_id FROM media_work WHERE douban_subject_id IN ({placeholders})",
        tuple(sids),
    ).fetchall()
    return {str(r[0]) for r in rows}


async def _expand_one_recommendation(
    bm: BrowserManager | None,
    *,
    use_http: bool,
    crawler_agent_base: str | None,
    crawler_api_key: str | None,
    rec: dict[str, str],
    cover_cache_dir: Path,
    public_base_url: str | None,
    timeout_ms: int,
    force_headed: bool,
    dry_run: bool,
    sync_douban_watch: bool,
) -> None:
    """抓取一条推荐条目的完整详情并 INSERT 占位行 + metadata JSON。"""
    sid = str(rec.get("subjectId", "")).strip()
    rec_title = str(rec.get("title", "")).strip()
    if not sid.isdigit() or len(sid) < 5 or not rec_title:
        return

    dbp = app_db_path()
    if not dbp.is_file():
        return

    timeout_s = min(900.0, max(15.0, timeout_ms / 1000.0 + 20.0))

    if use_http and crawler_agent_base:
        data, urls, err = await asyncio.to_thread(
            run_douban_resolve_http_sync,
            crawler_agent_base,
            title=rec_title,
            kind_hint="movie",
            api_key=crawler_api_key,
            timeout_s=timeout_s,
        )
    elif bm is not None:
        data, urls, err = await run_douban_resolve_by_title(
            bm,
            title=rec_title,
            kind_hint="movie",
            force_headed=force_headed,
            timeout_ms=timeout_ms,
            cover_cache_dir=cover_cache_dir,
            public_base_url=public_base_url,
        )
    else:
        print(f"  [rec-skip] 无浏览器: {rec_title!r}", flush=True)
        return

    if err or not data:
        print(f"  [rec-fail] {rec_title!r} sid={sid}: {err}", flush=True)
        return

    if use_http and not dry_run:
        ensure_cover_downloaded_local(data, cover_cache_dir)

    patch = subject_data_to_update(
        data, kind_hint="movie", cover_cache_dir=cover_cache_dir, sync_douban_watch=sync_douban_watch,
    )

    ok, reason = verify_resolved_title(
        returned_title_zh=patch.get("title_zh"),
        returned_title_en=patch.get("title_en"),
        search_title=rec_title,
    )
    returned_sid = str(patch.get("douban_subject_id") or "").strip()
    if not ok or (returned_sid and returned_sid != sid):
        why = reason if not ok else f"返回 sid={returned_sid} 与请求 sid={sid} 不一致"
        print(f"  [rec-guard] 拒绝写入：{rec_title!r} sid={sid} {why}", flush=True)
        return

    placeholder_nas = _douban_placeholder_nas_path(patch.get("douban_subject_id") or sid)
    merged = build_merged_metadata({}, data, nas_library_path=placeholder_nas, patch=patch)

    meta_dir = metadata_dir()
    fname = f"{slugify(patch['title_zh'] or rec_title)}-{int(time.time() * 1000)}.json"
    new_meta_path = (meta_dir / fname).resolve()
    now_ms = int(time.time() * 1000)

    if dry_run:
        ws = ""
        if patch.get("watch_status") == "watched":
            at = patch.get("watched_at_sec")
            if at is not None:
                from datetime import datetime as _dt, timezone as _tz
                ds = _dt.fromtimestamp(at, tz=_tz.utc).strftime("%Y-%m-%d")
                ws = f" watch=watched({ds})"
            else:
                ws = " watch=watched"
        print(
            f"  [rec-dry] {rec_title!r} sid={sid} rating={patch.get('douban_rating')}{ws}",
            flush=True,
        )
        return

    new_meta_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

    conn = sqlite3.connect(str(dbp))
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO media_work (
              title_zh, title_en, normalized_title, media_type, year,
              country, language, douban_rating, summary,
              directors_json, actors_json, poster_url,
              match_status, search_text, douban_subject_id,
              watch_status, watched_at,
              nas_library_path, metadata_path,
              created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
                patch["douban_subject_id"],
                patch.get("watch_status") or "unwatched",
                patch.get("watched_at_sec"),
                placeholder_nas,
                str(new_meta_path),
                now_ms,
                now_ms,
            ),
        )
        conn.commit()

        genres = data.get("genres") if isinstance(data.get("genres"), list) else []
        tag_slugs = _genres_to_slugs(genres)
        if tag_slugs:
            row_id = conn.execute(
                "SELECT id FROM media_work WHERE douban_subject_id = ?",
                (patch["douban_subject_id"],),
            ).fetchone()
            if row_id:
                _sync_work_tags(conn, row_id[0], tag_slugs)
                conn.commit()
    finally:
        conn.close()

    ws = ""
    if patch.get("watch_status") == "watched":
        extra = f" watched_at_sec={patch['watched_at_sec']}" if patch.get("watched_at_sec") is not None else ""
        ws = f" 观影=已看{extra}"
    print(f"  [rec-ok] {rec_title!r} sid={sid}{ws}", flush=True)


async def _drive_expand_for_recs(
    bm: BrowserManager | None,
    dbp: Path,
    recs: list[dict[str, Any]],
    *,
    use_http: bool,
    crawler_agent_base: str | None,
    crawler_api_key: str | None,
    cover_cache_dir: Path,
    public_base_url: str | None,
    timeout_ms: int,
    force_headed: bool,
    dry_run: bool,
    sync_douban_watch: bool,
) -> None:
    """对给定推荐区列表逐条走扩散抓取：已入库 sid 跳过，新 sid 调用豆瓣写占位行。"""
    if not recs:
        return
    _expand_cap = 10
    rec_sids = [
        str(r.get("subjectId", "")).strip()
        for r in recs
        if str(r.get("subjectId", "")).strip().isdigit()
    ]
    conn2 = sqlite3.connect(str(dbp))
    try:
        existing = _existing_douban_subject_ids(conn2, rec_sids)
    finally:
        conn2.close()
    todo = [r for r in recs if str(r.get("subjectId", "")).strip() not in existing]
    print(
        f"     [expand] 详情页推荐区 {len(recs)} 条，已入库 {len(existing)}，待拉取详情至多 {_expand_cap} 条",
        flush=True,
    )
    for ri, rec in enumerate(todo[:_expand_cap]):
        await asyncio.sleep(1.5 + (ri % 3) * 0.5)
        try:
            await _expand_one_recommendation(
                bm,
                use_http=use_http,
                crawler_agent_base=crawler_agent_base,
                crawler_api_key=crawler_api_key,
                rec=rec,
                cover_cache_dir=cover_cache_dir,
                public_base_url=public_base_url,
                timeout_ms=timeout_ms,
                force_headed=force_headed,
                dry_run=dry_run,
                sync_douban_watch=sync_douban_watch,
            )
        except Exception as e:
            print(
                f"  [rec-exception] {rec.get('title')!r}: {type(e).__name__}: {e}",
                flush=True,
            )


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
    sync_douban_watch: bool = True,
    expand_recommendations: bool = False,
    force_refresh_seed: bool = False,
    seed_cache_min_recommend: int = SEED_CACHE_MIN_RECOMMEND_DEFAULT,
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

    # 种子缓存判定：默认开启；若完整且不强制刷新，则跳过豆瓣抓取，直接用缓存推荐驱动扩散。
    if not force_refresh_seed:
        conn_cache = sqlite3.connect(str(dbp))
        try:
            cache = evaluate_seed_cache(
                conn_cache,
                int(work_id),
                min_recommend=max(1, int(seed_cache_min_recommend)),
            )
        finally:
            conn_cache.close()
        if cache.get("hit"):
            cached_title = cache.get("title_zh") or title_zh_existing
            recs_cached = cache.get("recs") or []
            print(
                f"[seed-cache] id={work_id} title={cached_title!r} path={nas_library_path!r} "
                f"recs={len(recs_cached)} 跳过豆瓣抓取（缓存已完整）",
                flush=True,
            )
            if not expand_recommendations:
                print("     [seed-cache] 未启用扩散，无事可做；跳过", flush=True)
                return
            if dry_run:
                print("     [seed-cache] dry-run：将使用缓存推荐驱动扩散（此处不实际抓取）", flush=True)
                return
            await _drive_expand_for_recs(
                bm,
                dbp,
                recs_cached,
                use_http=use_http,
                crawler_agent_base=crawler_agent_base,
                crawler_api_key=crawler_api_key,
                cover_cache_dir=cover_cache_dir,
                public_base_url=public_base_url,
                timeout_ms=timeout_ms,
                force_headed=force_headed,
                dry_run=dry_run,
                sync_douban_watch=sync_douban_watch,
            )
            return
        else:
            print(
                f"[seed-cache-miss] id={work_id} path={nas_library_path!r} "
                f"reasons={cache.get('reasons')}",
                flush=True,
            )

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

    patch = subject_data_to_update(
        data,
        kind_hint=kind_hint,
        cover_cache_dir=cover_cache_dir,
        sync_douban_watch=sync_douban_watch,
    )

    ok, reason = verify_resolved_title(
        returned_title_zh=patch.get("title_zh"),
        returned_title_en=patch.get("title_en"),
        search_title=search_title,
        existing_title_zh=str(title_zh_existing or ""),
        nas_library_path=nas_library_path,
    )
    if not ok:
        print(
            f"[guard] 拒绝写入 id={work_id} path={nas_library_path!r}: {reason}",
            flush=True,
        )
        return

    prev = load_previous_metadata_json(metadata_path if isinstance(metadata_path, str) else None)
    merged = build_merged_metadata(prev, data, nas_library_path=nas_library_path, patch=patch)

    meta_dir = metadata_dir()
    fname = f"{slugify(patch['title_zh'] or search_title)}-{int(time.time() * 1000)}.json"
    new_meta_path = (meta_dir / fname).resolve()

    now_ms = int(time.time() * 1000)

    if dry_run:
        print("[dry-run] 将写入 metadata:", new_meta_path)
        print("[dry-run] 将 UPDATE:", json.dumps(patch, ensure_ascii=False, indent=2)[:800])
    else:
        new_meta_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

        conn = sqlite3.connect(str(dbp))
        try:
            new_sid = patch.get("douban_subject_id")
            if new_sid:
                other = conn.execute(
                    "SELECT id, nas_library_path FROM media_work WHERE douban_subject_id = ? AND id != ?",
                    (new_sid, work_id),
                ).fetchone()
                if other:
                    other_id, other_nas = other[0], (other[1] or "")
                    other_is_placeholder = other_nas.startswith("meta:douban:")
                    current_is_placeholder = (nas_library_path or "").startswith("meta:douban:")
                    if other_is_placeholder:
                        ph_tags = [
                            r[0] for r in conn.execute(
                                "SELECT tag_id FROM media_work_tag WHERE work_id = ?", (other_id,)
                            ).fetchall()
                        ]
                        for tid in ph_tags:
                            conn.execute(
                                "INSERT OR IGNORE INTO media_work_tag(work_id, tag_id) VALUES(?, ?)",
                                (work_id, tid),
                            )
                        conn.execute("DELETE FROM media_work_tag WHERE work_id = ?", (other_id,))
                        conn.execute("DELETE FROM media_work WHERE id = ?", (other_id,))
                        conn.commit()
                        print(f"     [merge] 占位行 id={other_id} 已合并到种子行 id={work_id} 并删除", flush=True)
                    elif current_is_placeholder and not other_is_placeholder:
                        # 当前是占位、对方是 NAS 真实条目：NAS 才是权威。绝不能删 NAS 行；删掉本占位行，避免 sid 冲突。
                        conn.execute("DELETE FROM media_work_tag WHERE work_id = ?", (work_id,))
                        conn.execute("DELETE FROM media_work WHERE id = ?", (work_id,))
                        conn.commit()
                        print(
                            f"     [skip-merge-safe] sid={new_sid} 已存在 NAS 行 id={other_id}（{other_nas!r}），"
                            f"删除当前占位 id={work_id} 让位；NAS 行未被改动",
                            flush=True,
                        )
                        return
                    else:
                        # 两个 NAS 行都同 sid（极罕见）：不动，提醒一下
                        print(
                            f"     [warn-dup-nas-sid] sid={new_sid} 在 NAS 行 id={work_id} 与 id={other_id} 都存在；本次不做合并删除",
                            flush=True,
                        )

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
                  douban_subject_id = COALESCE(?, douban_subject_id),
                  watch_status = COALESCE(?, watch_status),
                  watched_at = COALESCE(?, watched_at),
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
                    patch["douban_subject_id"],
                    patch.get("watch_status"),
                    patch.get("watched_at_sec"),
                    str(new_meta_path),
                    now_ms,
                    work_id,
                ),
            )
            conn.commit()

            genres = data.get("genres") if isinstance(data.get("genres"), list) else []
            tag_slugs = _genres_to_slugs(genres)
            if tag_slugs:
                _sync_work_tags(conn, work_id, tag_slugs)
                conn.commit()
        finally:
            conn.close()

        print(f"[ok] 已更新 id={work_id} metadata_path={new_meta_path}")
        if patch.get("watch_status") == "watched":
            extra = f" watched_at_sec={patch['watched_at_sec']}" if patch.get("watched_at_sec") is not None else ""
            print(f"     观影: 已同步为「已看」{extra}", flush=True)
        if urls:
            print("     source_urls:", urls[:3])

    recs = data.get("recommendSameSubjects") if isinstance(data.get("recommendSameSubjects"), list) else []
    if expand_recommendations and recs:
        await _drive_expand_for_recs(
            bm,
            dbp,
            recs,
            use_http=use_http,
            crawler_agent_base=crawler_agent_base,
            crawler_api_key=crawler_api_key,
            cover_cache_dir=cover_cache_dir,
            public_base_url=public_base_url,
            timeout_ms=timeout_ms,
            force_headed=force_headed,
            dry_run=dry_run,
            sync_douban_watch=sync_douban_watch,
        )


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
        "--min-douban-rating",
        type=float,
        default=None,
        metavar="SCORE",
        help="与 --all-library + --movie-only 联用：按资源库内已有豆瓣评分筛选（>= SCORE），高分优先；可重抓已写分条目作种子批次",
    )
    parser.add_argument(
        "--movie-only",
        action="store_true",
        help="与 --all-library 联用：仅电影（与 --min-douban-rating 组合时为高分电影种子）",
    )
    parser.add_argument(
        "--min-douban-rating-strict",
        action="store_true",
        help="与 --min-douban-rating 联用：筛选改为严格大于评分阈值（> 而非 >=），例如 8 表示不含正好 8.0 分",
    )
    parser.add_argument(
        "--seed-source",
        choices=("nas", "placeholder", "all"),
        default="nas",
        help="种子来源：nas（默认；只挑 NAS 资源库下真实条目）/ placeholder（只挑 meta:douban: 占位行）/ all（两者并集）",
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
    parser.add_argument(
        "--no-sync-douban-watch",
        action="store_true",
        help="不把豆瓣登录态下的「看过」同步到 media_work.watch_status / watched_at（默认会同步）",
    )
    parser.add_argument(
        "--expand-recommendations",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="每条种子解析完豆瓣详情后，再对该片详情页「推荐 / 同好」区解析出的条目（与爬虫 recommendSame 一致，至多 10 条）"
        "逐一再拉详情并写入占位行；未传本参数时，若使用 --all-library --min-douban-rating --movie-only 则默认开启。"
        "YAML 可在根级写 expand_recommendations: true（可被本参数覆盖）。",
    )
    parser.add_argument(
        "--force-refresh-seeds",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="默认行为（不传本参数）：若种子在库中的元数据已完整（主要字段齐备 + 推荐列表达到阈值），"
        "则跳过豆瓣抓取，直接用缓存推荐做扩散；显式 --force-refresh-seeds 会强制重新抓取每个种子。"
        "YAML 可写 force_refresh_seeds: true/false（可被本参数覆盖）。",
    )
    parser.add_argument(
        "--seed-cache-min-recommend",
        type=int,
        default=None,
        help=f"「种子缓存已完整」的推荐列表最小长度，默认 {SEED_CACHE_MIN_RECOMMEND_DEFAULT}。"
        "可在 YAML 根级用 seed_cache_min_recommend 覆盖（本参数再覆盖 YAML）。",
    )
    parser.add_argument(
        "--allow-concurrent",
        action="store_true",
        help="跳过 walter_data/.enrich.lock 互斥；仅在你确认豆瓣后端可安全并发时使用。",
    )
    args = parser.parse_args(argv)

    if getattr(args, "fix_tv_display_titles_in_db", False):
        return run_fix_tv_display_titles_in_db()

    lock_handle = acquire_enrich_lock(allow_concurrent=bool(getattr(args, "allow_concurrent", False)))

    min_rating = getattr(args, "min_douban_rating", None)
    movie_only = bool(getattr(args, "movie_only", False))

    if args.all_library and min_rating is None and not (args.only_incomplete_douban or args.skip_if_douban_rating):
        parser.error(
            "与 --all-library 批量补全时须指定 --only-incomplete-douban 或 --skip-if-douban-rating，"
            "以免对已写入 douban_rating 的条目全量重跑；若有意按高分选电影种子，请用 --min-douban-rating + --movie-only"
        )

    if args.all_library and min_rating is not None:
        if not movie_only:
            parser.error("--min-douban-rating 须与 --movie-only 同时使用（本批次仅针对电影）")
        if args.only_incomplete_douban or args.skip_if_douban_rating:
            parser.error("--min-douban-rating 与 --only-incomplete-douban / --skip-if-douban-rating 互斥")
        if min_rating <= 0 or min_rating > 10:
            parser.error("--min-douban-rating 须在 (0, 10] 内")

    expand_from_yaml: bool | None = None
    force_refresh_from_yaml: bool | None = None
    seed_cache_min_from_yaml: int | None = None
    if args.all_library:
        dbp = app_db_path()
        if not dbp.is_file():
            print(f"未找到数据库: {dbp}", flush=True)
            return 2
        if min_rating is not None:
            strict_gt = bool(getattr(args, "min_douban_rating_strict", False))
            seed_src = str(getattr(args, "seed_source", "nas"))
            entries = load_movie_library_entries_by_min_douban_rating(
                dbp,
                min_rating=min_rating,
                nas_root=args.nas_library_root,
                limit=args.limit,
                offset=args.offset,
                strict_greater_than=strict_gt,
                seed_source=seed_src,
            )
            op = ">" if strict_gt else ">="
            print(
                f"[all-library] 高分电影种子 douban_rating{op}{min_rating} seed-source={seed_src} "
                f"offset={args.offset} 共 {len(entries)} 条",
                flush=True,
            )
        else:
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
        entries, cfg_options = load_config(cfg_path)
        expand_from_yaml = cfg_options.get("expand_recommendations")
        force_refresh_from_yaml = cfg_options.get("force_refresh_seeds")
        seed_cache_min_from_yaml = cfg_options.get("seed_cache_min_recommend")
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

    sync_watch = not bool(getattr(args, "no_sync_douban_watch", False))
    if args.expand_recommendations is not None:
        expand_recs = bool(args.expand_recommendations)
    elif expand_from_yaml is not None:
        expand_recs = bool(expand_from_yaml)
    else:
        expand_recs = bool(args.all_library and min_rating is not None and movie_only)
    if args.expand_recommendations is not None:
        expand_note = "开（CLI）" if args.expand_recommendations else "关（CLI）"
    elif expand_from_yaml is not None:
        expand_note = "开（YAML）" if expand_from_yaml else "关（YAML）"
    elif expand_recs:
        expand_note = "开（默认：--min-douban-rating 电影种子批次）"
    else:
        expand_note = "关"
    if args.force_refresh_seeds is not None:
        force_refresh_seeds = bool(args.force_refresh_seeds)
        force_note = "开（CLI）" if force_refresh_seeds else "关（CLI）"
    elif force_refresh_from_yaml is not None:
        force_refresh_seeds = bool(force_refresh_from_yaml)
        force_note = "开（YAML）" if force_refresh_seeds else "关（YAML）"
    else:
        force_refresh_seeds = False
        force_note = "关（默认：已完整的种子跳过豆瓣抓取，用缓存推荐扩散）"

    if args.seed_cache_min_recommend is not None:
        if args.seed_cache_min_recommend < 1:
            parser.error("--seed-cache-min-recommend 须为 ≥1 的整数")
        seed_cache_min = int(args.seed_cache_min_recommend)
        min_note = f"{seed_cache_min}（CLI）"
    elif seed_cache_min_from_yaml is not None:
        seed_cache_min = int(seed_cache_min_from_yaml)
        min_note = f"{seed_cache_min}（YAML）"
    else:
        seed_cache_min = SEED_CACHE_MIN_RECOMMEND_DEFAULT
        min_note = f"{seed_cache_min}（默认）"

    print(f"[enrich] 观影同步: {'开' if sync_watch else '关（--no-sync-douban-watch）'}", flush=True)
    print(f"[enrich] 推荐扩散（每种子至多 10 部详情）: {expand_note}", flush=True)
    print(f"[enrich] 强制刷新种子（忽略缓存）: {force_note}", flush=True)
    print(f"[enrich] 种子缓存判定推荐区阈值 seed_cache_min_recommend={min_note}", flush=True)

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
                    sync_douban_watch=sync_watch,
                    expand_recommendations=expand_recs,
                    force_refresh_seed=force_refresh_seeds,
                    seed_cache_min_recommend=seed_cache_min,
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
        if lock_handle is not None:
            try:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            lock_handle.close()
    if failed:
        print(f"\n[summary] 共 {total} 条，其中 {failed} 条因异常失败，其余已处理。", flush=True)
    return 1 if failed else 0


def main() -> None:
    raise SystemExit(asyncio.run(amain()))


if __name__ == "__main__":
    main()
