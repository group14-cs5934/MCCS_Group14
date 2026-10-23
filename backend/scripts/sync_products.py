"""Pull products from a data source into the catalog (US10).

    uv run python -m scripts.sync_products              # look up scripts/catalog_barcodes.txt
    uv run python -m scripts.sync_products --barcode 012000001291
    uv run python -m scripts.sync_products --file scripts/sample_products.json   # offline
    uv run python -m scripts.sync_products --include-stored --limit 90           # the nightly run

It fetches the records (T061), cleans them up (T062), and saves them to the database in
DATABASE_URL (T063): a product that's already stored (same barcode) is updated, not added again.
Records that can't be products are rejected and logged, and fixable problems (e.g. a missing
price) are listed per product. Add --dry-run to stop before saving. If the source is down, it logs
why and exits with status 1, without a traceback or any change to the database.

--include-stored also refreshes every product already imported (synced longest ago first), and
--limit caps the lookups (UPCitemdb's free trial allows 100 a day). The nightly GitHub Actions job
runs it this way (T065).

Every run that saves (not --dry-run) is recorded in the ingest_runs table with its start and end
time, counts, and errors, including runs that fail (T066).
"""

import argparse
import logging
import os
import sys
from pathlib import Path

import psycopg

from app.core.config import get_settings
from app.ingest.connectors import (
    UPCITEMDB,
    Connector,
    JsonFileConnector,
    SourceUnavailableError,
    UpcItemDbConnector,
    read_barcodes,
)
from app.ingest.pipeline import SyncSummary, plan_barcodes, run_sync, stored_barcodes
from app.ingest.runs import finish_run, run_status, start_run

SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_BARCODES_FILE = SCRIPTS_DIR / "catalog_barcodes.txt"

logger = logging.getLogger("app.ingest")


def build_connector(args: argparse.Namespace, connection: psycopg.Connection | None) -> Connector:
    if args.file:
        return JsonFileConnector(args.file)
    listed = args.barcode or read_barcodes(args.barcodes_file)
    stored = stored_barcodes(connection, UPCITEMDB) if args.include_stored and connection else []
    # Stored products first, so every one gets refreshed even when the limit cuts the list.
    return UpcItemDbConnector(plan_barcodes(stored, listed, limit=args.limit))


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--file", type=Path, help="read saved UPCitemdb records from this file")
    source.add_argument("--barcode", action="append", help="look up this barcode (repeatable)")
    source.add_argument(
        "--barcodes-file",
        type=Path,
        default=DEFAULT_BARCODES_FILE,
        help="look up every barcode in this file (default: scripts/catalog_barcodes.txt)",
    )
    parser.add_argument(
        "--include-stored",
        action="store_true",
        help="also refresh every product already imported, synced longest ago first",
    )
    parser.add_argument(
        "--limit", type=int, help="look up at most this many barcodes (the source's daily quota)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="fetch and clean, but don't save anything"
    )
    return parser.parse_args(argv)


def default_database_url() -> str:
    # The nightly job only sets DATABASE_URL, so don't require the API's other settings.
    return os.environ.get("DATABASE_URL") or str(get_settings().database_url)


def main(
    argv: list[str] | None = None,
    connector: Connector | None = None,
    database_url: str | None = None,
) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    if args.dry_run and not args.include_stored:
        return _sync(args, connector, connection=None)
    # prepare_threshold=None: Supabase's pooler doesn't support prepared statements.
    with psycopg.connect(database_url or default_database_url(), prepare_threshold=None) as db:
        return _sync(args, connector, connection=db)


def _sync(
    args: argparse.Namespace, connector: Connector | None, connection: psycopg.Connection | None
) -> int:
    connector = connector or build_connector(args, connection)
    if args.dry_run or connection is None:
        try:
            run_sync(connector, None)
        except SourceUnavailableError as exc:
            logger.error("Sync stopped: the %s source is unavailable. %s", connector.source, exc)
            return 1
        return 0

    # Every real run is recorded in ingest_runs (T066), however it ends.
    run_id = start_run(connection, connector.source)
    logger.info("Sync run %d started", run_id)
    try:
        summary = run_sync(connector, connection)
    except SourceUnavailableError as exc:
        message = f"The {connector.source} source is unavailable. {exc}"
        logger.error("Sync stopped: %s", message)
        return _fail_run(connection, run_id, message)
    except Exception as exc:  # anything unexpected: record it, then show the traceback
        logger.exception("Sync run %d crashed", run_id)
        return _fail_run(connection, run_id, f"Unexpected error: {type(exc).__name__}: {exc}")

    status = run_status(summary)
    finish_run(connection, run_id, summary, status, summary.errors)
    connection.commit()  # the products and the run's record together
    logger.info("Sync run %d %s", run_id, status)
    return 1 if summary.failed else 0


def _fail_run(connection: psycopg.Connection, run_id: int, message: str) -> int:
    """Undo the run's changes and record it as failed."""
    connection.rollback()
    finish_run(connection, run_id, SyncSummary(), "failed", [message])
    connection.commit()
    return 1


if __name__ == "__main__":
    sys.exit(main())
