"""The ingest_runs table (T066): one row per sync run, with its start and end time, counts, and
errors (migration 008)."""

import psycopg
from psycopg.types.json import Jsonb

from app.ingest.pipeline import SyncSummary

# Errors kept per run; a run where every record fails shouldn't make a huge row.
MAX_ERRORS = 200


def start_run(connection: psycopg.Connection, source: str) -> int:
    """Record that a run started; return its ID. Commits, so the row is there (as running) even
    if the run crashes or is rolled back."""
    (run_id,) = connection.execute(
        "INSERT INTO ingest_runs (source) VALUES (%s) RETURNING id", (source,)
    ).fetchone()
    connection.commit()
    return run_id


def run_status(summary: SyncSummary) -> str:
    return "partial" if summary.failed else "succeeded"


def finish_run(
    connection: psycopg.Connection,
    run_id: int,
    summary: SyncSummary,
    status: str,
    errors: list[str],
) -> None:
    """Record how the run ended. Runs in the caller's transaction, so a successful run's row and
    its products are committed together."""
    kept = errors[:MAX_ERRORS]
    if len(errors) > MAX_ERRORS:
        kept.append(f"... and {len(errors) - MAX_ERRORS} more")
    connection.execute(
        """
        UPDATE ingest_runs SET
            status = %(status)s, finished_at = NOW(),
            fetched = %(fetched)s, rejected = %(rejected)s, inserted = %(inserted)s,
            updated = %(updated)s, unchanged = %(unchanged)s, failed = %(failed)s,
            issues = %(issues)s, errors = %(errors)s
        WHERE id = %(id)s
        """,
        {
            "id": run_id,
            "status": status,
            "fetched": summary.fetched,
            "rejected": summary.rejected,
            "inserted": summary.inserted,
            "updated": summary.updated,
            "unchanged": summary.unchanged,
            "failed": summary.failed,
            "issues": Jsonb(dict(summary.issues)),
            "errors": Jsonb(kept),
        },
    )
