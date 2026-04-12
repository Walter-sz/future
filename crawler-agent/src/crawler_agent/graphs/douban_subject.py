"""LangGraph: douban / subject.resolve_by_title"""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from crawler_agent import human
from crawler_agent.browser_manager import BrowserManager, has_display, probe_douban_session
from crawler_agent.cover_cache import (
    _absolute_cover_url,
    _photo_public_id,
    create_douban_poster_response_collector,
    save_subject_cover_best_effort,
)


async def _goto_dom_retry(page, url: str, *, timeout_ms: int, attempts: int = 3) -> None:
    """缓解偶发 ``net::ERR_ABORTED``（并发导航、网络抖动、豆瓣限流）。"""
    last: Exception | None = None
    for a in range(attempts):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            return
        except Exception as e:
            last = e
            if a + 1 >= attempts:
                break
            await asyncio.sleep(1.0 + a * 0.7)
    assert last is not None
    raise last


class DoubanState(TypedDict, total=False):
    title: str
    kind_hint: str
    headed_effective: bool
    candidates: list[dict[str, Any]]
    chosen_subject_id: str
    chosen_url: str
    subject_raw: dict[str, Any]
    cover_files: dict[str, Any]
    subject_data: dict[str, Any]
    source_urls: list[str]
    error_code: str
    error_message: str


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().strip()
    s = re.sub(r"\s+", "", s)
    return s


def _subject_id_from_href(href: str) -> str | None:
    m = re.search(r"/subject/(\d+)/?", href)
    return m.group(1) if m else None


async def _wait_until_session_ok(page, timeout_s: float) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        if await probe_douban_session(page):
            return True
        await asyncio.sleep(2.5)
    return await probe_douban_session(page)


async def node_ensure_session(state: DoubanState, config: RunnableConfig) -> dict[str, Any]:
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    force_headed: bool = bool(cfg.get("force_headed"))
    timeout_ms: int = int(cfg.get("timeout_ms", 120_000))
    timeout_s = min(600.0, max(45.0, timeout_ms / 1000.0 * 0.5))

    headed = force_headed
    page = await bm.get_page("douban", headed=headed)
    if await probe_douban_session(page):
        return {"headed_effective": headed}

    if not headed and has_display():
        await bm.close_site("douban")
        headed = True
        page = await bm.get_page("douban", headed=True)

    if not headed and not has_display():
        return {
            "error_code": "NEED_DISPLAY",
            "error_message": "豆瓣需要图形界面完成验证或登录。请在本机设置 DISPLAY 或先运行: python -m crawler_agent login douban",
            "headed_effective": False,
        }

    try:
        ok = await asyncio.wait_for(_wait_until_session_ok(page, timeout_s), timeout=timeout_s + 15)
    except TimeoutError:
        ok = False
    if not ok:
        return {
            "error_code": "SESSION_TIMEOUT",
            "error_message": "等待豆瓣页面可用超时，请检查网络或手动完成验证。",
            "headed_effective": headed,
        }
    return {"headed_effective": headed}


