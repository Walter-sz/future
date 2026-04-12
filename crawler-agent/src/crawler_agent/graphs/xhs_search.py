"""LangGraph: xiaohongshu / search.notes"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, TypedDict
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from crawler_agent import human
from crawler_agent.browser_manager import BrowserManager, has_display, probe_xhs_session


class XhsState(TypedDict, total=False):
    query: str
    limit: int
    headed_effective: bool
    items: list[dict[str, Any]]
    source_urls: list[str]
    error_code: str
    error_message: str


async def _wait_until_xhs_ok(page, timeout_s: float) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        if await probe_xhs_session(page):
            return True
        await asyncio.sleep(2.5)
    return await probe_xhs_session(page)


async def node_ensure_session(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    force_headed: bool = bool(cfg.get("force_headed"))
    timeout_ms: int = int(cfg.get("timeout_ms", 120_000))
    timeout_s = min(600.0, max(45.0, timeout_ms / 1000.0 * 0.5))

    headed = force_headed
    page = await bm.get_page("xiaohongshu", headed=headed)
    if await probe_xhs_session(page):
        return {"headed_effective": headed}

    if not headed and has_display():
        await bm.close_site("xiaohongshu")
        headed = True
        page = await bm.get_page("xiaohongshu", headed=True)

    if not headed and not has_display():
        return {
            "error_code": "NEED_DISPLAY",
            "error_message": "小红书需要登录或验证。请设置 DISPLAY 后重试，或运行: python -m crawler_agent login xiaohongshu",
            "headed_effective": False,
        }

    try:
        ok = await asyncio.wait_for(_wait_until_xhs_ok(page, timeout_s), timeout=timeout_s + 15)
    except TimeoutError:
        ok = False
    if not ok:
        return {
            "error_code": "SESSION_TIMEOUT",
            "error_message": "等待小红书会话可用超时，请在浏览器中完成登录。",
            "headed_effective": headed,
        }
    return {"headed_effective": headed}


async def node_search_and_collect(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    headed = bool(state.get("headed_effective", False))
    page = await bm.get_page("xiaohongshu", headed=headed)
    q = state["query"]
    limit = int(state.get("limit") or 10)

    kw = quote(q)
    url = f"https://www.xiaohongshu.com/search_result?keyword={kw}&source=unknown"
    await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    await human.jitter(0.5, 1.0)
    await human.scroll_lazy(page, steps=min(8, max(3, limit // 2)), px=400)

    if "login" in page.url.lower():
        return {
            "error_code": "NEED_LOGIN",
            "error_message": "当前会话未登录小红书，请先登录。",
            "source_urls": [page.url],
        }

    items = await page.evaluate(
        f"""() => {{
          const limit = {int(limit)};
          const cards = Array.from(document.querySelectorAll('section.note-item, .note-item, a.cover'));
          const out = [];
          const seen = new Set();
          for (const el of cards) {{
            const a = el.tagName === 'A' ? el : el.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"]');
            if (!a || !a.href) continue;
            const m = a.href.match(/\\/(explore|discovery\\/item)\\/([a-zA-Z0-9]+)/);
            const id = m ? m[2] : null;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const titleEl = el.querySelector('.title, .note-title, span.title');
            const title = (titleEl && titleEl.textContent ? titleEl.textContent : '').trim();
            const authorEl = el.querySelector('.author .name, .author span, .nickname');
            const author = (authorEl && authorEl.textContent ? authorEl.textContent : '').trim();
            const img = el.querySelector('img');
            const cover = img ? img.src : null;
            out.push({{ noteId: id, url: a.href, title, author, coverUrl: cover }});
            if (out.length >= limit) break;
          }}
          return out;
        }}"""
    )

    return {
        "items": items or [],
        "source_urls": list({*(state.get("source_urls") or []), page.url}),
    }


async def node_finalize(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    items = state.get("items") or []
    wrapped = [
        {
            **it,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        for it in items
    ]
    return {"items": wrapped}


def build_xhs_search_graph() -> StateGraph:
    g = StateGraph(XhsState)
    g.add_node("ensure_session", node_ensure_session)
    g.add_node("search", node_search_and_collect)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "ensure_session")
    g.add_edge("ensure_session", "search")
    g.add_edge("search", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


async def run_xhs_search_notes(
    bm: BrowserManager,
    *,
    query: str,
    limit: int,
    force_headed: bool,
    timeout_ms: int,
) -> tuple[dict[str, Any] | None, list[str], dict[str, str] | None]:
    graph = build_xhs_search_graph()
    final = await graph.ainvoke(
        {"query": query, "limit": limit},
        config={"configurable": {"bm": bm, "force_headed": force_headed, "timeout_ms": timeout_ms}},
    )
    if final.get("error_code"):
        err = {"code": final["error_code"], "message": final.get("error_message", "")}
        return None, final.get("source_urls") or [], err
    return {"items": final.get("items") or []}, final.get("source_urls") or [], None
