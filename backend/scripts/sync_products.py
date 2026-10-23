"""Pull products from a data source (US10).

    uv run python -m scripts.sync_products              # look up scripts/catalog_barcodes.txt
    uv run python -m scripts.sync_products --barcode 012000001291
    uv run python -m scripts.sync_products --file scripts/sample_products.json   # offline

For now this fetches and reports what the source has (T061); cleaning the records and saving
them to the database are added by T062 and T063. If the source is down, it logs why and exits
with status 1, without a traceback.
"""

import argparse
import logging
import sys
from pathlib import Path

from app.ingest.connectors import (
    Connector,
    JsonFileConnector,
    SourceUnavailableError,
    UpcItemDbConnector,
    read_barcodes,
)

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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None, connector: Connector | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    connector = connector or build_connector(args)
    try:
        records = list(connector.fetch())
    except SourceUnavailableError as exc:
        logger.error("Sync stopped: the %s source is unavailable. %s", connector.source, exc)
        return 1
    logger.info("Fetched %d records from %s", len(records), connector.source)
    return 0


if __name__ == "__main__":
    sys.exit(main())
