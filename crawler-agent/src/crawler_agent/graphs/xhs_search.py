"""LangGraph: xiaohongshu / search.notes

Rich version ported from Nezu XHS Agent — features:
- Multi-probe login detection (API / context.request / localStorage / sidebar / cookie)
- QR-code login flow with screenshot push via progress callback
- Gemini text ranking + optional multimodal cover-vision
- Per-task tab isolation via BrowserManager.acquire_page / release_page
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from crawler_agent.browser_manager import BrowserManager, has_display
from crawler_agent.config import Settings
from crawler_agent.gemini import (
    ainvoke_llm_with_progress,
    get_llm,
    llm_response_text,
    parse_llm_json_array,
)
from crawler_agent.progress import SendMessage, noop_progress

log = logging.getLogger("crawler-agent.xhs")

_XHS_BASE_URL = "https://www.xiaohongshu.com"


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class XhsState(TypedDict, total=False):
    query: str
    limit: int
    headed_effective: bool
    needs_login: bool
    items: list[dict[str, Any]]
    source_urls: list[str]
    error_code: str
    error_message: str


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

async def _load_cookies(ctx, cookie_path) -> bool:
    if cookie_path is None or not cookie_path.exists():
        return False
    try:
        cookies = json.loads(cookie_path.read_text())
        if cookies:
            await ctx.add_cookies(cookies)
            return True
    except Exception:
        pass
    return False


async def _save_cookies(ctx, cookie_path) -> None:
    if cookie_path is None:
        return
    try:
        cookies = await ctx.cookies()
        cookie_path.parent.mkdir(parents=True, exist_ok=True)
        cookie_path.write_text(json.dumps(cookies, ensure_ascii=False, indent=2))
    except Exception:
        log.debug("Failed to save XHS cookies", exc_info=True)


# ---------------------------------------------------------------------------
# Login probes (5-level cascade)
# ---------------------------------------------------------------------------

_LOGIN_PROBE_JS = """
async () => {
    const origin = (typeof location !== 'undefined' && location.origin)
        ? location.origin
        : 'https://www.xiaohongshu.com';
    const hdr = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'referer': origin + '/explore',
        'origin': origin,
    };
    const paths = [
        '/api/sns/web/v1/user/selfinfo',
        '/api/sns/web/v2/user/me',
        '/api/sns/web/v1/user/me',
    ];
    for (const p of paths) {
        try {
            const r = await fetch(origin + p, {
                credentials: 'include',
                headers: hdr,
            });
            const txt = await r.text();
            let j;
            try { j = JSON.parse(txt); } catch (e) { continue; }
            if (j && j.success === false) continue;
            const d = j && j.data;
            if (!d || typeof d !== 'object') continue;
            const uid = d.user_id ?? d.userId ?? d.user_id_str;
            if (uid != null && String(uid).trim() !== '' && String(uid) !== '0') return true;
            const u = d.user_info ?? d.userInfo ?? d.basic_info ?? d.user;
            if (u && typeof u === 'object' && (u.user_id || u.userId)) return true;
        } catch (e) {}
    }
    return false;
}
"""

_LOGIN_FROM_WINDOW_JS = """
() => {
    function hasUid(o) {
        if (!o || typeof o !== 'object') return false;
        const u = o.userId ?? o.user_id ?? o.userID;
        if (u != null && String(u).trim() !== '' && String(u) !== '0') return true;
        if (o.user && hasUid(o.user)) return true;
        if (o.userInfo && hasUid(o.userInfo)) return true;
        if (o.user_info && hasUid(o.user_info)) return true;
        return false;
    }
    const storageKeyOk = (k) => k && /user|login|account|session|auth|persist|global|config|store|sso|token/i.test(k)
        && !/feed|note|search|cache|draft|temp/i.test(k);
    try {
        const g = typeof globalThis !== 'undefined' ? globalThis : window;
        const cands = [g.__INITIAL_STATE__, g.__NUXT__, g.__PRELOADED_STATE__, g.__REDUX_STATE__];
        for (const c of cands) {
            if (c && typeof c === 'object' && (hasUid(c) || hasUid(c.user) || hasUid(c.global)))
                return true;
        }
    } catch (e) {}
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!storageKeyOk(k)) continue;
            const raw = localStorage.getItem(k);
            if (!raw || raw.length < 30) continue;
            if (!/userId|user_id|nickname|avatar/i.test(raw)) continue;
            try {
                const j = JSON.parse(raw);
                if (hasUid(j)) return true;
            } catch (e) {
                if (/"userId"\\s*:\\s*"[0-9a-f]{8,}"/i.test(raw)) return true;
                if (/"user_id"\\s*:\\s*"[0-9a-f]{8,}"/i.test(raw)) return true;
            }
        }
    } catch (e) {}
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (!storageKeyOk(k)) continue;
            const raw = sessionStorage.getItem(k);
            if (!raw || raw.length < 30) continue;
            if (/"userId"\\s*:\\s*"[0-9a-f]{8,}"/i.test(raw)) return true;
        }
    } catch (e) {}
    return false;
}
"""

_LOGIN_SIDEBAR_ME_JS = """
() => {
    function inLeftNav(rect) {
        return rect.left >= 0 && rect.right <= 340 && rect.top >= 64 && rect.bottom <= 920;
    }
    let sawMe = false;
    let sawSidebarLogin = false;
    const all = document.querySelectorAll('a, button, [role="button"], div, span, li');
    for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (!inLeftNav(rect) || rect.width < 6 || rect.height < 6) continue;
        const t = (el.textContent || '').trim();
        if (t === '我' && rect.width < 200 && rect.height < 140) { sawMe = true; }
        if ((t === '登录' || t === '立即登录' || t.startsWith('登录'))
                && rect.width >= 48 && rect.height >= 24) { sawSidebarLogin = true; }
    }
    if (sawSidebarLogin) return false;
    return sawMe;
}
"""


def _login_json_indicates_user(data: dict) -> bool:
    if not isinstance(data, dict) or data.get("success") is False:
        return False
    d = data.get("data")
    if not isinstance(d, dict):
        return False
    uid = d.get("user_id") or d.get("userId") or d.get("user_id_str")
    if uid is not None and str(uid).strip() not in ("", "0", "null"):
        return True
    u = d.get("user_info") or d.get("userInfo") or d.get("basic_info")
    if isinstance(u, dict) and (u.get("user_id") or u.get("userId")):
        return True
    inner = d.get("user") or d.get("account")
    if isinstance(inner, dict) and (inner.get("user_id") or inner.get("userId")):
        return True
    return False


async def _login_cookie_account_signal(ctx) -> bool:
    """Check for strong login-only cookies (NOT set for anonymous visitors).

    ``customerClientId`` is deliberately excluded — XHS sets it for everyone.
    """
    try:
        cookies = await ctx.cookies("https://www.xiaohongshu.com")
        by = {c["name"]: (c.get("value") or "").strip() for c in cookies}
        if len(by.get("web_session", "")) < 12:
            return False
        for name in ("customer-sso-sid", "access-token-cookie", "ac_session_id"):
            if len(by.get(name, "")) >= 8:
                return True
    except Exception:
        pass
    return False


async def _is_logged_in_via_context_request(ctx) -> bool:
    hdr = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "referer": "https://www.xiaohongshu.com/explore",
        "origin": "https://www.xiaohongshu.com",
    }
    urls = (
        "https://www.xiaohongshu.com/api/sns/web/v1/user/selfinfo",
        "https://www.xiaohongshu.com/api/sns/web/v2/user/me",
        "https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo",
    )
    for url in urls:
        try:
            resp = await ctx.request.get(url, headers=hdr, timeout=15000)
            if resp.status >= 400:
                continue
            data = await resp.json()
            if _login_json_indicates_user(data):
                return True
        except Exception:
            continue
    return False


async def _is_logged_in(page) -> bool:
    """Full 5-level login detection. Use on stable pages (e.g. after navigating to homepage)."""
    if page.is_closed():
        return False
    try:
        if await page.evaluate(_LOGIN_PROBE_JS):
            return True
    except Exception as exc:
        log.warning("Login probe (in-page fetch) failed: %s", exc)
    try:
        if await _is_logged_in_via_context_request(page.context):
            return True
    except Exception as exc:
        log.warning("Login probe (context request) failed: %s", exc)
    try:
        if await page.evaluate(_LOGIN_FROM_WINDOW_JS):
            log.info("Login detected via window/localStorage heuristic")
            return True
    except Exception as exc:
        log.warning("Login probe (window/storage) failed: %s", exc)
    try:
        if await page.evaluate(_LOGIN_SIDEBAR_ME_JS):
            log.info("Login detected via sidebar「我」")
            return True
    except Exception as exc:
        log.warning("Login probe (sidebar) failed: %s", exc)
    try:
        if await _login_cookie_account_signal(page.context):
            log.info("Login detected via SSO/token cookie heuristic")
            return True
    except Exception as exc:
        log.warning("Login probe (cookie) failed: %s", exc)
    return False


async def _is_logged_in_light(page) -> bool:
    """Login check for polling during QR/phone login.

    Uses the same full detection as ``_is_logged_in`` — this works reliably
    when the browser has a proper user_agent set (matching Nezu's approach).
    """
    return await _is_logged_in(page)


# ---------------------------------------------------------------------------
# Deduplication helpers
# ---------------------------------------------------------------------------

def _xhs_note_key(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    m = re.search(r"/(?:explore|discovery/item)/([0-9a-f]{20,})", u, re.I)
    if m:
        return m.group(1).lower()
    try:
        from urllib.parse import urlparse
        p = urlparse(u)
        path = (p.path or "").rstrip("/")
        return f"{(p.netloc or '').lower()}{path.lower()}"
    except Exception:
        return u.lower()


def _dedupe_raw_cards(cards: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        key = _xhs_note_key(c.get("url", ""))
        if not key:
            key = f"c:{c.get('cover_image', '')}:{(c.get('title') or '')[:40]}"
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def _dedupe_result_posts(posts: list) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for p in posts:
        if not isinstance(p, dict):
            continue
        key = _xhs_note_key(p.get("url", ""))
        if not key:
            key = f"p:{p.get('cover_image', '')}:{(p.get('title') or '')[:40]}"
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


# ---------------------------------------------------------------------------
# Vision helpers (fetch cover thumbnails for Gemini multimodal)
# ---------------------------------------------------------------------------

async def _fetch_cover_bytes(ctx, url: str, *, timeout_ms: int, max_bytes: int):
    u = (url or "").strip()
    if not u.startswith("http"):
        return None
    try:
        resp = await ctx.request.get(
            u,
            timeout=timeout_ms,
            headers={
                "Referer": f"{_XHS_BASE_URL}/",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
        )
        if resp.status != 200:
            return None
        body = await resp.body()
        if len(body) < 32 or len(body) > max_bytes:
            return None
        ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not ct.startswith("image/"):
            ct = "image/jpeg"
        return (body, ct)
    except Exception:
        return None


async def _fetch_covers_for_vision(
    ctx, cards: list[dict], *, concurrency: int, timeout_ms: int, max_bytes: int
) -> list[tuple[bytes, str] | None]:
    n = len(cards)
    if n == 0:
        return []
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(i: int):
        async with sem:
            url = cards[i].get("cover_image", "")
            data = await _fetch_cover_bytes(ctx, url, timeout_ms=timeout_ms, max_bytes=max_bytes)
            return (i, data)

    ordered = await asyncio.gather(*(_one(i) for i in range(n)))
    ordered_sorted = sorted(ordered, key=lambda x: x[0])
    return [pair[1] for pair in ordered_sorted]


# ---------------------------------------------------------------------------
# Gemini prompt builders
# ---------------------------------------------------------------------------

def _search_ranking_prompt_text(
    query: str, dom_json: str, page_text: str, max_posts: int,
    *, vision_extra: str = "",
) -> str:
    return f"""You are analyzing Xiaohongshu search results for: "{query}"
{vision_extra}
Here are the DOM-extracted cards (may be incomplete). Each card may include:
- text_layout_heavy (boolean): when true, the listing's text layout often indicates a typography-heavy /
  screenshot-style cover — treat as LOW visual quality for ranking unless title/img_alt clearly
  describe a real photo scene.
- img_alt, img_w, img_h: optional hints from the <img>.

{dom_json}

Page visible text (fallback):
{page_text[:4000]}

Select exactly {max_posts} posts. Priority order:
(1) Relevance to "{query}" — must still fit the user's intent.
(2) Cover must *visually* look like a real photograph or strong illustration:
    people, places, food, fashion, objects in a real scene. These are GOOD.
(3) STRONGLY AVOID choosing covers that are mainly TEXT: 纯文字封面、大字报、干货清单截图、
    备忘录/聊天/PPT 文字页、课程目录、资源打包说明图.
(4) Deprioritize blurry mess, chaotic collages, and generic stock-looking thumbnails.

Each object MUST have these fields:
  title       – post title (string)
  nickname    – author name (string)
  preview     – 1-2 sentence summary (string)
  url         – the COMPLETE post URL exactly as it appears in the DOM data, including ALL query
                parameters (xsec_token, xsec_source, source, etc.). Do NOT strip or shorten the URL.
  cover_image – image URL (string, empty if unknown)

CRITICAL: The url field must preserve the full query string from the input data.

Return ONLY the JSON array, no markdown fences, no extra text."""


def _search_vision_human_message(
    query: str, dom_json: str, page_text: str, max_posts: int,
    cards_for_images: list[dict],
    image_payloads: list[tuple[bytes, str] | None],
    n_cards_total: int,
) -> HumanMessage:
    n_img = len(cards_for_images)
    preamble = f"""
MULTIMODAL INPUT: After the text below, cover thumbnails follow in order.
- The JSON lists {n_cards_total} cards (indices 0 .. {n_cards_total - 1}).
- Images are attached ONLY for indices 0 .. {n_img - 1}.
- You MUST look at each attached image to detect typography-only / screenshot-style covers vs real photos.

"""
    text_block = _search_ranking_prompt_text(
        query, dom_json, page_text, max_posts, vision_extra=preamble,
    )
    parts: list[str | dict] = [{"type": "text", "text": text_block}]
    for i, card in enumerate(cards_for_images):
        title_hint = (card.get("title") or "")[:120]
        parts.append({"type": "text", "text": f"\n--- Card index {i} ---\nTitle hint: {title_hint!r}\n"})
        payload = image_payloads[i] if i < len(image_payloads) else None
        if payload:
            blob, mime = payload
            parts.append({"type": "media", "mime_type": mime, "data": blob})
        else:
            parts.append({"type": "text", "text": "(cover image could not be loaded)\n"})
    return HumanMessage(content=parts)


# ---------------------------------------------------------------------------
# Graph nodes
# ---------------------------------------------------------------------------

async def node_prepare(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    cfg = config["configurable"]
    bm: BrowserManager = cfg["bm"]
    settings: Settings = cfg["settings"]
    send: SendMessage = cfg["send"]
    force_headed: bool = bool(cfg.get("force_headed"))

    headed = force_headed or not settings.xhs_headless_effective
    page = cfg["page"]
    ctx = page.context

    await send("status", {"message": "正在启动浏览器…"})

    loaded_file = await _load_cookies(ctx, settings.xhs_cookie_path)
    if loaded_file:
        await send("status", {"message": "已合并本地 Cookie 文件，正在验证登录…"})
    else:
        await send("status", {"message": "正在打开小红书并检测登录状态…"})

    try:
        await page.goto(_XHS_BASE_URL, wait_until="domcontentloaded", timeout=15000)
    except Exception:
        pass
    await asyncio.sleep(3)

    if await _is_logged_in(page):
        await send("status", {"message": "✓ 已登录小红书"})
        return {"needs_login": False, "headed_effective": headed}

    return {"needs_login": True, "headed_effective": headed}


def _route_login(state: XhsState) -> str:
    if state.get("error_code"):
        return "finalize"
    return "qr_login" if state.get("needs_login") else "search"


async def node_qr_login(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    cfg = config["configurable"]
    settings: Settings = cfg["settings"]
    send: SendMessage = cfg["send"]
    page = cfg["page"]
    ctx = page.context

    await send("status", {"message": "正在打开小红书登录页…"})
    try:
        await page.goto(_XHS_BASE_URL, wait_until="domcontentloaded", timeout=15000)
    except Exception:
        pass
    await asyncio.sleep(3)

    try:
        login_btn = page.locator("text=登录").first
        if await login_btn.is_visible(timeout=2000):
            await login_btn.click()
            await asyncio.sleep(2)
    except Exception:
        pass

    headless = settings.xhs_headless_effective
    if headless:
        await send("status", {"message": "请在网页端扫描二维码登录"})
    else:
        await send("status", {"message": "浏览器已打开登录页，请在浏览器窗口中用小红书 App 扫码登录"})

    shot = await page.screenshot(type="png")
    await send("qr_code", {"image": f"data:image/png;base64,{base64.b64encode(shot).decode()}"})

    timeout = settings.xhs_login_timeout_s
    poll_interval = 5
    elapsed = 0

    while elapsed < timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        if await _is_logged_in_light(page):
            await _save_cookies(ctx, settings.xhs_cookie_path)
            await send("status", {"message": "✓ 登录成功！"})
            return {"needs_login": False}

        if elapsed % 15 == 0:
            try:
                shot = await page.screenshot(type="png")
                await send("qr_code", {"image": f"data:image/png;base64,{base64.b64encode(shot).decode()}"})
            except Exception:
                pass

    return {
        "error_code": "SESSION_TIMEOUT",
        "error_message": "登录超时，请重新搜索以再次尝试",
    }


async def node_search(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}

    cfg = config["configurable"]
    settings: Settings = cfg["settings"]
    send: SendMessage = cfg["send"]
    page = cfg["page"]
    query = state["query"]
    max_posts = settings.xhs_max_posts

    await send("status", {"message": f'正在搜索: "{query}"'})

    search_url = f"{_XHS_BASE_URL}/search_result?keyword={query}&source=web_search_result_note"
    await page.goto(search_url, wait_until="domcontentloaded", timeout=15000)
    await asyncio.sleep(3)

    if "login" in page.url.lower():
        return {
            "error_code": "NEED_LOGIN",
            "error_message": "当前会话未登录小红书，请先登录。",
            "source_urls": [page.url],
        }

    await send("status", {"message": "正在加载搜索结果…"})
    for _ in range(max(1, settings.xhs_search_scroll_rounds)):
        await page.evaluate("window.scrollBy(0, 600)")
        await asyncio.sleep(1)

    # ---------- DOM extraction ----------
    await send("status", {"message": "正在提取帖子信息…"})
    cap = max(1, settings.xhs_max_dom_candidates)
    raw_cards = await page.evaluate(
        f"""() => {{
        function noteKey(href) {{
            if (!href) return '';
            try {{
                const u = new URL(href);
                const path = u.pathname || '';
                const m = path.match(/\\/(?:explore|discovery\\/item)\\/([0-9a-f]{{20,}})/i);
                if (m) return m[1].toLowerCase();
                return (u.origin + path).toLowerCase();
            }} catch (e) {{ return href; }}
        }}
        const nodes = document.querySelectorAll('section.note-item, [data-note-id], a.cover');
        const seen = new Set();
        const out = [];
        for (const el of nodes) {{
            const a = el.tagName === 'A' ? el : el.querySelector('a');
            const href = a?.href || '';
            const k = noteKey(href);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            const img = el.querySelector('img');
            const titleEl = el.querySelector('.title, h3, [class*="title"], .note-text');
            const authorEl = el.querySelector('.author-wrapper, [class*="author"], .nickname');
            const snippet = (el.innerText || '').substring(0, 420);
            const lines = snippet.split(/\\n/).map(s => s.trim()).filter(Boolean);
            const longLines = lines.filter(s => s.length >= 10).length;
            const text_layout_heavy = lines.length >= 6 && longLines >= 4 && snippet.length >= 100;
            const noteId = (function(h) {{
                const m2 = h.match(/\\/(?:explore|discovery\\/item)\\/([0-9a-f]{{20,}})/i);
                return m2 ? m2[1] : '';
            }})(href);
            out.push({{
                title: titleEl?.innerText || '',
                nickname: authorEl?.innerText || '',
                cover_image: img?.src || '',
                img_alt: img?.alt || '',
                img_w: img?.naturalWidth || 0,
                img_h: img?.naturalHeight || 0,
                text_layout_heavy,
                url: href,
                note_id: noteId,
                html: el.innerText?.substring(0, 240) || '',
            }});
            if (out.length >= {cap}) break;
        }}
        return out;
    }}"""
    )
    raw_cards = _dedupe_raw_cards(raw_cards)

    # ---------- Gemini enrichment ----------
    await send("status", {"message": "AI 正在分析搜索结果…"})
    page_text = await page.evaluate("() => document.body.innerText.substring(0, 6000)")
    dom_json = json.dumps(raw_cards[:cap], ensure_ascii=False)
    n_cards = len(raw_cards)

    vision_cap = min(n_cards, max(0, settings.xhs_gemini_vision_max_covers))
    cards_for_vision = raw_cards[:vision_cap]
    image_payloads: list[tuple[bytes, str] | None] = []
    use_vision = (
        settings.xhs_gemini_use_vision
        and vision_cap > 0
        and (settings.google_api_key or "").strip()
    )

    if use_vision:
        await send("status", {"message": f"正在下载封面图（{vision_cap} 张）→ 多模态视觉判断…"})
        image_payloads = await _fetch_covers_for_vision(
            page.context,
            cards_for_vision,
            concurrency=settings.xhs_gemini_cover_fetch_concurrency,
            timeout_ms=settings.xhs_gemini_cover_fetch_timeout_ms,
            max_bytes=settings.xhs_gemini_cover_max_bytes,
        )
        n_loaded = sum(1 for p in image_payloads if p)
        await send("status", {"message": f"封面下载 {n_loaded}/{vision_cap}，正在请求模型筛选…"})
    else:
        await send("status", {"message": f"已汇总 {n_cards} 条笔记，正在请求模型筛选…"})

    def _posts_from_dom() -> list[dict]:
        return [
            {
                "title": c.get("title") or "(无标题)",
                "nickname": c.get("nickname") or "未知用户",
                "preview": (c.get("html") or "")[:80],
                "url": c.get("url", ""),
                "note_id": c.get("note_id", ""),
                "cover_image": c.get("cover_image", ""),
            }
            for c in raw_cards[:max_posts]
        ]

    llm = get_llm(settings.google_api_key, settings.gemini_model)
    posts: list[dict] = []

    if llm is None:
        await send("status", {"message": "未配置 GOOGLE_API_KEY，直接使用页面提取结果"})
        posts = _posts_from_dom()
    else:
        n_loaded = sum(1 for p in image_payloads if p) if image_payloads else 0
        llm_input: str | HumanMessage
        if use_vision and n_loaded > 0:
            llm_input = _search_vision_human_message(
                query, dom_json, page_text, max_posts,
                cards_for_vision, image_payloads, n_cards,
            )
        else:
            llm_input = _search_ranking_prompt_text(query, dom_json, page_text, max_posts)
        try:
            resp = await ainvoke_llm_with_progress(
                llm, llm_input, send,
                settings.gemini_request_timeout_s,
                progress_interval=settings.gemini_progress_interval_s,
            )
            await send("status", {"message": "AI 已返回，正在解析结果…"})
            text = llm_response_text(resp)
            posts = parse_llm_json_array(text)
            posts = _dedupe_result_posts(posts)
        except asyncio.TimeoutError:
            await send("status", {"message": "AI 分析超时，使用 DOM 提取结果"})
            posts = _posts_from_dom()
        except Exception as e:
            hint = ""
            if "location is not supported" in str(e).lower():
                hint = "（当前地区不支持 Gemini API）"
            await send("status", {"message": f"AI 分析失败{hint}，使用 DOM 提取结果: {e}"})
            posts = _posts_from_dom()

    def _extract_note_id(url: str) -> str:
        m = re.search(r"/(?:explore|discovery/item)/([0-9a-f]{20,})", url or "", re.I)
        return m.group(1).lower() if m else ""

    for i, p in enumerate(posts[:max_posts]):
        p["id"] = f"xhs_{i}"
        p["platform"] = "xhs"
        if not (p.get("note_id") or "").strip():
            p["note_id"] = _extract_note_id(p.get("url", ""))
        p.setdefault("images", [p["cover_image"]] if p.get("cover_image") else [])
        p.setdefault("avatar", p.get("cover_image", ""))

    await send("status", {"message": f"✓ 找到 {len(posts[:max_posts])} 个结果"})
    return {
        "items": posts[:max_posts],
        "source_urls": list({*(state.get("source_urls") or []), page.url}),
    }


async def node_finalize(state: XhsState, config: RunnableConfig) -> dict[str, Any]:
    if state.get("error_code"):
        return {}
    return {}


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def _build_xhs_graph():
    g = StateGraph(XhsState)
    g.add_node("prepare", node_prepare)
    g.add_node("qr_login", node_qr_login)
    g.add_node("search", node_search)
    g.add_node("finalize", node_finalize)

    g.add_edge(START, "prepare")
    g.add_conditional_edges("prepare", _route_login, {
        "qr_login": "qr_login",
        "search": "search",
        "finalize": "finalize",
    })
    g.add_edge("qr_login", "search")
    g.add_edge("search", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_xhs_search_notes(
    bm: BrowserManager,
    settings: Settings,
    *,
    query: str,
    limit: int = 10,
    force_headed: bool = False,
    timeout_ms: int = 120_000,
    on_progress: SendMessage | None = None,
) -> tuple[dict[str, Any] | None, list[str], dict[str, str] | None]:
    """Run the full XHS search workflow.

    Returns ``(data, source_urls, error_dict | None)``.
    """
    send = on_progress or noop_progress()
    headed = force_headed or not settings.xhs_headless_effective

    page = await bm.acquire_page("xiaohongshu", headed=headed)
    try:
        graph = _build_xhs_graph()
        final = await graph.ainvoke(
            {"query": query, "limit": limit},
            config={
                "configurable": {
                    "bm": bm,
                    "settings": settings,
                    "send": send,
                    "page": page,
                    "force_headed": force_headed,
                    "timeout_ms": timeout_ms,
                }
            },
        )

        await _save_cookies(page.context, settings.xhs_cookie_path)

        if final.get("error_code"):
            err = {"code": final["error_code"], "message": final.get("error_message", "")}
            return None, final.get("source_urls") or [], err

        items = final.get("items") or []
        data = {"platform": "xhs", "cards": items}
        return data, final.get("source_urls") or [], None

    except Exception as exc:
        log.exception("XHS search failed: %s", exc)
        return None, [], {"code": "INTERNAL", "message": str(exc)[:500]}
    finally:
        await bm.release_page("xiaohongshu", page)
