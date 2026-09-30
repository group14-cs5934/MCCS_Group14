"""Application settings, loaded from environment variables and backend/.env.

Real environment variables take precedence over values in .env. See .env.example for the
full list of variables.
"""

import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import PostgresDsn, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# backend/.env, found the same way no matter which directory the server is started from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# scheme://host[:port] with no path or trailing slash, e.g. http://localhost:8081
_ORIGIN_PATTERN = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Required: no default, so startup fails if it's not set.
    database_url: PostgresDsn

    # Optional
    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Browser origins allowed to call the API (comma-separated in .env). Empty = none allowed.
    # The native app doesn't need this; it's for Expo web and any future web dashboard.
    cors_origins: Annotated[list[str], NoDecode] = []

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _check_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            if not _ORIGIN_PATTERN.match(origin):
                # A trailing slash or path never matches a browser's Origin header, so CORS
                # would silently block everything. Fail loudly instead.
                raise ValueError(
                    f"'{origin}' is not a valid origin; use scheme://host[:port] with no "
                    "trailing slash, e.g. http://localhost:8081"
                )
        return origins


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
