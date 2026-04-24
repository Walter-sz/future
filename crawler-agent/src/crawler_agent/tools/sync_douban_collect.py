"""豆瓣「我看过」全量同步到 ``media_work``。

不依赖逐条扩散：直接在登录态下扫 ``movie.douban.com/mine?status=collect``（会 302 到
``/people/<user_id>/collect``），一次性拿齐 ``(subject_id, title_zh, 看过日期)``；
据此更新/插入 ``media_work``，新插入的占位条目会顺手以子进程方式交给
``crawler_agent.tools.enrich_library_douban`` 做元数据补全（``expand_recommendations: false``，
仅补占位自身，不再继续扩散）。

设计点说明（与 plan 一致）：

- **prefer_douban**：命中库内的行 ``watched_at`` 无条件以豆瓣列表页日期覆盖；
  新占位行在 INSERT 时就带上日期，子进程 enrich 过后再用「阶段 4」重新落一次 ``watched_at``，
  确保即使 enrich 从详情页解析出的日期与列表页不同，也以列表页为准。
- 完全复用 ``enrich_library_douban`` 的保护逻辑（`.enrich.lock`、`[guard]` 标题核验、
  schema 迁移等）。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from crawler_agent.browser_manager import BrowserManager, probe_douban_session
from crawler_agent.config import get_settings
from crawler_agent.tools.enrich_library_douban import (
    _DOUBAN_PLACEHOLDER_PREFIX,
    _douban_placeholder_nas_path,
    _douban_seen_day_to_utc_noon_sec,
    _ensure_schema_migrations,
    app_db_path,
    slugify,
    walter_data_dir,
)

_COLLECT_URL = "https://movie.douban.com/mine?status=collect"
_PEOPLE_COLLECT_TPL = "https://movie.douban.com/people/{user}/collect?start={start}&sort=time&rating=all&filter=all&mode=grid"
_MINE_COLLECT_TPL = "https://movie.douban.com/mine?status=collect&start={start}&sort=time"
_PAGE_SIZE = 15


def _now_ms() -> int:
    return int(time.time() * 1000)


def _tmp_dir() -> Path:
    d = walter_data_dir() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Phase 1: 扫收藏列表
# ---------------------------------------------------------------------------


_EXTRACT_COLLECT_JS = r"""
() => {
  const items = [];
  const seen = new Set();

  // 豆瓣 collect 列表的典型结构：.grid-view > .item.comment-item ×15 每页
  let roots = Array.from(document.querySelectorAll(
    '.grid-view .item.comment-item, .article .item.comment-item'
  ));
  if (roots.length === 0) {
    roots = Array.from(document.querySelectorAll('.grid-view .item, .article .item'));
  }

  roots.forEach((root) => {
    // subject link 优先取 .pic a（必带 title 属性），兜底 .title a
    const picA = root.querySelector('.pic a[href*="/subject/"]');
    const titleA = root.querySelector('li.title a[href*="/subject/"], .title a[href*="/subject/"]');
    const anchor = picA || titleA;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const m = href.match(/\/subject\/(\d+)/);
    if (!m) return;
    const sid = m[1];
    if (!sid || seen.has(sid)) return;

    // 标题优先取 li.title 内的 <em> 文本（豆瓣把「显示标题」放这里，通常是中文正式名）；
    // 其次 .pic a[title]（更标准化，英文居多）；最后兜底 titleA.textContent。
    // 统一剥掉 ' / ' 之后的别名段，只保留首个片名。
    const stripAlias = (s) => (s || '').replace(/\s+/g, ' ').trim().split(/\s*\/\s*/)[0].trim();
    let title = '';
    if (titleA) {
      const em = titleA.querySelector('em');
      if (em) title = stripAlias(em.textContent);
    }
    if (!title && picA && picA.getAttribute('title')) {
      title = stripAlias(picA.getAttribute('title'));
    }
    if (!title && titleA) {
      title = stripAlias(titleA.textContent);
    }

    let date = null;
    const dateEl = root.querySelector('.date');
    if (dateEl) {
      const t = (dateEl.textContent || '').trim();
      const dm = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
      if (dm) {
        const y = dm[1];
        const mm = String(dm[2]).padStart(2, '0');
        const dd = String(dm[3]).padStart(2, '0');
        date = `${y}-${mm}-${dd}`;
      }
    }

    seen.add(sid);
    items.push({ sid, title, date });
  });

  return {
    href: location.href,
    count: items.length,
    items,
  };
}
"""


def _extract_user_id_from_url(url: str) -> str | None:
    m = re.search(r"/people/([^/]+)/", url or "")
    return m.group(1) if m else None


_FIND_PEOPLE_ID_JS = r"""
() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/people/"]'));
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/people\/([^\/?#]+)\/?/);
    if (m && m[1] && m[1] !== 'search') return m[1];
  }
  return null;
}
"""


async def _fetch_collect_list(
    *,
    force_headed: bool,
    limit: int | None,
    start_offset: int,
    sleep_min: float,
    sleep_max: float,
) -> tuple[list[dict[str, str]], str]:
    """返回 ``([{sid,title,date}, ...], user_id)``。"""
    settings = get_settings()
    bm = BrowserManager(settings)
    page = await bm.get_page("douban", headed=force_headed)

    try:
        await page.goto(_COLLECT_URL, wait_until="domcontentloaded", timeout=45_000)
        ok = await probe_douban_session(page)
        if not ok:
            raise RuntimeError(
                "豆瓣会话未登录或被验证拦截；请先在本机跑 `python -m crawler_agent login douban`，"
                "或把 --force-headed 打开手动过验证后重试。"
            )
        # 豆瓣登录后两种常见情形：
        # 1) /mine?status=collect 302 到 /people/<id>/collect（URL 能直接拿到 user_id）。
        # 2) 停留在 /mine（服务端根据 cookie 渲染当前用户列表，URL 不变）。
        # 先尝试从 URL 提；不行就扫 DOM 里任一指向 /people/<id>/ 的链接（侧栏/顶栏/条目卡片都会有）。
        user_id = _extract_user_id_from_url(page.url)
        if not user_id:
            try:
                user_id = await page.evaluate(_FIND_PEOPLE_ID_JS)
            except Exception:  # noqa: BLE001
                user_id = None
        if not user_id:
            # 再主动导航一次，有时第一次会被 CDN 302 到临时页
            await page.goto(_COLLECT_URL, wait_until="domcontentloaded", timeout=30_000)
            user_id = _extract_user_id_from_url(page.url)
            if not user_id:
                try:
                    user_id = await page.evaluate(_FIND_PEOPLE_ID_JS)
                except Exception:  # noqa: BLE001
                    user_id = None

        if user_id:
            print(f"[collect] 登录 OK, user={user_id}（按 /people/{user_id}/collect 分页）", flush=True)
        else:
            print(
                "[collect] 未能解析 user_id；降级用 /mine?status=collect&start=N 分页",
                flush=True,
            )

        items: list[dict[str, str]] = []
        start = max(0, int(start_offset))
        page_no = 0
        empty_seen = 0
        while True:
            page_no += 1
            if limit is not None and len(items) >= limit:
                break
            url = (
                _PEOPLE_COLLECT_TPL.format(user=user_id, start=start)
                if user_id
                else _MINE_COLLECT_TPL.format(start=start)
            )
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            except Exception as exc:  # noqa: BLE001
                print(f"[collect] 第 {page_no} 页加载失败 start={start}: {exc}", flush=True)
                empty_seen += 1
                if empty_seen >= 2:
                    break
                await asyncio.sleep(random.uniform(sleep_min, sleep_max))
                continue
            try:
                raw = await page.evaluate(_EXTRACT_COLLECT_JS)
            except Exception as exc:  # noqa: BLE001
                print(f"[collect] 第 {page_no} 页解析失败 start={start}: {exc}", flush=True)
                empty_seen += 1
                if empty_seen >= 2:
                    break
                await asyncio.sleep(random.uniform(sleep_min, sleep_max))
                continue
            got = raw.get("items") if isinstance(raw, dict) else None
            if not got:
                print(f"[collect] 第 {page_no} 页空（start={start}），认为到达列表末尾", flush=True)
                break
            before = len(items)
            for it in got:
                sid = str(it.get("sid") or "").strip()
                if not sid.isdigit():
                    continue
                title = str(it.get("title") or "").strip()
                date = it.get("date")
                if not isinstance(date, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    date = None
                items.append({"sid": sid, "title": title, "date": date or ""})
                if limit is not None and len(items) >= limit:
                    break
            added = len(items) - before
            print(
                f"[collect] 第 {page_no} 页 start={start} 抓到 {added} 条，累计 {len(items)}",
                flush=True,
            )
            if added == 0:
                # 页面有渲染但解析不到条目，避免死循环
                empty_seen += 1
                if empty_seen >= 2:
                    break
            else:
                empty_seen = 0
            start += _PAGE_SIZE
            await asyncio.sleep(random.uniform(sleep_min, sleep_max))

        # 去重（按 sid 保留先出现的那条）
        dedup: dict[str, dict[str, str]] = {}
        for it in items:
            sid = it["sid"]
            if sid not in dedup:
                dedup[sid] = it
        deduped = list(dedup.values())
        return deduped, user_id
    finally:
        await bm.shutdown()


# ---------------------------------------------------------------------------
# Phase 2: 写入 DB
# ---------------------------------------------------------------------------


def _count_existing_sids(conn: sqlite3.Connection, sids: list[str]) -> dict[str, int]:
    """返回 ``{sid: work_id}`` 的映射；未命中则不在字典里。"""
    out: dict[str, int] = {}
    if not sids:
        return out
    # 为了避免超长 SQL，分批
    batch = 500
    for i in range(0, len(sids), batch):
        chunk = sids[i : i + batch]
        placeholders = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT douban_subject_id, id FROM media_work WHERE douban_subject_id IN ({placeholders})",
            tuple(chunk),
        ).fetchall()
        for sid, wid in rows:
            out[str(sid)] = int(wid)
    return out


def _upsert_collection_rows(
    conn: sqlite3.Connection,
    *,
    entries: list[dict[str, str]],
    dry_run: bool,
) -> dict[str, Any]:
    _ensure_schema_migrations(conn)

    sids = [e["sid"] for e in entries]
    existing = _count_existing_sids(conn, sids)

    new_entries: list[dict[str, str]] = []
    updated_ids: list[int] = []
    already_in_sync = 0
    watch_status_flipped = 0
    watched_at_changed = 0
    skipped_bad_date = 0

    now_ms = _now_ms()
    for e in entries:
        sid = e["sid"]
        ymd = e.get("date") or ""
        watched_sec = _douban_seen_day_to_utc_noon_sec(ymd) if ymd else None
        if ymd and watched_sec is None:
            # 日期校验失败（早于 2015-01-01 或晚于今日 +1）：视为无日期，但仍可落「已看」
            skipped_bad_date += 1

        if sid in existing:
            wid = existing[sid]
            prev = conn.execute(
                "SELECT watch_status, watched_at FROM media_work WHERE id = ?",
                (wid,),
            ).fetchone()
            prev_status = prev[0] if prev else None
            prev_watched = prev[1] if prev else None

            # 已同步：当前就是 watched，且（豆瓣没给到合法日期时就保留现状，
            # 给到了就要求日期完全相同）——这类条目完全跳过，不碰 DB。
            if prev_status == "watched" and (
                watched_sec is None or prev_watched == watched_sec
            ):
                already_in_sync += 1
                updated_ids.append(wid)
                continue

            if dry_run:
                if prev_status != "watched":
                    watch_status_flipped += 1
                if watched_sec is not None and prev_watched != watched_sec:
                    watched_at_changed += 1
                updated_ids.append(wid)
                continue

            conn.execute(
                "UPDATE media_work SET watch_status = 'watched', watched_at = COALESCE(?, watched_at), "
                "updated_at = ? WHERE id = ?",
                (watched_sec, now_ms, wid),
            )
            if watched_sec is not None and prev_watched != watched_sec:
                watched_at_changed += 1
                if prev_watched is not None:
                    print(
                        f"  [watched_at] id={wid} sid={sid} {prev_watched}→{watched_sec} "
                        f"({ymd})",
                        flush=True,
                    )
            if prev_status != "watched":
                watch_status_flipped += 1
                print(
                    f"  [watched] id={wid} sid={sid} {prev_status!r}→'watched' "
                    f"title={e.get('title')!r}",
                    flush=True,
                )
            updated_ids.append(wid)
        else:
            new_entries.append({"sid": sid, "title": e.get("title") or "", "date": ymd})
            if dry_run:
                continue
            placeholder_nas = _douban_placeholder_nas_path(sid)
            title_zh = (e.get("title") or "").strip() or f"豆瓣条目 {sid}"
            # 最小占位：normalized_title 先用 title_zh；search_text 同理。后续 enrich 会覆盖。
            conn.execute(
                """
                INSERT OR IGNORE INTO media_work (
                  title_zh, title_en, normalized_title, media_type, year,
                  country, language, douban_rating, douban_rating_count, summary,
                  directors_json, actors_json, poster_url,
                  match_status, search_text, douban_subject_id,
                  watch_status, watched_at,
                  nas_library_path, metadata_path,
                  created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    title_zh,
                    "",
                    title_zh,
                    "movie",
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "[]",
                    "[]",
                    None,
                    "matched",  # 来自豆瓣 collect，算已匹配；enrich 后会重写
                    title_zh,
                    sid,
                    "watched",
                    watched_sec,
                    placeholder_nas,
                    None,
                    now_ms,
                    now_ms,
                ),
            )

    if not dry_run:
        conn.commit()

    return {
        "new_entries": new_entries,
        "updated_ids": updated_ids,
        "already_in_sync": already_in_sync,
        "watch_status_flipped": watch_status_flipped,
        "watched_at_changed": watched_at_changed,
        "skipped_bad_date": skipped_bad_date,
        "existing_count": len(existing),
    }


