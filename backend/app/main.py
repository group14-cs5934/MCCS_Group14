"""FastAPI entry point. Run with: uv run fastapi dev app/main.py"""

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin,
    admin_audit,
    admin_products,
    admin_reviews,
    admin_stores,
    health,
    me,
    products,
    ratings,
    reviews,
    stores,
)
from app.core.auth import TokenVerifier
from app.core.config import ConfigError, Settings, get_settings
from app.core.database import create_pool
from app.core.errors import add_error_handlers
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

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Connect in the background so the API (and /health) starts even when the database is
        # down; requests that need the database fail until it's reachable.
        pool = create_pool(settings)
        pool.open(wait=False)
        app.state.db_pool = pool
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(title="MCCS Product API", version="0.1.0", lifespan=lifespan)

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
    add_error_handlers(app)

    app.state.token_verifier = TokenVerifier.from_settings(settings)

    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(products.router)
    app.include_router(ratings.router)
    app.include_router(reviews.router)
    app.include_router(stores.router)
    app.include_router(admin.router)
    app.include_router(admin_products.router)
    app.include_router(admin_reviews.router)
    app.include_router(admin_audit.router)
    app.include_router(admin_stores.stores_router)
    app.include_router(admin_stores.stock_router)

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
