"""Data-source connectors (T061): fetch raw product records from where the catalog comes from.

Every connector has a `source` name (stored on each imported product) and a fetch() that yields
RawRecords. If the source can't be reached, fetch() raises SourceUnavailableError, and the sync
logs it and stops without changing anything.

    UpcItemDbConnector  looks barcodes up in UPCitemdb's API (the source the T022 spike used)
    JsonFileConnector   reads saved UPCitemdb records from a JSON file, e.g.
                        scripts/sample_products.json, for offline runs and tests
"""

import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger("app.ingest")

UPCITEMDB = "upcitemdb"
UPCITEMDB_LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup"
REQUEST_TIMEOUT_SECONDS = 20
# The free trial allows about 6 lookups a minute (and 100 a day), so wait between requests.
UPCITEMDB_DELAY_SECONDS = 10.0
# UPCitemdb error codes that mean "stop for now", not "this barcode is bad".
_UPCITEMDB_STOP_CODES = {"TOO_FAST", "EXCEED_LIMIT", "SERVER_ERR"}

# Sends a JSON POST and returns the decoded JSON response. Raises urllib.error.HTTPError for an
# error status, and URLError or TimeoutError when the server can't be reached.
JsonPost = Callable[[str, dict[str, Any]], dict[str, Any]]


class SourceUnavailableError(Exception):
    """The data source is down, unreachable, or refusing requests (e.g. over its daily limit)."""


@dataclass(frozen=True)
class RawRecord:
    """One product as the source sent it."""

    source: str
    source_id: str  # the product's ID in the source
    payload: dict[str, Any]


class Connector(Protocol):
    source: str

    def fetch(self) -> Iterator[RawRecord]:
        """Yield each product the source has. Raises SourceUnavailableError if it can't."""
        ...


def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "MCCS-Group14-sync/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.load(response)


def _upcitemdb_record(item: dict[str, Any]) -> RawRecord | None:
    source_id = str(item.get("ean") or item.get("upc") or "").strip()
    return RawRecord(UPCITEMDB, source_id, item) if source_id else None


class UpcItemDbConnector:
    """Looks each barcode up in UPCitemdb. Barcodes it doesn't know are skipped (and logged)."""

    source = UPCITEMDB

    def __init__(
        self,
        barcodes: Iterable[str],
        post: JsonPost = post_json,
        delay_seconds: float = UPCITEMDB_DELAY_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._barcodes = list(barcodes)
        self._post = post
        self._delay = delay_seconds
        self._sleep = sleep

    def fetch(self) -> Iterator[RawRecord]:
        for number, barcode in enumerate(self._barcodes):
            if number:
                self._sleep(self._delay)
            items = self._lookup(barcode)
            if not items:
                logger.info("UPCitemdb has no product with barcode %s", barcode)
            for item in items:
                record = _upcitemdb_record(item)
                if record is not None:
                    yield record

    def _lookup(self, barcode: str) -> list[dict[str, Any]]:
        try:
            data = self._post(UPCITEMDB_LOOKUP_URL, {"upc": barcode})
        except urllib.error.HTTPError as exc:
            # 400 is how UPCitemdb answers an invalid barcode: skip it. Anything else (429 rate
            # limit, 5xx) means the source isn't usable right now.
            if exc.code == 400:
                logger.warning("UPCitemdb rejected barcode %s as invalid", barcode)
                return []
            raise SourceUnavailableError(f"UPCitemdb answered HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SourceUnavailableError(f"Can't reach UPCitemdb: {exc}") from exc
        except ValueError as exc:  # the response wasn't JSON
            raise SourceUnavailableError("UPCitemdb sent a response that isn't JSON") from exc

        code = data.get("code")
        if code in _UPCITEMDB_STOP_CODES:
            raise SourceUnavailableError(f"UPCitemdb refused the request ({code})")
        if code != "OK":
            logger.warning("UPCitemdb answered %s for barcode %s", code, barcode)
            return []
        return [item for item in data.get("items") or [] if isinstance(item, dict)]


class JsonFileConnector:
    """Reads saved UPCitemdb records (a JSON list of items, like scripts/sample_products.json)."""

    source = UPCITEMDB

    def __init__(self, path: Path) -> None:
        self._path = path

    def fetch(self) -> Iterator[RawRecord]:
        try:
            items = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SourceUnavailableError(f"Can't read {self._path}: {exc}") from exc
        if not isinstance(items, list):
            raise SourceUnavailableError(f"{self._path} must contain a JSON list of products")
        for item in items:
            record = _upcitemdb_record(item) if isinstance(item, dict) else None
            if record is None:
                logger.warning("Skipping an entry in %s with no barcode", self._path.name)
                continue
            yield record


def read_barcodes(path: Path) -> list[str]:
    """Barcodes listed in a text file, one per line; blank lines and # comments are ignored."""
    lines = (
        line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines()
    )
    return [line for line in lines if line]
