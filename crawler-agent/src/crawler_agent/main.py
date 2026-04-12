"""FastAPI entry: CrawlerAgent on port 5533 by default."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.staticfiles import StaticFiles

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import Settings, get_settings
from crawler_agent.models import TaskCatalogResponse, TaskError, TaskMeta, TaskRunRequest, TaskRunResponse
from crawler_agent.registry import build_catalog, run_task


def _with_cover_url_cached(request: Request, resp: TaskRunResponse) -> TaskRunResponse:
    """用当前请求的 Host 拼出可直接打开的封面 URL（须服务已启动）。"""
    if not resp.ok or not isinstance(resp.data, dict):
        return resp
    data = dict(resp.data)
    hp = data.get("coverHttpPath")
    if isinstance(hp, str) and hp.startswith("/") and not data.get("coverUrlCached"):
        base = str(request.base_url).rstrip("/")
        data["coverUrlCached"] = base + hp
    return resp.model_copy(update={"data": data})


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.cover_cache_dir.mkdir(parents=True, exist_ok=True)
    app.state.settings = settings
    app.state.bm = BrowserManager(settings)
    app.state.sem = asyncio.Semaphore(max(1, settings.max_concurrent_tasks))
    yield
    await app.state.bm.shutdown()


app = FastAPI(title="CrawlerAgent", version="0.1.0", lifespan=lifespan)

_boot = get_settings()
_boot.cover_cache_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/static/covers",
    StaticFiles(directory=str(_boot.cover_cache_dir.resolve())),
    name="covers",
)


def _require_api_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
) -> None:
    if settings.api_key and (not x_api_key or x_api_key != settings.api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Api-Key")


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
                meta=TaskMeta(client_request_id=body.client_request_id, started_at=now, finished_at=now),
                error=TaskError(code="TIMEOUT", message="HTTP 层等待超时", retryable=True),
            )


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