# ---------------------------------------------------------------------------
# Phase 3: 子进程 enrich（对新占位）
# ---------------------------------------------------------------------------


def _write_enrich_yaml(new_entries: list[dict[str, str]], ts: int) -> Path:
    lines = ["expand_recommendations: false", "entries:"]
    for e in new_entries:
        title = (e.get("title") or "").strip().replace("\n", " ")
        if not title:
            title = f"豆瓣条目 {e['sid']}"
        # 把标题里的 YAML 引号字符转义成安全形式
        # 用双引号包裹避免特殊字符问题
        safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'  - search_title: "{safe_title}"')
        lines.append(f'    nas_library_path: "{_douban_placeholder_nas_path(e["sid"])}"')
        lines.append("    kind_hint: movie")
    path = _tmp_dir() / f"sync-douban-collect-enrich-{ts}.yaml"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _run_enrich_subprocess(
    yaml_path: Path,
    *,
    local_douban: bool,
    force_headed: bool,
    log_path: Path,
) -> int:
    cmd = [
        sys.executable,
        "-u",
        "-m",
        "crawler_agent.tools.enrich_library_douban",
        "--config",
        str(yaml_path),
    ]
    if local_douban:
        cmd.append("--local-douban")
    if force_headed:
        cmd.append("--force-headed")
    else:
        cmd.append("--no-force-headed")

    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")

    print(
        f"[enrich] 子进程启动：{' '.join(cmd)}\n"
        f"         日志：{log_path}",
        flush=True,
    )
    with log_path.open("w", encoding="utf-8") as lf:
        proc = subprocess.run(
            cmd,
            stdout=lf,
            stderr=subprocess.STDOUT,
            env=env,
            check=False,
        )
    return proc.returncode


