"""Application settings, loaded from environment variables and backend/.env.

Real environment variables take precedence over values in .env. See .env.example for the
full list of variables.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import PostgresDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, found the same way no matter which directory the server is started from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Required: no default, so startup fails if it's not set.
    database_url: PostgresDsn

    # Optional
    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


class ConfigError(RuntimeError):
    """Raised when settings are missing or invalid. The message is meant for humans."""


def _describe(error: dict[str, Any]) -> str:
    name = str(error["loc"][0]).upper()
    if error["type"] == "missing":
        return f"  - {name} is required but not set"
    # Never echo the value back: it may be a secret (e.g. a password inside DATABASE_URL).
    return f"  - {name} is invalid: {error['msg']}"


def load_settings(**overrides: Any) -> Settings:
    """Build Settings, turning pydantic's validation errors into one readable message."""
    try:
        return Settings(**overrides)
    except ValidationError as exc:
        problems = "\n".join(_describe(e) for e in exc.errors())
        raise ConfigError(
            "Backend configuration error:\n"
            f"{problems}\n"
            f"Set these in {ENV_FILE} (copy backend/.env.example to get started) "
            "or as environment variables."
        ) from None


@lru_cache
def get_settings() -> Settings:
    """Settings for the running app, loaded once. Use as a FastAPI dependency."""
    return load_settings()
