"""One sync run: fetch from the source, clean up, and save (T065).

scripts/sync_products.py runs this from the command line, and the nightly GitHub Actions job
(.github/workflows/nightly-sync.yml) runs that script every night, so the catalog stays fresh
without anyone running anything.

Each night refreshes the products already imported (the ones synced longest ago first) along with
the barcodes listed in scripts/catalog_barcodes.txt, up to a limit that fits the source's daily
quota.
"""

import logging
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import psycopg

from app.ingest.connectors import Connector, RawRecord
from app.ingest.load import load_products
from app.ingest.transform import CleanProduct, RecordRejected, transform

logger = logging.getLogger("app.ingest")


@dataclass
class SyncSummary:
    """What one sync run did."""

    fetched: int = 0
    rejected: int = 0
    cleaned: int = 0
    flagged: int = 0  # cleaned products with at least one issue
    issues: Counter[str] = field(default_factory=Counter)
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0  # products that couldn't be saved
    saved: bool = False  # False for a dry run


def clean_records(records: Iterable[RawRecord], summary: SyncSummary) -> list[CleanProduct]:
    """Each record that can be a product, cleaned up; rejected ones are logged and counted."""
    products: list[CleanProduct] = []
    for record in records:
        summary.fetched += 1
        try:
            product = transform(record)
        except RecordRejected as exc:
            summary.rejected += 1
            logger.warning("Rejected %s record %s: %s", record.source, record.source_id, exc)
            continue
        if product.issues:
            summary.flagged += 1
            summary.issues.update(product.issues)
            logger.info("%s %s: %s", product.barcode, product.name, ", ".join(product.issues))
        products.append(product)
    summary.cleaned = len(products)
    return products


def run_sync(connector: Connector, connection: psycopg.Connection | None) -> SyncSummary:
    """Fetch, clean, and (with a connection) save. Commits nothing; the caller commits.

    Raises SourceUnavailableError, before anything is saved, if the source can't be reached.
    """
    summary = SyncSummary()
    # Fetch everything first, so a source that fails halfway leaves the database untouched.
    records = list(connector.fetch())
    logger.info("Fetched %d records from %s", len(records), connector.source)
    products = clean_records(records, summary)
    logger.info(
        "Cleaned %d products (%d with issues), rejected %d. Issues: %s",
        summary.cleaned,
        summary.flagged,
        summary.rejected,
        ", ".join(f"{name} {count}" for name, count in summary.issues.most_common()) or "none",
    )
    if connection is None:
        logger.info("Dry run: nothing saved")
        return summary

    counts = load_products(connection, products, synced_at=datetime.now(UTC))
    summary.inserted, summary.updated = counts["inserted"], counts["updated"]
    summary.unchanged, summary.failed = counts["unchanged"], counts["failed"]
    summary.saved = True
    logger.info(
        "Saved: %d new, %d updated, %d unchanged, %d failed",
        summary.inserted,
        summary.updated,
        summary.unchanged,
        summary.failed,
    )
    return summary


def stored_barcodes(connection: psycopg.Connection, source: str) -> list[str]:
    """Barcodes of products already imported from `source`, synced longest ago first."""
    rows = connection.execute(
        """
        SELECT barcode FROM products WHERE source = %s
        ORDER BY last_synced_at NULLS FIRST, id
        """,
        (source,),
    ).fetchall()
    return [barcode for (barcode,) in rows]


def plan_barcodes(*lists: Iterable[str], limit: int | None = None) -> list[str]:
    """The barcodes to look up: every list in order, without repeats (counting leading-zero
    forms of a barcode as the same), at most `limit`."""
    planned: list[str] = []
    seen: set[str] = set()
    for barcodes in lists:
        for barcode in barcodes:
            key = barcode.lstrip("0")
            if key in seen:
                continue
            seen.add(key)
            planned.append(barcode)
    return planned[:limit] if limit is not None else planned