async def node_search(state: DoubanState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    headed = bool(state.get("headed_effective", False))
    page = await bm.get_page("douban", headed=headed)
    title = state["title"]
    kind = state.get("kind_hint") or "auto"

    async def run_search(cat: str) -> list[dict[str, Any]]:
        q = quote(title)
        url = f"https://search.douban.com/{cat}/subject_search?search_text={q}"
        await _goto_dom_retry(page, url, timeout_ms=90_000)
        await human.jitter(0.35, 0.8)
        hrefs = await page.evaluate(
            """() => {
              const d = window.__DATA__;
              if (d && Array.isArray(d.items)) {
                return d.items.map((it) => ({
                  id: String(it.id),
                  href: "https://movie.douban.com/subject/" + it.id + "/",
                  text: String(it.title || it.card_subtitle || "").replace(/\\s+/g, " ").trim(),
                }));
              }
              return [];
            }"""
        )
        if not hrefs:
            await human.scroll_lazy(page, steps=2, px=320)
            hrefs = await page.evaluate(
                """() => {
                  const d = window.__DATA__;
                  if (d && Array.isArray(d.items)) {
                    return d.items.map((it) => ({
                      id: String(it.id),
                      href: "https://movie.douban.com/subject/" + it.id + "/",
                      text: String(it.title || it.card_subtitle || "").replace(/\\s+/g, " ").trim(),
                    }));
                  }
                  return [];
                }"""
            )
        if hrefs:
            return hrefs
        return await _douban_subject_suggest(page, title)

    async def _douban_subject_suggest(pg, raw_title: str) -> list[dict[str, Any]]:
        """内嵌 JSON 接口，仍在浏览器中导航加载（不作独立 HTTP 客户端）。"""
        sq = quote(raw_title, safe="")
        await _goto_dom_retry(
            pg,
            f"https://movie.douban.com/j/subject_suggest?q={sq}",
            timeout_ms=60_000,
            attempts=4,
        )
        await human.jitter(0.15, 0.35)
        body = (await pg.text_content("body")) or "[]"
        body = body.strip()
        try:
            arr = json.loads(body)
        except json.JSONDecodeError:
            return []
        out: list[dict[str, Any]] = []
        if not isinstance(arr, list):
            return []
        for x in arr:
            if not isinstance(x, dict) or not x.get("id"):
                continue
            sid = str(x["id"])
            href = (x.get("url") or "").strip() or f"https://movie.douban.com/subject/{sid}/"
            text = str(x.get("title") or x.get("sub_title") or "").strip()
            out.append({"id": sid, "href": href, "text": text})
        return out

    candidates: list[dict[str, Any]] = []
    if kind in ("auto", "movie"):
        candidates.extend(await run_search("movie"))
    if kind in ("auto", "tv") and (kind == "tv" or not candidates):
        tv_hits = await run_search("tv")
        for h in tv_hits:
            if not any(c["id"] == h["id"] for c in candidates):
                candidates.append(h)

    if not candidates:
        return {
            "error_code": "NOT_FOUND",
            "error_message": f"豆瓣未找到与「{title}」匹配的条目。",
            "candidates": [],
        }
    return {"candidates": candidates, "source_urls": [page.url]}


def _score(query: str, text: str) -> float:
    q, t = _norm(query), _norm(text)
    if not q:
        return 0.0
    if q == t:
        return 1.0
    if q in t:
        return 0.85
    if t in q:
        return 0.75
    common = sum(1 for c in q if c in t) / max(len(q), 1)
    return common * 0.6


async def node_pick(state: DoubanState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    title = state["title"]
    cands = state.get("candidates") or []
    if not cands:
        return {"error_code": "NOT_FOUND", "error_message": "无候选条目"}
    best = max(cands, key=lambda c: _score(title, c.get("text", "")))
    sid = best.get("id") or _subject_id_from_href(best.get("href", ""))
    if not sid:
        return {"error_code": "PARSE_ERROR", "error_message": "无法解析 subject id"}
    url = best.get("href") or f"https://movie.douban.com/subject/{sid}/"
    return {
        "chosen_subject_id": sid,
        "chosen_url": url,
        "source_urls": list({*(state.get("source_urls") or []), url}),
    }


async def _bust_mainpic_poster(page) -> bool:
    """强制主海报重新请求，便于 response 监听器捕获与 DOM 同一 public id 的图床包。"""
    script = """() => {
      const im = document.querySelector('#mainpic a.nbgnbg img') ||
        document.querySelector('#mainpic a img') ||
        document.querySelector('#mainpic img');
      if (!im || !im.src) return false;
      const base = im.src.split('?')[0];
      im.src = '';
      im.src = base + '?t=' + Date.now();
      return true;
    }"""
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=15_000)
        return bool(await page.evaluate(script))
    except Exception:
        return False


async def _safe_evaluate(page, script: str, *, attempts: int = 4) -> dict[str, Any]:
    last: Exception | None = None
    for i in range(attempts):
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=15_000)
            return await page.evaluate(script)
        except Exception as e:
            last = e
            await asyncio.sleep(0.35 + i * 0.2)
    assert last is not None
    raise last