# ---------------------------------------------------------------------------
# Phase 4: 重新落 watched_at（保证 collect 日期是权威）
# ---------------------------------------------------------------------------


def _reapply_watched_at(
    conn: sqlite3.Connection,
    *,
    entries: list[dict[str, str]],
    dry_run: bool,
) -> dict[str, int]:
    stats = {"applied": 0, "noop": 0, "not_found": 0, "bad_date": 0}
    now_ms = _now_ms()
    for e in entries:
        sid = e["sid"]
        ymd = e.get("date") or ""
        if not ymd:
            continue
        watched_sec = _douban_seen_day_to_utc_noon_sec(ymd)
        if watched_sec is None:
            stats["bad_date"] += 1
            continue
        # 1) 先按 sid 查
        row = conn.execute(
            "SELECT id, watch_status, watched_at FROM media_work WHERE douban_subject_id = ?",
            (sid,),
        ).fetchone()
        if not row:
            # 2) 退化用占位路径再找一次（enrich 可能改了 sid，但没改 nas_library_path）
            row = conn.execute(
                "SELECT id, watch_status, watched_at FROM media_work WHERE nas_library_path = ?",
                (_douban_placeholder_nas_path(sid),),
            ).fetchone()
        if not row:
            stats["not_found"] += 1
            continue
        wid, prev_status, prev_watched = row
        if prev_watched == watched_sec and prev_status == "watched":
            stats["noop"] += 1
            continue
        if dry_run:
            stats["applied"] += 1
            continue
        conn.execute(
            "UPDATE media_work SET watch_status = 'watched', watched_at = ?, updated_at = ? "
            "WHERE id = ?",
            (watched_sec, now_ms, wid),
        )
        stats["applied"] += 1
    if not dry_run:
        conn.commit()
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


