"""Persistent Playwright contexts per site with multi-tab concurrency.

Each *site* gets one persistent Chromium context (shared cookies / login state).
Each *task* gets its own tab (Page) via ``acquire_page`` / ``release_page``,
so multiple users can run tasks on the same site concurrently without page
navigation conflicts.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page, Playwright

from crawler_agent.config import Settings

log = logging.getLogger("crawler-agent.browser")

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

_STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
window.chrome = { runtime: {} };
Object.defineProperty(navigator, 'permissions', {
    get: () => ({ query: (params) => Promise.resolve({ state: 'granted', onchange: null }) }),
});
"""


class BrowserManager:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._playwright: Playwright | None = None
        self._contexts: dict[str, BrowserContext] = {}
        self._headed: dict[str, bool] = {}
        # Lock protects context creation / headed-switching per site
        self._ctx_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        # Semaphore limits concurrent tabs per site
        self._site_sems: dict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(max(1, settings.max_concurrent_per_site))
        )

    @property
    def settings(self) -> Settings:
        return self._settings

    def profile_path(self, site: str) -> Path:
        base = self._settings.profile_dir.resolve()
        return base / site

    async def _pw(self) -> Playwright:
        if self._playwright is None:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()
        return self._playwright

    async def close_site(self, site: str) -> None:
        async with self._ctx_locks[site]:
            ctx = self._contexts.pop(site, None)
            self._headed.pop(site, None)
            if ctx:
                await ctx.close()

    async def get_context(self, site: str, *, headed: bool) -> BrowserContext:
        async with self._ctx_locks[site]:
            pw = await self._pw()
            existing = self._contexts.get(site)
            if existing and self._headed.get(site) == headed:
                return existing
            if existing:
                await existing.close()
                self._contexts.pop(site, None)

            path = self.profile_path(site)
            path.mkdir(parents=True, exist_ok=True)

            _clear_singleton_locks(path)

            ctx = await pw.chromium.launch_persistent_context(
                user_data_dir=str(path),
                headless=not headed,
                user_agent=_USER_AGENT,
                viewport={"width": 1365, "height": 900},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-setuid-sandbox",
                    "--no-sandbox",
                ],
            )
            await ctx.add_init_script(_STEALTH_INIT_SCRIPT)
            self._contexts[site] = ctx
            self._headed[site] = headed
            return ctx

    # ------------------------------------------------------------------
    # Legacy single-page access (used by douban graph which shares a page
    # across ensure_session → search → pick → fetch → normalise pipeline)
    # ------------------------------------------------------------------

    async def get_page(self, site: str, *, headed: bool) -> Page:
        ctx = await self.get_context(site, headed=headed)
        if ctx.pages:
            return ctx.pages[0]
        return await ctx.new_page()

    # ------------------------------------------------------------------
    # Multi-tab API: each caller gets its own tab, safe for concurrency
    # ------------------------------------------------------------------

    async def acquire_page(self, site: str, *, headed: bool) -> Page:
        """Open a new tab in the site's context (blocks if per-site limit is reached)."""
        await self._site_sems[site].acquire()
        try:
            ctx = await self.get_context(site, headed=headed)
            return await ctx.new_page()
        except Exception:
            self._site_sems[site].release()
            raise

    async def release_page(self, site: str, page: Page) -> None:
        """Close the tab and release the per-site semaphore slot."""
        try:
            if not page.is_closed():
                await page.close()
        except Exception:
            log.debug("Error closing page for %s", site, exc_info=True)
        finally:
            self._site_sems[site].release()

    # ------------------------------------------------------------------

    async def shutdown(self) -> None:
        for site in list(self._contexts.keys()):
            await self.close_site(site)
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def has_display() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _clear_singleton_locks(profile_dir: Path) -> None:
    """Remove stale Chromium singleton locks left by crashed processes."""
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        p = profile_dir / name
        if p.exists():
            try:
                p.unlink()
                log.info("Removed stale lock: %s", p)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Douban session probes
# ---------------------------------------------------------------------------


def _douban_login_or_challenge_url(url: str) -> bool:
    u = (url or "").lower()
    return (
        "sec.douban.com" in u
        or "accounts.douban.com" in u
        or "checkpoint" in u
        or "passport" in u
    )


async def probe_douban_session(page: Page) -> bool:
    """Return True if movie.douban.com loads without hard block."""
    from crawler_agent import human

    cur = page.url or ""
    if _douban_login_or_challenge_url(cur):
        try:
            body = await page.content()
        except Exception:
            return False
        if "验证" in body and ("滑动" in body or "验证码" in body):
            return False
        return False

    need_goto = "movie.douban.com" not in cur
    if need_goto:
        try:
            await page.goto(
                "https://movie.douban.com/",
                wait_until="domcontentloaded",
                timeout=45_000,
            )
        except Exception:
            return False
    await human.jitter(0.2, 0.5)
    url = page.url
    body = await page.content()
    if "sec.douban.com" in url or "checkpoint" in url.lower():
        return False
    if "验证" in body and ("滑动" in body or "验证码" in body):
        return False
    return True
