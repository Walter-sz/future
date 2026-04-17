"""豆瓣请求限速：搜索阶段允许有限并发，条目详情串行，带随机间隔（防风控）。

环境变量（可选）：
- DOUBAN_SEARCH_CONCURRENCY：搜索并发上限，默认 2
- DOUBAN_MIN_GAP_SEC / DOUBAN_MAX_GAP_SEC：搜索阶段出锁后间隔，默认 0.35–0.9
- DOUBAN_DETAIL_MIN_GAP_SEC / DOUBAN_DETAIL_MAX_GAP_SEC：详情阶段，默认 2.5–6.0
"""

from __future__ import annotations

import asyncio
import os
import random
from contextlib import asynccontextmanager
from typing import AsyncIterator

_search_sem_instance: asyncio.Semaphore | None = None
_detail_sem_instance: asyncio.Semaphore | None = None


def _search_concurrency() -> int:
    raw = (os.environ.get("DOUBAN_SEARCH_CONCURRENCY") or "2").strip()
    try:
        n = int(raw)
    except ValueError:
        return 2
    return max(1, min(n, 4))


def _get_search_sem() -> asyncio.Semaphore:
    global _search_sem_instance
    if _search_sem_instance is None:
        _search_sem_instance = asyncio.Semaphore(_search_concurrency())
    return _search_sem_instance


def _get_detail_sem() -> asyncio.Semaphore:
    global _detail_sem_instance
    if _detail_sem_instance is None:
        _detail_sem_instance = asyncio.Semaphore(1)
    return _detail_sem_instance


async def _gap(*, kind: str) -> None:
    if kind == "search":
        lo = float(os.environ.get("DOUBAN_MIN_GAP_SEC", "0.35"))
        hi = float(os.environ.get("DOUBAN_MAX_GAP_SEC", "0.9"))
    else:
        lo = float(os.environ.get("DOUBAN_DETAIL_MIN_GAP_SEC", "2.5"))
        hi = float(os.environ.get("DOUBAN_DETAIL_MAX_GAP_SEC", "6.0"))
    if hi < lo:
        lo, hi = hi, lo
    await asyncio.sleep(random.uniform(lo, hi))


@asynccontextmanager
async def douban_search_phase() -> AsyncIterator[None]:
    """搜索 / suggest 等轻量步骤：默认可 2 并发。"""
    async with _get_search_sem():
        yield
    await _gap(kind="search")


@asynccontextmanager
async def douban_detail_phase() -> AsyncIterator[None]:
    """subject 详情页、推荐区解析等：全局串行。"""
    async with _get_detail_sem():
        yield
    await _gap(kind="detail")