async def node_fetch_subject(state: DoubanState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    headed = bool(state.get("headed_effective", False))
    page = await bm.get_page("douban", headed=headed)
    url = state.get("chosen_url") or ""
    intercepted, on_resp = create_douban_poster_response_collector()
    raw: dict[str, Any] = {}
    cover_files: dict[str, Any] = {}
    page.on("response", on_resp)
    try:
        await _goto_dom_retry(page, url, timeout_ms=60_000)
        await human.jitter(0.25, 0.55)
        try:
            await page.wait_for_load_state("networkidle", timeout=18_000)
        except Exception:
            pass
        await asyncio.sleep(0.35)
        try:
            await page.wait_for_selector("#wrapper, #content, h1", timeout=25_000)
        except Exception:
            pass
        # 主海报常晚于首屏其它图加载；须等 #mainpic 真像素后再关 response 监听，否则会误匹配推荐位海报
        try:
            await page.wait_for_function(
                """() => {
                  const im = document.querySelector('#mainpic a.nbgnbg img') ||
                    document.querySelector('#mainpic a img') ||
                    document.querySelector('#mainpic img');
                  return im && im.complete && im.naturalWidth > 80 && im.naturalHeight > 100;
                }""",
                timeout=28_000,
            )
        except Exception:
            pass
        # 先抽取再滚动：滚动过程中导航会导致 evaluate 上下文销毁
        extract_js = """() => {
          const ratingEl = document.querySelector('strong.ll.rating_num') || document.querySelector('.rating_num');
          const votesEl = document.querySelector('.rating_people span');
          const titleEl = document.querySelector('h1 span[property="v:itemreviewed"]');
          const yearEl = document.querySelector('h1 .year');
          const coverEl = document.querySelector('#mainpic a.nbgnbg img') ||
            document.querySelector('#mainpic a img') ||
            document.querySelector('#mainpic img');
          const introEl = document.querySelector('#link-report-intra span[property="v:summary"]') ||
            document.querySelector('#link-report span[property="v:summary"]') ||
            document.querySelector('.intro span[property="v:summary"]');
          const infoEl = document.querySelector('#info');
          return {
            url: location.href,
            title: titleEl ? titleEl.textContent.trim() : '',
            year: yearEl ? yearEl.textContent.trim() : '',
            rating: ratingEl ? ratingEl.textContent.trim() : null,
            votes: votesEl ? votesEl.textContent.trim() : null,
            coverUrl: coverEl ? coverEl.getAttribute('src') : null,
            summary: introEl ? introEl.textContent.trim() : null,
            infoText: infoEl ? infoEl.innerText : '',
          };
        }"""
        raw = await _safe_evaluate(page, extract_js)
        if not (raw.get("summary") or "").strip():
            await human.scroll_lazy(page, steps=1, px=240)
            raw2 = await _safe_evaluate(page, extract_js)
            if (raw2.get("summary") or "").strip():
                raw = raw2

        # 在移除 response 监听前，强制主图再拉一次，使拦截列表里出现与 coverUrl 同一 public id 的响应
        cue = _absolute_cover_url(raw.get("coverUrl"))
        if cue:
            fid = _photo_public_id(cue)
            if fid:
                try:

                    def _matches_main_poster(r) -> bool:
                        try:
                            if r.status != 200:
                                return False
                            u = r.url
                            return (
                                "doubanio.com" in u
                                and "/view/photo/" in u
                                and fid in u
                                and "image" in (r.headers.get("content-type") or "").lower()
                            )
                        except Exception:
                            return False

                    async with page.expect_response(_matches_main_poster, timeout=14_000):
                        await _bust_mainpic_poster(page)
                except Exception:
                    await _bust_mainpic_poster(page)
                    await asyncio.sleep(1.0)
            else:
                await _bust_mainpic_poster(page)
                await asyncio.sleep(0.85)
        else:
            await asyncio.sleep(0.35)

        cover_dir_val = cfg.get("cover_cache_dir")
        sid = state.get("chosen_subject_id")
        if cover_dir_val and sid and raw.get("coverUrl"):
            cover_dir = Path(cover_dir_val) if not isinstance(cover_dir_val, Path) else cover_dir_val
            ref = (state.get("chosen_url") or raw.get("url") or "https://movie.douban.com/")[:800]
            fields, _ = await save_subject_cover_best_effort(
                page,
                subject_id=str(sid),
                image_url=str(raw["coverUrl"]),
                referer=ref,
                dest_dir=cover_dir,
                intercepted_images=intercepted,
            )
            cover_files = {k: v for k, v in fields.items() if v is not None and v != ""}
    finally:
        page.remove_listener("response", on_resp)

    return {
        "subject_raw": raw,
        "cover_files": cover_files,
        "source_urls": list({*(state.get("source_urls") or []), raw.get("url", url)}),
    }


def _parse_info_block(info: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {"directors": [], "writers": [], "casts": [], "genres": [], "countries": [], "languages": []}
    if not info:
        return out

    def grab(label: str) -> list[str]:
        m = re.search(rf"{label}\s*:\s*([^\n]+)", info)
        if not m:
            return []
        part = m.group(1)
        names = re.findall(r"[\u4e00-\u9fffA-Za-z·\.\-]+(?:\s+[\u4e00-\u9fffA-Za-z·\.\-]+)*", part)
        return [n.strip() for n in names if len(n.strip()) > 1][:40]

    out["directors"] = grab("导演")
    out["writers"] = grab("编剧")
    out["casts"] = grab("主演") or grab("演员")
    g = grab("类型")
    out["genres"] = g
    out["countries"] = grab("制片国家/地区") or grab("国家")
    out["languages"] = grab("语言")
    return out


async def node_normalize(state: DoubanState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    raw = state.get("subject_raw") or {}
    info_parsed = _parse_info_block(raw.get("infoText") or "")
    votes_str = raw.get("votes") or ""
    votes_int: int | None = None
    m = re.search(r"(\d[\d,]*)", votes_str.replace(",", "").replace("人", ""))
    if m:
        try:
            votes_int = int(m.group(1).replace(",", ""))
        except ValueError:
            votes_int = None
    rating_val: float | None = None
    try:
        r = raw.get("rating")
        if r and str(r).strip() not in ("", "暂无评分"):
            rating_val = float(str(r).strip())
    except ValueError:
        rating_val = None

    data: dict[str, Any] = {
        "doubanId": state.get("chosen_subject_id"),
        "canonicalTitle": raw.get("title"),
        "year": (raw.get("year") or "").strip("()（） "),
        "coverUrl": raw.get("coverUrl"),
        "doubanRating": rating_val,
        "ratingCount": votes_int,
        "directors": info_parsed["directors"],
        "writers": info_parsed["writers"],
        "casts": info_parsed["casts"],
        "genres": info_parsed["genres"],
        "countries": info_parsed["countries"],
        "languages": info_parsed["languages"],
        "summary": raw.get("summary"),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }

    cfg = config["configurable"]
    public_base = cfg.get("public_base_url")
    for k in ("coverHttpPath", "coverLocalPath", "coverSaveMode", "coverDownloadError", "coverCdnNote"):
        v = (state.get("cover_files") or {}).get(k)
        if v is not None:
            data[k] = v
    if public_base and data.get("coverHttpPath"):
        data["coverUrlCached"] = str(public_base).rstrip("/") + data["coverHttpPath"]

    return {"subject_data": data}


def build_douban_subject_graph() -> StateGraph:
    g = StateGraph(DoubanState)
    g.add_node("ensure_session", node_ensure_session)
    g.add_node("search", node_search)
    g.add_node("pick", node_pick)
    g.add_node("fetch_subject", node_fetch_subject)
    g.add_node("normalize", node_normalize)

    g.add_edge(START, "ensure_session")
    g.add_edge("ensure_session", "search")
    g.add_edge("search", "pick")
    g.add_edge("pick", "fetch_subject")
    g.add_edge("fetch_subject", "normalize")
    g.add_edge("normalize", END)
    return g.compile()


async def run_douban_resolve_by_title(
    bm: BrowserManager,
    *,
    title: str,
    kind_hint: str,
    force_headed: bool,
    timeout_ms: int,
    cover_cache_dir: Path,
    public_base_url: str | None,
) -> tuple[dict[str, Any] | None, list[str], dict[str, str] | None]:
    graph = build_douban_subject_graph()
    initial: DoubanState = {"title": title, "kind_hint": kind_hint}
    conf: dict[str, Any] = {
        "bm": bm,
        "force_headed": force_headed,
        "timeout_ms": timeout_ms,
        "cover_cache_dir": cover_cache_dir.resolve(),
        "public_base_url": public_base_url,
    }
    final = await graph.ainvoke(initial, config={"configurable": conf})
    if final.get("error_code"):
        err = {"code": final["error_code"], "message": final.get("error_message", "")}
        return None, final.get("source_urls") or [], err
    data = final.get("subject_data")
    urls = final.get("source_urls") or []
    return data, urls, None
