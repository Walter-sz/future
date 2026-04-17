"""Reverse-WebSocket connector: connect TO a Nezu server and accept search tasks.

Usage:
    python -m crawler_agent.reverse_ws ws://10.34.255.185:5153/crawler/register

Or via config:
    CRAWLER_NEZU_URL=ws://10.34.255.185:5153/crawler/register crawler-agent-bridge
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from typing import Any

import websockets
from websockets.asyncio.client import connect

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import Settings, get_settings
from crawler_agent.models import TaskRunRequest
from crawler_agent.registry import run_task

log = logging.getLogger("crawler-agent.reverse-ws")


async def _handle_search(
    ws,
    msg: dict[str, Any],
    settings: Settings,
    bm: BrowserManager,
    sem: asyncio.Semaphore,
) -> None:
    """Handle a search task from the Nezu server."""
    request_id = msg.get("request_id", "")
    query = msg.get("query", "")
    platform = msg.get("platform", "xhs")

    async def send_progress(msg_type: str, payload: dict[str, Any]) -> None:
        try:
            out = {"type": msg_type, "request_id": request_id, **payload}
            await ws.send(json.dumps(out, ensure_ascii=False))
        except Exception:
            pass

    if platform == "x":
        site, task = "x", "search.posts"
        params: dict[str, Any] = {"query": query}
    else:
        site, task = "xiaohongshu", "search.notes"
        params = {"query": query, "limit": settings.xhs_max_posts}

    try:
        req = TaskRunRequest(site=site, task=task, params=params)
    except Exception as e:
        await send_progress("error", {"message": f"参数错误: {e}"})
        await send_progress("done", {"ok": False})
        return

    timeout_ms = req.options.timeout_ms or settings.default_timeout_ms
    timeout_s = min(900.0, max(5.0, timeout_ms / 1000.0 + 15.0))

    async with sem:
        try:
            resp = await asyncio.wait_for(
                run_task(req, bm, default_timeout_ms=settings.default_timeout_ms, on_progress=send_progress),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            await send_progress("error", {"message": "任务执行超时"})
            await send_progress("done", {"ok": False})
            return

    if resp.ok:
        if isinstance(resp.data, dict) and "cards" in resp.data:
            await send_progress(
                "result",
                {"platform": resp.data.get("platform", site), "cards": resp.data["cards"]},
            )
        await send_progress("done", {"ok": True})
    else:
        err_msg = resp.error.message if resp.error else "未知错误"
        await send_progress("error", {"message": err_msg})
        await send_progress("done", {"ok": False})


async def run_bridge(nezu_url: str, agent_id: str = "mac-01") -> None:
    """Connect to Nezu server and process tasks in a loop with auto-reconnect."""
    settings = get_settings()
    settings.cover_cache_dir.mkdir(parents=True, exist_ok=True)
    bm = BrowserManager(settings)
    sem = asyncio.Semaphore(max(1, settings.max_concurrent_tasks))

    api_key = settings.api_key or ""
    retry_delay = 1.0

    try:
        while True:
            try:
                log.info("正在连接 Nezu 服务器: %s", nezu_url)
                async with connect(nezu_url, ping_interval=25, ping_timeout=10) as ws:
                    # Register
                    register_msg = {
                        "type": "register",
                        "agent_id": agent_id,
                        "api_key": api_key,
                        "capabilities": ["xhs", "x"],
                    }
                    await ws.send(json.dumps(register_msg))
                    ack = json.loads(await ws.recv())
                    if ack.get("type") == "error":
                        log.error("注册失败: %s", ack.get("message"))
                        await asyncio.sleep(10)
                        continue

                    log.info("已注册到 Nezu 服务器 (agent_id=%s)", ack.get("agent_id", agent_id))
                    retry_delay = 1.0

                    # Task loop
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        if msg.get("type") == "search":
                            asyncio.create_task(
                                _handle_search(ws, msg, settings, bm, sem)
                            )
                        else:
                            log.debug("忽略未知消息类型: %s", msg.get("type"))

            except (
                websockets.exceptions.ConnectionClosed,
                ConnectionRefusedError,
                OSError,
            ) as e:
                log.warning("连接断开: %s — %s 秒后重连", e, retry_delay)
            except Exception as e:
                log.exception("意外错误: %s — %s 秒后重连", e, retry_delay)

            await asyncio.sleep(retry_delay)
            retry_delay = min(30.0, retry_delay * 2)
    finally:
        await bm.shutdown()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    settings = get_settings()
    nezu_url = getattr(settings, "nezu_url", None) or (
        sys.argv[1] if len(sys.argv) > 1 else None
    )
    if not nezu_url:
        print("用法: python -m crawler_agent.reverse_ws <nezu_ws_url>")
        print("例如: python -m crawler_agent.reverse_ws ws://10.34.255.185:5153/crawler/register")
        print("或设置环境变量: CRAWLER_NEZU_URL=ws://...")
        sys.exit(1)

    agent_id = sys.argv[2] if len(sys.argv) > 2 else "mac-01"

    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, loop.stop)

    try:
        loop.run_until_complete(run_bridge(nezu_url, agent_id))
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        loop.close()
        log.info("已退出")


if __name__ == "__main__":
    main()
