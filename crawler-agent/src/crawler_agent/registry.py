"""Task registry and dispatch."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from crawler_agent.browser_manager import BrowserManager
from crawler_agent.config import Settings, get_settings
from crawler_agent.models import (
    DoubanResolveByTitleParams,
    TaskCatalogResponse,
    TaskDescriptor,
    TaskError,
    TaskMeta,
    TaskRunRequest,
    TaskRunResponse,
    XiaohongshuSearchParams,
    XSearchParams,
)
from crawler_agent.progress import SendMessage


def build_catalog() -> TaskCatalogResponse:
    return TaskCatalogResponse(
        tasks=[
            TaskDescriptor(
                site="douban",
                task="subject.resolve_by_title",
                summary="按影视名在豆瓣搜索并解析最匹配条目的详情（剧集多按季拆条，默认以第一季为代表）",
                params_schema_ref="#/components/schemas/DoubanResolveByTitleParams",
            ),
            TaskDescriptor(
                site="xiaohongshu",
                task="search.notes",
                summary="按关键词搜索笔记并返回前 N 条列表信息（Gemini 排序 + 可选视觉判断）",
                params_schema_ref="#/components/schemas/XiaohongshuSearchParams",
            ),
            TaskDescriptor(
                site="x",
                task="search.posts",
                summary="通过 xmcp 搜索 X 推文，可选 Gemini 排序筛选（无需浏览器）",
                params_schema_ref="#/components/schemas/XSearchParams",
            ),
        ]
    )


_RETRYABLE_CODES = frozenset(
    {"SESSION_TIMEOUT", "CAPTCHA", "TIMEOUT", "NEED_LOGIN", "NEED_DISPLAY"}
)


async def run_task(
    req: TaskRunRequest,
    bm: BrowserManager,
    *,
    default_timeout_ms: int,
    on_progress: SendMessage | None = None,
) -> TaskRunResponse:
    started = datetime.now(timezone.utc).isoformat()
    timeout_ms = req.options.timeout_ms or default_timeout_ms
    force_headed = req.options.force_headed
    settings = get_settings()

    key = (req.site, req.task)
    try:
        if key == ("douban", "subject.resolve_by_title"):
            from crawler_agent.graphs.douban_subject import run_douban_resolve_by_title

            p = DoubanResolveByTitleParams.model_validate(req.params)
            data, urls, err = await run_douban_resolve_by_title(
                bm,
                title=p.title,
                kind_hint=p.kind_hint,
                force_headed=force_headed,
                timeout_ms=timeout_ms,
                cover_cache_dir=settings.cover_cache_dir,
                public_base_url=settings.public_base_url,
            )

        elif key == ("xiaohongshu", "search.notes"):
            from crawler_agent.graphs.xhs_search import run_xhs_search_notes

            p = XiaohongshuSearchParams.model_validate(req.params)
            data, urls, err = await run_xhs_search_notes(
                bm,
                settings=settings,
                query=p.query,
                limit=p.limit,
                force_headed=force_headed,
                timeout_ms=timeout_ms,
                on_progress=on_progress,
            )

        elif key == ("x", "search.posts"):
            from crawler_agent.graphs.x_search import run_x_search_posts

            p = XSearchParams.model_validate(req.params)
            data, urls, err = await run_x_search_posts(
                settings,
                query=p.query,
                max_results=p.max_results,
                on_progress=on_progress,
            )

        else:
            return TaskRunResponse(
                ok=False,
                site=req.site,
                task=req.task,
                data=None,
                meta=TaskMeta(
                    client_request_id=req.client_request_id,
                    started_at=started,
                    finished_at=datetime.now(timezone.utc).isoformat(),
                ),
                error=TaskError(
                    code="UNKNOWN_TASK",
                    message=f"未注册任务: {req.site}/{req.task}",
                    retryable=False,
                ),
            )

    except asyncio.TimeoutError:
        return TaskRunResponse(
            ok=False,
            site=req.site,
            task=req.task,
            meta=TaskMeta(
                client_request_id=req.client_request_id,
                started_at=started,
                finished_at=datetime.now(timezone.utc).isoformat(),
            ),
            error=TaskError(code="TIMEOUT", message="任务执行超时", retryable=True),
        )
    except Exception as e:
        return TaskRunResponse(
            ok=False,
            site=req.site,
            task=req.task,
            meta=TaskMeta(
                client_request_id=req.client_request_id,
                started_at=started,
                finished_at=datetime.now(timezone.utc).isoformat(),
            ),
            error=TaskError(code="INTERNAL", message=str(e)[:500], retryable=False),
        )

    finished = datetime.now(timezone.utc).isoformat()
    meta = TaskMeta(
        client_request_id=req.client_request_id,
        started_at=started,
        finished_at=finished,
        source_urls=urls,
    )
    if err:
        retryable = err["code"] in _RETRYABLE_CODES
        return TaskRunResponse(
            ok=False,
            site=req.site,
            task=req.task,
            data=None,
            meta=meta,
            error=TaskError(
                code=err["code"], message=err.get("message", ""), retryable=retryable
            ),
        )
    return TaskRunResponse(
        ok=True, site=req.site, task=req.task, data=data, meta=meta, error=None
    )
