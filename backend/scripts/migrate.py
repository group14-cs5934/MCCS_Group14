"""Apply the database migrations that haven't been applied yet.

    uv run python -m scripts.migrate           # the database in backend/.env (DATABASE_URL)
    uv run python -m scripts.migrate --status  # list applied and pending; change nothing
    uv run python -m scripts.migrate --database-url "postgresql://..."  # another, e.g. Supabase

Each file in backend/migrations/ is applied once, in filename order, and recorded in the
schema_migrations table, so later runs skip it. Each migration runs in its own transaction: if one
fails, it's undone and not recorded, the run stops there, and the ones before it stay applied.
Fix it and run again. A lock stops two runs at once from applying the same migration.

The first run on a database that already has some migrations (applied by hand, before this
script) runs every migration again once and records them all. That's safe: every migration can be
run more than once.

For a database that isn't on this computer, the script says where and how many migrations it will
apply, and asks first. --yes skips the question.
"""

import argparse
import sys
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"

# Any number unique to this app; two runs at once queue on it instead of racing.
LOCK_ID = 5934_014

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
"""


class MigrationError(Exception):
    """A migration failed. Earlier ones in this run stay applied; this one was undone."""

    def __init__(self, filename: str, cause: Exception) -> None:
        super().__init__(f"{filename} failed: {cause}")
        self.filename = filename


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    """Every migration, in the order they're applied (by filename)."""
    return sorted(directory.glob("*.sql"), key=lambda path: path.name)


def connect(database_url: str) -> psycopg.Connection:
    # autocommit, so each migration's transaction is a real one. No prepared statements, so it
    # also works through Supabase's connection pooler.
    return psycopg.connect(database_url, autocommit=True, prepare_threshold=None)


def applied_migrations(connection: psycopg.Connection) -> set[str]:
    """Filenames already recorded as applied; empty if the database has never been migrated by
    this script."""
    # Only the schema being migrated (the first on the search path) counts, not e.g. public.
    exists = connection.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = 'schema_migrations'"
    ).fetchone()
    if not exists:
        return set()
    return {name for (name,) in connection.execute("SELECT filename FROM schema_migrations")}


def pending_migrations(
    connection: psycopg.Connection, directory: Path = MIGRATIONS_DIR
) -> list[Path]:
    """Migrations not applied yet, in the order they'd be applied."""
    done = applied_migrations(connection)
    return [path for path in migration_files(directory) if path.name not in done]


def apply_pending(
    connection: psycopg.Connection,
    directory: Path = MIGRATIONS_DIR,
    report: Callable[[str], None] = print,
) -> list[str]:
    """Apply every pending migration in order; return the filenames applied. Raises
    MigrationError on the first one that fails, after undoing it."""
    connection.execute(_CREATE_TRACKING_TABLE)
    applied = []
    for path in migration_files(directory):
        with connection.transaction():
            # Held until this transaction ends; a second run waits here, then sees it's done.
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_ID,))
            already = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE filename = %s", (path.name,)
            ).fetchone()
            if already:
                continue
            try:
                connection.execute(path.read_text(encoding="utf-8"))
            except psycopg.Error as exc:
                raise MigrationError(path.name, exc) from exc
            connection.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))
        applied.append(path.name)
        report(f"  applied {path.name}")
    return applied


def describe(database_url: str) -> str:
    """Where a database URL points, without its password, e.g. "localhost:5433/mccs"."""
    parts = urlsplit(database_url)
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.hostname}{port}{parts.path}"


def is_local(database_url: str) -> bool:
    return urlsplit(database_url).hostname in _LOCAL_HOSTS


def main(argv: list[str] | None = None, ask: Callable[[str], str] = input) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.migrate",
        description="Apply the database migrations that haven't been applied yet.",
    )
    parser.add_argument(
        "--database-url", help="the database to migrate (default: DATABASE_URL in backend/.env)"
    )
    parser.add_argument(
        "--status", action="store_true", help="list applied and pending migrations and stop"
    )
    parser.add_argument(
        "--yes", action="store_true", help="don't ask before migrating a remote database"
    )
    args = parser.parse_args(argv)

    database_url = args.database_url or _url_from_settings()
    if database_url is None:
        return 1
    where = describe(database_url)

    with connect(database_url) as connection:
        done = applied_migrations(connection)
        pending = pending_migrations(connection)

        if args.status:
            for path in migration_files():
                print(f"  {'applied' if path.name in done else 'PENDING'}  {path.name}")
            print(f"{len(pending)} pending on {where}.")
            return 0

        if not pending:
            print(f"Nothing to do: {where} has every migration.")
            return 0
        if not done:
            print(
                f"First run on {where}: every migration will run (again, if some were applied "
                "by hand) and be recorded. That's safe; each one can run more than once."
            )
        if not is_local(database_url) and not args.yes:
            answer = ask(f"Apply {len(pending)} migration(s) to {where}? [y/N] ")
            if answer.strip().lower() not in ("y", "yes"):
                print("Stopped; nothing was changed.")
                return 1

        print(f"Applying {len(pending)} migration(s) to {where}:")
        try:
            applied = apply_pending(connection)
        except MigrationError as exc:
            print(f"\nStopped: {exc}", file=sys.stderr)
            print(
                f"{exc.filename} was undone; the migrations before it stay applied. "
                "Fix it and run again.",
                file=sys.stderr,
            )
            return 1
    print(f"Done: applied {len(applied)} migration(s).")
    return 0


def _url_from_settings() -> str | None:
    from app.core.config import ConfigError, get_settings

    try:
        return str(get_settings().database_url)
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return None


if __name__ == "__main__":
    raise SystemExit(main())
