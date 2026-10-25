"""Data-source connectors and the sync command's fetch step (T061).

T061 acceptance: when the connector runs, it fetches products from the chosen source; when the
source is down, it logs the error and exits cleanly. No test calls the real UPCitemdb: its
requests go to a fake.
"""

import io
import json
import logging
import urllib.error
from pathlib import Path

import pytest

from app.ingest.connectors import (
    UPCITEMDB_LOOKUP_URL,
    JsonFileConnector,
    RawRecord,
    SourceUnavailableError,
    UpcItemDbConnector,
    read_barcodes,
)
from scripts import sync_products
from scripts.seed_dev import SAMPLE_CATALOG_FILE

COKE = {"ean": "0012000001291", "title": "Coca-Cola Classic", "lowest_recorded_price": 1.99}
PEPSI = {"ean": "0012000100109", "title": "Pepsi Cola"}


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(UPCITEMDB_LOOKUP_URL, code, "error", {}, io.BytesIO(b""))


class FakeUpcItemDb:
    """Answers lookups from `products` (barcode -> item); `fail` makes every request raise it."""

    def __init__(self, products: dict[str, dict], fail: Exception | None = None) -> None:
        self.products = products
        self.fail = fail
        self.requests: list[tuple[str, dict]] = []

    def __call__(self, url: str, payload: dict) -> dict:
        self.requests.append((url, payload))
        if self.fail:
            raise self.fail
        item = self.products.get(payload["upc"])
        return {"code": "OK", "total": int(bool(item)), "items": [item] if item else []}


def connector(fake: FakeUpcItemDb, *barcodes: str) -> UpcItemDbConnector:
    return UpcItemDbConnector(barcodes, post=fake, sleep=lambda _seconds: None)


def test_fetches_each_barcode_from_upcitemdb() -> None:
    fake = FakeUpcItemDb({"012000001291": COKE, "012000100109": PEPSI})

    records = list(connector(fake, "012000001291", "012000100109").fetch())

    assert records == [
        RawRecord("upcitemdb", "0012000001291", COKE),
        RawRecord("upcitemdb", "0012000100109", PEPSI),
    ]
    assert fake.requests == [
        (UPCITEMDB_LOOKUP_URL, {"upc": "012000001291"}),
        (UPCITEMDB_LOOKUP_URL, {"upc": "012000100109"}),
    ]


def test_waits_between_requests_to_respect_the_rate_limit() -> None:
    waits: list[float] = []
    fake = FakeUpcItemDb({"012000001291": COKE, "012000100109": PEPSI})
    upc = UpcItemDbConnector(
        ["012000001291", "012000100109", "999"], post=fake, delay_seconds=10, sleep=waits.append
    )

    list(upc.fetch())

    assert waits == [10, 10]  # between requests, not before the first


def test_unknown_barcodes_are_skipped_and_logged(caplog) -> None:
    fake = FakeUpcItemDb({"012000001291": COKE})

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        records = list(connector(fake, "000000000000", "012000001291").fetch())

    assert [record.source_id for record in records] == ["0012000001291"]
    assert "no product with barcode 000000000000" in caplog.text


def test_barcode_upcitemdb_calls_invalid_is_skipped() -> None:
    class RejectsFirst(FakeUpcItemDb):
        def __call__(self, url, payload):
            if payload["upc"] == "123":
                raise http_error(400)
            return super().__call__(url, payload)

    records = list(connector(RejectsFirst({"012000001291": COKE}), "123", "012000001291").fetch())

    assert len(records) == 1


@pytest.mark.parametrize(
    "failure",
    [
        urllib.error.URLError("Name or service not known"),
        TimeoutError("timed out"),
        http_error(429),
        http_error(503),
        ValueError("Expecting value"),  # a response that isn't JSON
    ],
    ids=["unreachable", "timeout", "rate limited", "server error", "not json"],
)
def test_source_down_raises_source_unavailable(failure) -> None:
    fake = FakeUpcItemDb({}, fail=failure)

    with pytest.raises(SourceUnavailableError):
        list(connector(fake, "012000001291").fetch())


@pytest.mark.parametrize("code", ["TOO_FAST", "EXCEED_LIMIT", "SERVER_ERR"])
def test_upcitemdb_refusing_requests_counts_as_unavailable(code) -> None:
    def refuse(url, payload):
        return {"code": code, "message": "slow down"}

    with pytest.raises(SourceUnavailableError, match=code):
        list(UpcItemDbConnector(["012000001291"], post=refuse).fetch())


def test_file_connector_reads_saved_records() -> None:
    records = list(JsonFileConnector(SAMPLE_CATALOG_FILE).fetch())

    saved = json.loads(SAMPLE_CATALOG_FILE.read_text(encoding="utf-8"))
    assert len(records) == len(saved)
    assert records[0] == RawRecord("upcitemdb", saved[0]["ean"], saved[0])


def test_file_connector_skips_entries_without_a_barcode(tmp_path: Path) -> None:
    path = tmp_path / "records.json"
    path.write_text(json.dumps([COKE, {"title": "No barcode"}, "not an object"]), encoding="utf-8")

    assert [r.source_id for r in JsonFileConnector(path).fetch()] == ["0012000001291"]


@pytest.mark.parametrize("contents", [None, "{not json", '{"items": []}'])
def test_missing_or_broken_file_is_unavailable(tmp_path: Path, contents) -> None:
    path = tmp_path / "records.json"
    if contents is not None:
        path.write_text(contents, encoding="utf-8")

    with pytest.raises(SourceUnavailableError):
        list(JsonFileConnector(path).fetch())


def test_barcodes_file_ignores_comments_and_blank_lines(tmp_path: Path) -> None:
    path = tmp_path / "barcodes.txt"
    path.write_text("# header\n012000001291\n\n  012000100109  # Pepsi\n", encoding="utf-8")

    assert read_barcodes(path) == ["012000001291", "012000100109"]


def test_catalog_barcodes_file_lists_the_spike_products() -> None:
    barcodes = read_barcodes(sync_products.DEFAULT_BARCODES_FILE)

    assert len(barcodes) >= 15
    assert all(barcode.isdigit() for barcode in barcodes)


# --- The sync command ---


def test_sync_command_fetches_and_reports(caplog) -> None:
    fake = FakeUpcItemDb({"012000001291": COKE})

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        status = sync_products.main(["--dry-run"], connector=connector(fake, "012000001291"))

    assert status == 0
    assert "Fetched 1 records from upcitemdb" in caplog.text


def test_sync_command_exits_cleanly_when_the_source_is_down(caplog) -> None:
    fake = FakeUpcItemDb({}, fail=urllib.error.URLError("Network is unreachable"))

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        status = sync_products.main(["--dry-run"], connector=connector(fake, "012000001291"))

    assert status == 1  # an error status, but no exception or traceback
    assert "Sync stopped: the upcitemdb source is unavailable" in caplog.text
    assert "Network is unreachable" in caplog.text


def test_sync_command_reads_a_file_offline(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="app.ingest"):
        status = sync_products.main(["--dry-run", "--file", str(SAMPLE_CATALOG_FILE)])

    assert status == 0
    assert "Fetched 18 records" in caplog.text
