"""PostgreSQL connection pool and the per-request connection dependency.

The app opens one connection pool when it starts (see the lifespan in app/main.py). Each request
that needs the database borrows its own connection from the pool through DbConnection, so
requests running at the same time never share a connection. A request's queries run in one
transaction: committed when the route returns, rolled back if it raises. At most POOL_MAX_SIZE
requests use the database at once; the rest wait their turn without tying up a worker thread.
"""

from collections.abc import AsyncIterator, Iterator
from typing import Annotated

import anyio
import psycopg
from fastapi import Depends, Request
from psycopg_pool import ConnectionPool

from app.core.config import Settings, get_settings

# Connections kept open while idle, and the most the app opens at once.
POOL_MIN_SIZE = 1
POOL_MAX_SIZE = 10
# How long a request waits for a free connection before failing. Shorter than the mobile
# client's 10 s timeout so the app gets an error response instead of timing out itself.
POOL_TIMEOUT_SECONDS = 5.0


def create_pool(settings: Settings) -> ConnectionPool:
    """Create the app's connection pool. Nothing connects until pool.open() is called."""
    return ConnectionPool(
        str(settings.database_url),
        min_size=POOL_MIN_SIZE,
        max_size=POOL_MAX_SIZE,
        timeout=POOL_TIMEOUT_SECONDS,
        # Supabase's pooler (port 6543) runs in transaction mode, which doesn't support prepared
        # statements, so stop psycopg from preparing frequently repeated queries.
        kwargs={"prepare_threshold": None},
        open=False,
        name="mccs-db",
    )


async def _connection_slot(request: Request) -> AsyncIterator[None]:
    """FastAPI dependency: waits until fewer than POOL_MAX_SIZE requests are using a connection.

    Waiting here doesn't use a worker thread. Without it, a burst of requests (T096: 50 searches at
    once) filled every worker thread with requests blocked in pool.connection(), so the requests
    that already had a connection couldn't get a thread to finish and give it back; everything
    stalled until the waiters timed out after POOL_TIMEOUT_SECONDS. Now only requests sure to get
    a connection take a thread.
    """
    slots: anyio.Semaphore | None = getattr(request.app.state, "db_slots", None)
    if slots is None:  # the app's lifespan didn't run (some unit tests)
        yield
        return
    async with slots:
        yield


def create_connection_slots() -> anyio.Semaphore:
    """One slot per pooled connection. Create it inside the running app (its lifespan)."""
    return anyio.Semaphore(POOL_MAX_SIZE)


def get_connection(
    request: Request, _slot: Annotated[None, Depends(_connection_slot, scope="function")]
) -> Iterator[psycopg.Connection]:
    """FastAPI dependency: this request's own pooled connection, inside one transaction. The
    connection goes back to the pool before its slot is freed."""
    pool: ConnectionPool | None = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise RuntimeError("The database pool isn't open; it opens when the app starts.")
    with pool.connection() as connection:
        yield connection


# Use as a route parameter: def get_thing(db: DbConnection) -> ...
# scope="function" commits before the response is sent, so a failed commit returns an error
# instead of reporting success for changes that were never saved.
DbConnection = Annotated[psycopg.Connection, Depends(get_connection, scope="function")]


def check_database_connection() -> bool:
    """Connect to PostgreSQL and run a simple test query."""
    settings = get_settings()

    with psycopg.connect(str(settings.database_url)) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()

    return result == (1,)
