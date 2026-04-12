from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .../crawler-agent/（含 src 的安装布局，避免从其它 cwd 启动 uvicorn 时写到错误目录）
_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CRAWLER_", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 5533
    api_key: str | None = None
    profile_dir: Path = Field(default=_ROOT / "data" / "browser-profiles")
    cover_cache_dir: Path = Field(default=_ROOT / "data" / "covers")
    public_base_url: str | None = None
    default_timeout_ms: int = 120_000
    max_concurrent_tasks: int = 1

    @model_validator(mode="after")
    def _resolve_relative_data_dirs(self) -> Settings:
        pd, cd = self.profile_dir, self.cover_cache_dir
        if not pd.is_absolute():
            pd = (_ROOT / pd).resolve()
        if not cd.is_absolute():
            cd = (_ROOT / cd).resolve()
        if pd == self.profile_dir and cd == self.cover_cache_dir:
            return self
        return self.model_copy(update={"profile_dir": pd, "cover_cache_dir": cd})


@lru_cache
def get_settings() -> Settings:
    return Settings()
