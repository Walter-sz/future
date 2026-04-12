"""Persistent Playwright contexts per site (serialised per site)."""

from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page, Playwright

from crawler_agent.config import Settings


class BrowserManager:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._playwright: Playwright | None = None
        self._contexts: dict[str, BrowserContext] = {}
        self._headed: dict[str, bool] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def profile_path(self, site: str) -> Path:
        base = self._settings.profile_dir.resolve()
        return base / site

    async def _pw(self):
        if self._playwright is None:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()
        return self._playwright

    async def close_site(self, site: str) -> None:
        async with self._locks[site]:
            ctx = self._contexts.pop(site, None)
            self._headed.pop(site, None)
            if ctx:
                await ctx.close()

    async def get_context(self, site: str, *, headed: bool) -> BrowserContext:
        async with self._locks[site]:
            pw = await self._pw()
            existing = self._contexts.get(site)
            if existing and self._headed.get(site) == headed:
                return existing
            if existing:
                await existing.close()
                self._contexts.pop(site, None)

            path = self.profile_path(site)
            path.mkdir(parents=True, exist_ok=True)

            ctx = await pw.chromium.launch_persistent_context(
                user_data_dir=str(path),
                headless=not headed,
                viewport={"width": 1365, "height": 900},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            self._contexts[site] = ctx
            self._headed[site] = headed
            return ctx

    async def get_page(self, site: str, *, headed: bool) -> Page:
        ctx = await self.get_context(site, headed=headed)
        if ctx.pages:
            return ctx.pages[0]
        return await ctx.new_page()

    async def shutdown(self) -> None:
        for site in list(self._contexts.keys()):
            await self.close_site(site)
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None


def has_display() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _douban_login_or_challenge_url(url: str) -> bool:
    """用户正在登录/验证/checkpoint 流程时，不可再 goto 首页，否则会反复打断当前页。"""
    u = (url or "").lower()
    return (
        "sec.douban.com" in u
        or "accounts.douban.com" in u
        or "checkpoint" in u
        or "passport" in u
    )


async def probe_douban_session(page) -> bool:
    """Return True if movie.douban.com loads without hard block.

    若在登录页、验证页或 sec/checkpoint，**不会**再次 ``goto`` 电影首页，避免
    ``_wait_until_session_ok`` 每 2.5s 调用本函数时把用户正在操作的页面刷掉。
    """
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
            await page.goto("https://movie.douban.com/", wait_until="domcontentloaded", timeout=45_000)
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


async def probe_xhs_session(page) -> bool:
    try:
        await page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=45_000)
    except Exception:
        return False
    url = page.url.lower()
    if "login" in url:
        return False
    body = await page.content()
    if "登录" in body and "手机号" in body:
        return False
    return True
