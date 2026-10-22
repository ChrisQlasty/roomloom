"""Application settings read from the repo-root `.env` file."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime configuration. Every key is optional so the app starts without secrets."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    gemini_api_key: str = ""
    gemini_image_model: str = "gemini-2.5-flash-image"
    miro_token: str = ""
    elevenlabs_api_key: str = ""
    monthly_budget_usd: float = 30.0
    projects_dir: Path = REPO_ROOT / "projects"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings instance."""
    return Settings()
