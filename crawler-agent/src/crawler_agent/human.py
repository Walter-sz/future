"""Human-like delays and input for Playwright."""

from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.async_api import Page


async def jitter(a: float = 0.12, b: float = 0.42) -> None:
    await asyncio.sleep(random.uniform(a, b))


async def human_type(page: Page, selector: str, text: str, *, timeout_ms: int = 30_000) -> None:
    el = await page.wait_for_selector(selector, timeout=timeout_ms)
    await el.click()
    await jitter(0.05, 0.15)
    for ch in text:
        await page.keyboard.type(ch, delay=random.randint(35, 110))
    await jitter(0.1, 0.25)


async def scroll_lazy(page: Page, steps: int = 4, px: int = 420) -> None:
    for _ in range(steps):
        await page.mouse.wheel(0, px + random.randint(-40, 40))
        await jitter(0.25, 0.65)
