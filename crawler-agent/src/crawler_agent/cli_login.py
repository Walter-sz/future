"""Headed persistent-context login helper."""

from __future__ import annotations

import asyncio
import sys

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import get_settings


async def amain(argv: list[str]) -> None:
    if len(argv) < 2 or argv[0] != "login":
        print("用法: python -m crawler_agent login <douban|xiaohongshu>", file=sys.stderr)
        sys.exit(2)
    site = argv[1].strip().lower()
    if site not in ("douban", "xiaohongshu"):
        print("site 必须是 douban 或 xiaohongshu", file=sys.stderr)
        sys.exit(2)

    settings = get_settings()
    bm = BrowserManager(settings)
    try:
        await bm.close_site(site)
        page = await bm.get_page(site, headed=True)
        if site == "douban":
            await page.goto("https://accounts.douban.com/passport/login", timeout=60_000)
        else:
            await page.goto("https://www.xiaohongshu.com/login", timeout=60_000)
        print("已在持久化浏览器中打开登录页。完成登录后回到此终端按 Enter 退出（会话会写入 profile）。")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: input())
    finally:
        await bm.shutdown()
