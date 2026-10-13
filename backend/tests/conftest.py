import os
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql

CONFIG_VARS = ("DATABASE_URL", "APP_ENV", "LOG_LEVEL", "CORS_ORIGINS")
VALID_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/mccs"
MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"

# Test-suite config, set before any test imports app.main (which loads settings on import).
# Real environment variables win over backend/.env, so tests never depend on a developer's .env.
os.environ["DATABASE_URL"] = VALID_DATABASE_URL
os.environ["APP_ENV"] = "test"


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove all config variables so a test controls config only through its own .env file."""
    for name in CONFIG_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def make_client() -> Callable[..., TestClient]:
    """TestClient for an app with the given settings, e.g. make_client(cors_origins=[...])."""
    from app.core.config import load_settings
    from app.main import create_app

    def make(**overrides: Any) -> TestClient:
        overrides.setdefault("database_url", VALID_DATABASE_URL)
        return TestClient(create_app(load_settings(_env_file=None, **overrides)))

    return make


@pytest.fixture
def db_url() -> Iterator[str]:
    """URL of a fresh database with every migration applied, for tests that need Postgres.

    Needs TEST_DATABASE_URL (CI sets it); the test is skipped otherwise. Each test gets its own
    throwaway Postgres schema, dropped afterwards, so tests never see each other's rows or any
    real data, even if TEST_DATABASE_URL points at a development database.

    public and extensions (Supabase's extension schema) come after it on the search path, only so
    extension functions like pg_trgm's resolve wherever the extension is installed. Every table
    is created in the test schema, which is searched first.
    """
    base_url = os.environ.get("TEST_DATABASE_URL")
    if not base_url:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL isn't set, so CI would silently skip database tests")
        pytest.skip("set TEST_DATABASE_URL to run database tests")

    schema_name = f"test_{uuid4().hex[:12]}"
    schema = sql.Identifier(schema_name)
    with psycopg.connect(base_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        connection.execute(sql.SQL("SET search_path TO {}, public, extensions").format(schema))
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            connection.execute(migration.read_text(encoding="utf-8"))

    # libpq's "options" parameter makes every connection from this URL use the test schema.
    separator = "&" if "?" in base_url else "?"
    search_path = f"{schema_name},public,extensions"
    yield f"{base_url}{separator}options={quote(f'-c search_path={search_path}')}"

    with psycopg.connect(base_url, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))


@pytest.fixture
def connection(db_url: str) -> Iterator[psycopg.Connection]:
    """A connection to the db_url test database, for adding rows or checking results."""
    with psycopg.connect(db_url) as connection:
        yield connection


@pytest.fixture
def env_file(tmp_path: Path) -> Callable[[str], Path]:
    """Write a temporary .env file and return its path."""

    def write(contents: str) -> Path:
        path = tmp_path / ".env"
        path.write_text(contents, encoding="utf-8")
        return path

    return write
