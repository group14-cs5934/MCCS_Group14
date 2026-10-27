"""A burst of requests doesn't stall waiting for database connections (needs TEST_DATABASE_URL).

Found by the T096 search load test: each request takes its pooled connection in a worker thread,
and routes run on the same threads. When more requests were waiting for a connection than there
are threads, the requests holding a connection couldn't get a thread to finish and give it back,
so everything stalled until the waiters failed with PoolTimeout. app/core/database.py now lets
at most POOL_MAX_SIZE requests at a time take a connection; the rest wait without a thread.

Shrunk here so it's quick and certain: 2 connections, 4 worker threads, 8 requests at once, each
holding its connection for 0.2 s. Without the limit, this stalls until the 1 s pool timeout.
"""

import asyncio

import anyio.to_thread
import httpx
import pytest

from app.core import database
from app.core.config import load_settings
from app.core.database import DbConnection
from app.main import create_app

CONNECTIONS = 2
THREADS = 4
REQUESTS = 8


async def burst(app) -> list[int]:
    """Sends REQUESTS requests to /slow at once, with only THREADS worker threads."""
    anyio.to_thread.current_default_thread_limiter().total_tokens = THREADS
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            responses = await asyncio.gather(*(client.get("/slow") for _ in range(REQUESTS)))
    return [response.status_code for response in responses]


@pytest.fixture
def app(db_url: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(database, "POOL_MAX_SIZE", CONNECTIONS)
    monkeypatch.setattr(database, "POOL_TIMEOUT_SECONDS", 1.0)
    app = create_app(
        load_settings(
            _env_file=None, database_url=db_url, supabase_url="https://example.supabase.co"
        )
    )

    @app.get("/slow")
    def slow(db: DbConnection) -> dict[str, bool]:
        db.execute("SELECT pg_sleep(0.2)")
        return {"ok": True}

    return app


def test_more_requests_than_threads_all_get_a_connection(app) -> None:
    statuses = asyncio.run(burst(app))

    assert statuses == [200] * REQUESTS
