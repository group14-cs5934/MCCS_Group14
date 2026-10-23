"""Pull products from a data source (US10).

    uv run python -m scripts.sync_products              # look up scripts/catalog_barcodes.txt
    uv run python -m scripts.sync_products --barcode 012000001291
    uv run python -m scripts.sync_products --file scripts/sample_products.json   # offline

It fetches the records (T061), cleans them up (T062), and saves them to the database in
DATABASE_URL (T063): a product that's already stored (same barcode) is updated, not added again.
Records that can't be products are rejected and logged, and fixable problems (e.g. a missing
price) are listed per product. Add --dry-run to stop before saving. If the source is down, it logs
why and exits with status 1, without a traceback or any change to the database.
"""

import argparse
import logging
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import psycopg

from app.core.config import get_settings
from app.ingest.connectors import (
    Connector,
    JsonFileConnector,
    SourceUnavailableError,
    UpcItemDbConnector,
    read_barcodes,
)
from app.ingest.load import load_products
from app.ingest.transform import CleanProduct, RecordRejected, transform

SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_BARCODES_FILE = SCRIPTS_DIR / "catalog_barcodes.txt"

logger = logging.getLogger("app.ingest")


def build_connector(args: argparse.Namespace) -> Connector:
    if args.file:
        return JsonFileConnector(args.file)
    barcodes = args.barcode or read_barcodes(args.barcodes_file)
    return UpcItemDbConnector(barcodes)


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
        "--dry-run", action="store_true", help="fetch and clean, but don't save anything"
    )
    return parser.parse_args(argv)


def main(
    argv: list[str] | None = None,
    connector: Connector | None = None,
    database_url: str | None = None,
) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    connector = connector or build_connector(args)
    try:
        records = list(connector.fetch())
    except SourceUnavailableError as exc:
        logger.error("Sync stopped: the %s source is unavailable. %s", connector.source, exc)
        return 1
    logger.info("Fetched %d records from %s", len(records), connector.source)

    products: list[CleanProduct] = []
    rejected = 0
    for record in records:
        try:
            product = transform(record)
        except RecordRejected as exc:
            rejected += 1
            logger.warning("Rejected %s record %s: %s", record.source, record.source_id, exc)
            continue
        if product.issues:
            logger.info("%s %s: %s", product.barcode, product.name, ", ".join(product.issues))
        products.append(product)

    issues = Counter(issue for product in products for issue in product.issues)
    logger.info(
        "Cleaned %d products (%d with issues), rejected %d. Issues: %s",
        len(products),
        sum(1 for product in products if product.issues),
        rejected,
        ", ".join(f"{name} {count}" for name, count in issues.most_common()) or "none",
    )
    if args.dry_run:
        logger.info("Dry run: nothing saved")
        return 0

    database_url = database_url or str(get_settings().database_url)
    with psycopg.connect(database_url) as connection:
        counts = load_products(connection, products, synced_at=datetime.now(UTC))
        connection.commit()
    logger.info(
        "Saved: %d new, %d updated, %d unchanged, %d failed",
        counts["inserted"],
        counts["updated"],
        counts["unchanged"],
        counts["failed"],
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
