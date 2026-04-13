"""FastAPI entry: CrawlerAgent on port 5533 by default.

Provides:
- REST:  POST /v1/tasks/run  (synchronous response)
- WS:   /v1/ws              (real-time progress + results)
- GET:   /v1/tasks           (task catalog)
- GET:   /health
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import Settings, get_settings
from crawler_agent.models import (
    TaskCatalogResponse,
    TaskError,
    TaskMeta,
    TaskRunRequest,
    TaskRunResponse,
)
from crawler_agent.registry import build_catalog, run_task

log = logging.getLogger("crawler-agent.main")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _with_cover_url_cached(request: Request, resp: TaskRunResponse) -> TaskRunResponse:
    if not resp.ok or not isinstance(resp.data, dict):
        return resp
    data = dict(resp.data)
    hp = data.get("coverHttpPath")
    if isinstance(hp, str) and hp.startswith("/") and not data.get("coverUrlCached"):
        base = str(request.base_url).rstrip("/")
        data["coverUrlCached"] = base + hp
    return resp.model_copy(update={"data": data})


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.cover_cache_dir.mkdir(parents=True, exist_ok=True)
    app.state.settings = settings
    app.state.bm = BrowserManager(settings)
    app.state.sem = asyncio.Semaphore(max(1, settings.max_concurrent_tasks))
    yield
    await app.state.bm.shutdown()


app = FastAPI(title="CrawlerAgent", version="0.2.0", lifespan=lifespan)

_boot = get_settings()
_boot.cover_cache_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/static/covers",
    StaticFiles(directory=str(_boot.cover_cache_dir.resolve())),
    name="covers",
)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------


def _require_api_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
) -> None:
    if settings.api_key and (not x_api_key or x_api_key != settings.api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Api-Key")


def _check_api_key_raw(key: str | None, settings: Settings) -> bool:
    if not settings.api_key:
        return True
    return key == settings.api_key


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/tasks", response_model=TaskCatalogResponse)
async def list_tasks(_: Annotated[None, Depends(_require_api_key)]) -> TaskCatalogResponse:
    return build_catalog()


@app.post("/v1/tasks/run", response_model=TaskRunResponse)
async def tasks_run(
    request: Request,
    body: TaskRunRequest,
    _: Annotated[None, Depends(_require_api_key)],
) -> TaskRunResponse:
    settings: Settings = request.app.state.settings
    bm: BrowserManager = request.app.state.bm
    sem: asyncio.Semaphore = request.app.state.sem
    timeout_ms = body.options.timeout_ms or settings.default_timeout_ms
    timeout_s = min(900.0, max(5.0, timeout_ms / 1000.0 + 15.0))

    async with sem:
        try:
            out = await asyncio.wait_for(
                run_task(body, bm, default_timeout_ms=settings.default_timeout_ms),
                timeout=timeout_s,
            )
            return _with_cover_url_cached(request, out)
        except asyncio.TimeoutError:
            now = datetime.now(timezone.utc).isoformat()
            return TaskRunResponse(
                ok=False,
                site=body.site,
                task=body.task,
                data=None,
                meta=TaskMeta(
                    client_request_id=body.client_request_id,
                    started_at=now,
                    finished_at=now,
                ),
                error=TaskError(code="TIMEOUT", message="HTTP 层等待超时", retryable=True),
            )


# ---------------------------------------------------------------------------
# WebSocket endpoint — real-time progress + results
#
# Client sends:
#   { "type": "run", "site": "x", "task": "search.posts",
#     "params": { "query": "..." }, "options": {...}, "api_key": "..." }
#
# Server pushes (any number of):
#   { "type": "status",  "message": "..." }
#   { "type": "qr_code", "image": "data:image/png;base64,..." }
#   { "type": "result",  "platform": "x", "cards": [...] }
#   { "type": "error",   "message": "..." }
#   { "type": "done",    "ok": true, "data": {...}, "meta": {...} }
# ---------------------------------------------------------------------------


@app.websocket("/v1/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    settings: Settings = app.state.settings
    bm: BrowserManager = app.state.bm
    sem: asyncio.Semaphore = app.state.sem

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "无效 JSON"})
                continue

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})
                continue

            if msg_type != "run":
                await ws.send_json({"type": "error", "message": f"未知消息类型: {msg_type}"})
                continue

            if not _check_api_key_raw(msg.get("api_key"), settings):
                await ws.send_json({"type": "error", "message": "Invalid or missing api_key"})
                continue

            await _handle_ws_run(ws, msg, settings, bm, sem)

    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("WebSocket connection error", exc_info=True)


async def _handle_ws_run(
    ws: WebSocket,
    msg: dict[str, Any],
    settings: Settings,
    bm: BrowserManager,
    sem: asyncio.Semaphore,
) -> None:
    """Process a single ``run`` message over WebSocket."""

    async def send_progress(msg_type: str, payload: dict[str, Any]) -> None:
        try:
            await ws.send_json({"type": msg_type, **payload})
        except Exception:
            pass

    try:
        req = TaskRunRequest(
            site=msg.get("site", ""),
            task=msg.get("task", ""),
            params=msg.get("params", {}),
            client_request_id=msg.get("client_request_id"),
            options=msg.get("options", {}),
        )
    except Exception as e:
        await send_progress("error", {"message": f"请求参数错误: {e}"})
        await send_progress("done", {"ok": False})
        return

    timeout_ms = req.options.timeout_ms or settings.default_timeout_ms
    timeout_s = min(900.0, max(5.0, timeout_ms / 1000.0 + 15.0))

    async with sem:
        try:
            resp = await asyncio.wait_for(
                run_task(
                    req,
                    bm,
                    default_timeout_ms=settings.default_timeout_ms,
                    on_progress=send_progress,
                ),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            await send_progress("error", {"message": "任务执行超时"})
            await send_progress("done", {"ok": False})
            return

    # Push final result + done
    if resp.ok:
        if isinstance(resp.data, dict) and "cards" in resp.data:
            await send_progress(
                "result",
                {"platform": resp.data.get("platform", resp.site), "cards": resp.data["cards"]},
            )
        await send_progress(
            "done",
            {
                "ok": True,
                "data": resp.data,
                "meta": resp.meta.model_dump() if resp.meta else {},
            },
        )
    else:
        err_msg = resp.error.message if resp.error else "未知错误"
        await send_progress("error", {"message": err_msg})
        await send_progress(
            "done",
            {
                "ok": False,
                "error": resp.error.model_dump() if resp.error else None,
                "meta": resp.meta.model_dump() if resp.meta else {},
            },
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def run_cli() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "crawler_agent.main:app",
        host=s.host,
        port=s.port,
        factory=False,
        log_level="info",
    )
