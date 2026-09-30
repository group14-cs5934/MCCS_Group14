"""FastAPI entry point. Run with: uv run fastapi dev app/main.py"""

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, products
from app.core.config import ConfigError, Settings, get_settings
from app.core.request_logging import REQUEST_ID_HEADER, add_request_logging

logger = logging.getLogger("app")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logging.getLogger("app").setLevel(settings.log_level)
    # Our request log replaces uvicorn's access log (it adds duration and request ID).
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    app = FastAPI(title="MCCS Product API", version="0.1.0")

    # Middleware added later wraps earlier ones, so request logging (added last) sees every
    # request, including the ones CORS rejects.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
    )
    add_request_logging(app)

    app.include_router(health.router)
    app.include_router(products.router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"service": "mccs-backend", "environment": settings.app_env}

    logger.info(
        "Started in %s mode; CORS allows %s",
        settings.app_env,
        ", ".join(settings.cors_origins) or "no browser origins",
    )
    return app


def _create_app_or_exit() -> FastAPI:
    try:
        return create_app()
    except ConfigError as exc:
        # Print the readable message and stop, instead of a long pydantic traceback.
        print(f"\n{exc}\n", file=sys.stderr)
        raise SystemExit(1) from None


app = _create_app_or_exit()
