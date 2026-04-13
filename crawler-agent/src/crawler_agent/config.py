from __future__ import annotations

import platform
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .../crawler-agent/（含 src 的安装布局，避免从其它 cwd 启动 uvicorn 时写到错误目录）
_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CRAWLER_", extra="ignore")

    # ---- server ----
    host: str = "0.0.0.0"
    port: int = 5533
    api_key: str | None = None

    # ---- browser / data dirs ----
    profile_dir: Path = Field(default=_ROOT / "data" / "browser-profiles")
    cover_cache_dir: Path = Field(default=_ROOT / "data" / "covers")
    public_base_url: str | None = None

    # ---- concurrency ----
    default_timeout_ms: int = 120_000
    max_concurrent_tasks: int = 5
    max_concurrent_per_site: int = 3

    # ---- X (Twitter) via xmcp ----
    xmcp_url: str = "http://127.0.0.1:8000/mcp"
    x_search_max_results: int = 50
    x_max_posts: int = 12

    # ---- Gemini (shared by X + XHS) ----
    google_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_request_timeout_s: float = 120.0
    gemini_progress_interval_s: float = 4.0

    # ---- XHS enhanced ----
    xhs_cookie_path: Path | None = None
    xhs_headless: bool | None = None
    xhs_search_scroll_rounds: int = 9
    xhs_max_dom_candidates: int = 52
    xhs_max_posts: int = 12
    xhs_gemini_use_vision: bool = True
    xhs_gemini_vision_max_covers: int = 52
    xhs_gemini_cover_fetch_timeout_ms: int = 15_000
    xhs_gemini_cover_fetch_concurrency: int = 6
    xhs_gemini_cover_max_bytes: int = 2 * 1024 * 1024
    xhs_login_timeout_s: int = 120

    @property
    def xhs_headless_effective(self) -> bool:
        if self.xhs_headless is not None:
            return self.xhs_headless
        return platform.system() != "Darwin"

    @model_validator(mode="after")
    def _resolve_relative_data_dirs(self) -> Settings:
        pd, cd = self.profile_dir, self.cover_cache_dir
        if not pd.is_absolute():
            pd = (_ROOT / pd).resolve()
        if not cd.is_absolute():
            cd = (_ROOT / cd).resolve()
        updates: dict = {}
        if pd != self.profile_dir:
            updates["profile_dir"] = pd
        if cd != self.cover_cache_dir:
            updates["cover_cache_dir"] = cd
        if self.xhs_cookie_path is None:
            updates["xhs_cookie_path"] = pd / "xhs_cookies.json"
        if updates:
            return self.model_copy(update=updates)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