async def amain(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="把豆瓣登录账号下「我看过」列表同步到本地 media_work",
    )
    parser.add_argument(
        "--local-douban",
        action="store_true",
        default=True,
        help="使用本机 Playwright（唯一支持的路径；此项默认为开启，仅为兼容显式指定）",
    )
    parser.add_argument(
        "--force-headed",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="是否 headed 浏览器；默认 headless。遇到验证码/登录挑战时可改 --force-headed",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只抓列表 + 打印影响，不写 DB、不启动子进程",
    )
    parser.add_argument(
        "--no-auto-enrich",
        action="store_true",
        help="只做阶段 1+2（抓列表 + 写 DB），不对新占位启动 enrich 子进程",
    )
    parser.add_argument(
        "--start-offset",
        type=int,
        default=0,
        help="从豆瓣列表的第 N 条开始（配合 --limit 做分段测试）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="最多拉取 N 条（调试用）",
    )
    parser.add_argument("--sleep-min", type=float, default=1.5, help="翻页间隔下界（秒）")
    parser.add_argument("--sleep-max", type=float, default=3.0, help="翻页间隔上界（秒）")
    args = parser.parse_args(argv)

    ts = int(time.time())

    # 阶段 1：抓列表
    print("[phase 1] 拉取豆瓣「我看过」列表…", flush=True)
    entries, user_id = await _fetch_collect_list(
        force_headed=bool(args.force_headed),
        limit=args.limit,
        start_offset=args.start_offset,
        sleep_min=float(args.sleep_min),
        sleep_max=float(args.sleep_max),
    )
    print(f"[phase 1] 合计 {len(entries)} 条（去重后，user={user_id}）", flush=True)

    # 快照落盘，便于事后审计/排错
    snapshot = {
        "user_id": user_id,
        "fetched_at": int(time.time()),
        "count": len(entries),
        "entries": entries,
    }
    snap_path = _tmp_dir() / f"douban-collect-{ts}.json"
    snap_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[phase 1] 快照写入：{snap_path}", flush=True)

    if not entries:
        print("[done] 豆瓣没有返回任何条目，结束", flush=True)
        return 0

    # 阶段 2：写 DB（UPDATE 现有 + INSERT 占位）
    print("[phase 2] 写 DB…", flush=True)
    dbp = app_db_path()
    conn = sqlite3.connect(str(dbp))
    try:
        res = _upsert_collection_rows(conn, entries=entries, dry_run=bool(args.dry_run))
    finally:
        conn.close()

    existing_count = res["existing_count"]
    new_entries: list[dict[str, str]] = res["new_entries"]
    updated_ids: list[int] = res["updated_ids"]  # noqa: F841 — 供后续扩展
    already_in_sync = res["already_in_sync"]
    watch_status_flipped = res["watch_status_flipped"]
    watched_at_changed = res["watched_at_changed"]
    skipped_bad_date = res["skipped_bad_date"]

    need_update = existing_count - already_in_sync
    print(
        f"[phase 2] 命中库内 {existing_count}（其中 {already_in_sync} 条已同步、跳过）| "
        f"需要更新 {need_update} | 新占位 {len(new_entries)} | "
        f"watch_status 翻转 {watch_status_flipped} | "
        f"watched_at 覆盖 {watched_at_changed} | "
        f"日期非法（早于 2015 或未来）{skipped_bad_date}",
        flush=True,
    )

    if args.dry_run:
        # 在 dry-run 下，展示前 20 条待新增的样例便于核对
        print("[phase 2] --dry-run：仅打印 20 条新占位样例", flush=True)
        for e in new_entries[:20]:
            print(
                f"    NEW sid={e['sid']} date={e.get('date') or 'N/A'} title={e.get('title')!r}",
                flush=True,
            )
        print(f"[done] --dry-run 结束；snapshot={snap_path}", flush=True)
        return 0

    # 阶段 3：对新占位跑 enrich 子进程
    enrich_rc: int | None = None
    if new_entries and not args.no_auto_enrich:
        yaml_path = _write_enrich_yaml(new_entries, ts=ts)
        log_path = _tmp_dir() / f"sync-douban-collect-enrich-{ts}.log"
        print(
            f"[phase 3] 新占位 {len(new_entries)} 条，生成 YAML：{yaml_path}",
            flush=True,
        )
        enrich_rc = _run_enrich_subprocess(
            yaml_path,
            local_douban=True,
            force_headed=bool(args.force_headed),
            log_path=log_path,
        )
        print(f"[phase 3] 子进程结束 rc={enrich_rc}（详见 {log_path}）", flush=True)
    elif new_entries:
        yaml_path = _write_enrich_yaml(new_entries, ts=ts)
        print(
            f"[phase 3] --no-auto-enrich：已生成 YAML 但未运行：{yaml_path}\n"
            f"         手动跑法：python -m crawler_agent.tools.enrich_library_douban "
            f"--config {yaml_path} --local-douban --no-force-headed",
            flush=True,
        )

    # 阶段 4：重新落一次 watched_at，以 collect 列表日期为准
    print("[phase 4] 复核所有条目的 watched_at（以豆瓣列表页日期为权威）…", flush=True)
    conn = sqlite3.connect(str(dbp))
    try:
        reapply = _reapply_watched_at(conn, entries=entries, dry_run=False)
    finally:
        conn.close()
    print(
        f"[phase 4] 应用 {reapply['applied']} | 无变化 {reapply['noop']} | "
        f"未找到 {reapply['not_found']} | 日期非法 {reapply['bad_date']}",
        flush=True,
    )

    # 汇总
    print(
        "[done] "
        f"fetched={len(entries)} "
        f"existing={existing_count} "
        f"already_in_sync={already_in_sync} "
        f"updated_existing={need_update} "
        f"new_placeholders={len(new_entries)} "
        f"watched_at_reapplied={reapply['applied']} "
        f"enrich_rc={enrich_rc}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(amain()))
