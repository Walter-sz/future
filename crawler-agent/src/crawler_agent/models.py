from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TaskOptions(BaseModel):
    timeout_ms: int | None = None
    force_headed: bool = False
    allow_partial: bool = False
    trace: bool = False


class TaskRunRequest(BaseModel):
    site: Literal["douban", "xiaohongshu"]
    task: str
    params: dict[str, Any] = Field(default_factory=dict)
    client_request_id: str | None = None
    options: TaskOptions = Field(default_factory=TaskOptions)


class TaskError(BaseModel):
    code: str
    message: str
    retryable: bool = False


class TaskMeta(BaseModel):
    client_request_id: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    source_urls: list[str] = Field(default_factory=list)


class TaskRunResponse(BaseModel):
    ok: bool
    site: str
    task: str
    data: Any = None
    meta: TaskMeta = Field(default_factory=TaskMeta)
    error: TaskError | None = None


class TaskDescriptor(BaseModel):
    site: str
    task: str
    summary: str
    params_schema_ref: str | None = None


class TaskCatalogResponse(BaseModel):
    tasks: list[TaskDescriptor]


# --- Per-task params ---


class DoubanResolveByTitleParams(BaseModel):
    """豆瓣按标题解析条目。电视剧在豆瓣多按季拆条，见 ``kind_hint`` 说明。"""

    title: str
    kind_hint: Literal["auto", "movie", "tv"] = Field(
        default="auto",
        description=(
            "搜索范围倾向：`movie` 仅电影，`tv` 仅电视（含剧集），`auto` 先电影后电视。"
            "剧集在豆瓣常为分季条目，默认会匹配到第一季等靠前结果，产品约定以此作为该剧代表信息。"
        ),
    )


class XiaohongshuSearchParams(BaseModel):
    query: str
    limit: int = Field(default=10, ge=1, le=30)
