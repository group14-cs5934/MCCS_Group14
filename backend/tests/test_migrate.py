"""The migration runner, scripts/migrate.py (database tests skip without TEST_DATABASE_URL).

Each database test gets its own empty schema, so the runner starts from nothing (or, for the
"applied by hand" case, from the schema the db_url fixture already migrated).
"""

import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from scripts import migrate
from scripts.migrate import MIGRATIONS_DIR, MigrationError, apply_pending, connect

ALL_MIGRATIONS = [path.name for path in migrate.migration_files()]


@pytest.fixture
def empty_db_url() -> Iterator[str]:
    """URL of an empty throwaway schema (no migrations applied), dropped afterwards."""
    base_url = os.environ.get("TEST_DATABASE_URL")
    if not base_url:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL isn't set, so CI would silently skip database tests")
        pytest.skip("set TEST_DATABASE_URL to run database tests")
    schema_name = f"test_{uuid4().hex[:12]}"
    schema = sql.Identifier(schema_name)
    with psycopg.connect(base_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
    separator = "&" if "?" in base_url else "?"
    search_path = f"{schema_name},public,extensions"
    yield f"{base_url}{separator}options={quote(f'-c search_path={search_path}')}"
    with psycopg.connect(base_url, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))


def recorded(connection: psycopg.Connection) -> list[str]:
    return [name for (name,) in connection.execute("SELECT filename FROM schema_migrations")]


def table_exists(connection: psycopg.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = %s",
        (table,),
    ).fetchone()
    return row is not None


def copy_migrations(tmp_path: Path, extra: dict[str, str]) -> Path:
    """The real migrations plus `extra` ({filename: sql}), in a folder of their own."""
    folder = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS_DIR, folder)
    for name, text in extra.items():
        (folder / name).write_text(text, encoding="utf-8")
    return folder


def test_applies_every_migration_to_an_empty_database_in_order(empty_db_url) -> None:
    with connect(empty_db_url) as connection:
        applied = apply_pending(connection, report=lambda _line: None)

        assert applied == ALL_MIGRATIONS
        assert sorted(recorded(connection)) == ALL_MIGRATIONS
        for table in ("products", "reviews", "admin_audit_log", "schema_migrations"):
            assert table_exists(connection, table), table


def test_running_again_applies_nothing(empty_db_url) -> None:
    with connect(empty_db_url) as connection:
        apply_pending(connection, report=lambda _line: None)

        assert apply_pending(connection, report=lambda _line: None) == []
        assert migrate.pending_migrations(connection) == []


def test_first_run_on_a_database_migrated_by_hand_records_everything(db_url) -> None:
    # The db_url fixture applied every migration directly, like applying them by hand did.
    with connect(db_url) as connection:
        assert migrate.applied_migrations(connection) == set()

        applied = apply_pending(connection, report=lambda _line: None)

        assert applied == ALL_MIGRATIONS  # all ran again without error
        assert apply_pending(connection, report=lambda _line: None) == []


def test_only_a_new_migration_is_applied_later(empty_db_url, tmp_path) -> None:
    folder = copy_migrations(
        tmp_path, {"999_add_test_table.sql": "CREATE TABLE added_later (id INTEGER);"}
    )
    with connect(empty_db_url) as connection:
        apply_pending(connection, report=lambda _line: None)  # the real ones

        applied = apply_pending(connection, folder, report=lambda _line: None)

        assert applied == ["999_add_test_table.sql"]
        assert table_exists(connection, "added_later")


def test_a_failing_migration_is_undone_and_stops_the_run(empty_db_url, tmp_path) -> None:
    folder = copy_migrations(
        tmp_path,
        {
            # The first statement works, the second fails: the whole file must be undone.
            "998_broken.sql": "CREATE TABLE half_done (id INTEGER);\nSELECT * FROM no_such_table;",
            "999_after.sql": "CREATE TABLE after_broken (id INTEGER);",
        },
    )
    with connect(empty_db_url) as connection:
        with pytest.raises(MigrationError) as failure:
            apply_pending(connection, folder, report=lambda _line: None)

        assert failure.value.filename == "998_broken.sql"
        assert sorted(recorded(connection)) == ALL_MIGRATIONS  # the ones before it stayed
        assert not table_exists(connection, "half_done")
        assert not table_exists(connection, "after_broken")


def test_status_lists_pending_migrations_and_changes_nothing(empty_db_url, capsys) -> None:
    assert migrate.main(["--database-url", empty_db_url, "--status"]) == 0

    out = capsys.readouterr().out
    assert f"PENDING  {ALL_MIGRATIONS[0]}" in out
    assert f"{len(ALL_MIGRATIONS)} pending" in out
    with connect(empty_db_url) as connection:
        assert not table_exists(connection, "schema_migrations")


def test_command_applies_and_then_reports_nothing_to_do(empty_db_url, capsys) -> None:
    assert migrate.main(["--database-url", empty_db_url]) == 0
    assert migrate.main(["--database-url", empty_db_url]) == 0

    out = capsys.readouterr().out
    assert f"Done: applied {len(ALL_MIGRATIONS)} migration(s)." in out
    assert "Nothing to do" in out


# --- Without a database ---


def test_remote_databases_are_described_without_their_password() -> None:
    url = "postgresql://postgres.abc:s3cret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

    assert migrate.describe(url) == "aws-0-us-east-1.pooler.supabase.com:6543/postgres"
    assert not migrate.is_local(url)
    assert migrate.is_local("postgresql://postgres:postgres@localhost:5433/mccs")


def test_migrations_run_in_filename_order() -> None:
    names = [path.name for path in migrate.migration_files()]

    assert names == sorted(names)
    assert names[0].startswith("001_")


class FakeConnection:
    """Enough of a connection for main() to decide what to do, with migrations pending."""

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass


def test_remote_database_asks_first_and_no_changes_nothing(monkeypatch, capsys) -> None:
    monkeypatch.setattr(migrate, "connect", lambda _url: FakeConnection())
    monkeypatch.setattr(migrate, "applied_migrations", lambda _connection: set())
    monkeypatch.setattr(
        migrate, "pending_migrations", lambda _connection: migrate.migration_files()
    )
    monkeypatch.setattr(
        migrate, "apply_pending", lambda *_args, **_kw: pytest.fail("applied without asking")
    )
    questions = []

    code = migrate.main(
        ["--database-url", "postgresql://u:p@db.example.supabase.co:5432/postgres"],
        ask=lambda question: questions.append(question) or "n",
    )

    assert code == 1
    assert questions == [
        f"Apply {len(ALL_MIGRATIONS)} migration(s) to db.example.supabase.co:5432/postgres? [y/N] "
    ]
    assert "nothing was changed" in capsys.readouterr().out
