"""FastAPI entry point. Run with: uv run fastapi dev"""

import logging
import sys

from fastapi import FastAPI

from app.core.config import ConfigError, Settings, get_settings

logger = logging.getLogger("app")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)

    app = FastAPI(title="MCCS Product API", version="0.1.0")

    @app.get("/")
    def root() -> dict[str, str]:
        return {"service": "mccs-backend", "environment": settings.app_env}

    logger.info("Started in %s mode", settings.app_env)
    return app


def _create_app_or_exit() -> FastAPI:
    try:
        return create_app()
    except ConfigError as exc:
        # Print the readable message and stop, instead of a long pydantic traceback.
        print(f"\n{exc}\n", file=sys.stderr)
        raise SystemExit(1) from None


app = _create_app_or_exit()
