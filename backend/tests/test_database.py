import threading
from concurrent.futures import ThreadPoolExecutor

import psycopg
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.core.database import DbConnection
from app.main import create_app

# T017 acceptance: when two requests run at the same time, each gets its own DB session and
# both succeed.


def make_app(database_url: str) -> FastAPI:
    return create_app(load_settings(_env_file=None, database_url=database_url))


def test_concurrent_requests_each_get_their_own_session(db_url: str) -> None:
    app = make_app(db_url)
    # Each request waits here while holding its connection, so this only passes if both
    # requests have a connection at the same time.
    both_connected = threading.Barrier(2, timeout=5)

    @app.get("/test/session")
    def session_id(db: DbConnection) -> dict[str, int]:
        (backend_pid,) = db.execute("SELECT pg_backend_pid()").fetchone()
        both_connected.wait()
        return {"backend_pid": backend_pid}

    with TestClient(app) as client, ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.get("/test/session"), range(2)))

    assert [response.status_code for response in responses] == [200, 200]
    backend_pids = {response.json()["backend_pid"] for response in responses}
    assert len(backend_pids) == 2, "both requests used the same database session"


def test_request_commits_on_success_and_rolls_back_on_error(db_url: str) -> None:
    app = make_app(db_url)

    @app.post("/test/categories/{slug}")
    def add_category(slug: str, db: DbConnection, fail: bool = False) -> dict[str, str]:
        db.execute("INSERT INTO categories (name, slug) VALUES (%s, %s)", (slug, slug))
        if fail:
            raise RuntimeError("route failed after writing")
        return {"slug": slug}

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/test/categories/kept").status_code == 200
        assert client.post("/test/categories/discarded?fail=true").status_code == 500

    with psycopg.connect(db_url) as connection:
        slugs = [slug for (slug,) in connection.execute("SELECT slug FROM categories")]
    assert slugs == ["kept"]


def test_app_starts_when_the_database_is_down() -> None:
    # Nothing listens on port 1. connect_timeout keeps the pool's background connection attempt
    # short (on Windows it can hang instead of being refused), so shutdown doesn't wait on it.
    app = make_app("postgresql://postgres:postgres@127.0.0.1:1/mccs?connect_timeout=1")

    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
