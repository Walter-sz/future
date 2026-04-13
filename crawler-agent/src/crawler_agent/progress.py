"""Typed progress callback used by graphs to push real-time updates.

REST callers pass ``None`` (updates silently discarded).
WebSocket callers pass a real coroutine that forwards JSON to the client.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol


class ProgressCallback(Protocol):
    async def __call__(self, msg_type: str, payload: dict[str, Any]) -> None: ...


SendMessage = Callable[[str, dict[str, Any]], Awaitable[None]]


async def _noop(_msg_type: str, _payload: dict[str, Any]) -> None:
    """Silent sink – used when no progress listener is attached."""


def noop_progress() -> SendMessage:
    return _noop
