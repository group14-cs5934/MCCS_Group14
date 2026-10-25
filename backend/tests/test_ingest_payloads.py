"""The ingestion pipeline on sample source payloads, good and malformed (T067).

T067 acceptance: when tests run with good and malformed sample payloads, good data loads and bad
data is rejected.

tests/fixtures/ingest/ holds the payloads:
    upcitemdb_lookup_ok.json   a real-shaped UPCitemdb lookup response with three good products
    malformed_records.json     broken records, each with why it's broken and what should happen:
                               "reject": true (rejected), "skipped" (no barcode, so the connector
                               skips it), or false (loaded, with the listed issues flagged)

Tests that save to Postgres are skipped without TEST_DATABASE_URL.
"""

import json
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest

from app.ingest.connectors import (
    RawRecord,
    SourceUnavailableError,
    UpcItemDbConnector,
)
from app.ingest.pipeline import SyncSummary, clean_records, run_sync
from app.ingest.transform import RecordRejected, transform
from scripts import sync_products

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "ingest"
LOOKUP_OK = json.loads((FIXTURES / "upcitemdb_lookup_ok.json").read_text(encoding="utf-8"))
MALFORMED = json.loads((FIXTURES / "malformed_records.json").read_text(encoding="utf-8"))
GOOD_ITEMS = LOOKUP_OK["items"]
by_why = pytest.mark.parametrize("case", MALFORMED, ids=[case["why"] for case in MALFORMED])


def record(item: dict) -> RawRecord:
    return RawRecord("upcitemdb", str(item.get("ean", "")), item)


def source_answering(response) -> UpcItemDbConnector:
    """A connector whose every lookup gets `response` back."""
    return UpcItemDbConnector(["012000171741"], post=lambda url, payload: response)


# --- Good payloads ---


def test_good_lookup_response_is_fetched_and_cleaned() -> None:
    products = [transform(r) for r in source_answering(LOOKUP_OK).fetch()]

    assert [(p.barcode, p.size, p.price) for p in products] == [
        ("012000171741", "20 fl oz", Decimal("1.59")),
        ("049000418347", "16.9 oz", Decimal("9.98")),
        ("016000178199", "16 oz", Decimal("3.28")),
    ]
    assert [p.image_url for p in products] == [
        "https://example.com/diet-pepsi.jpg",
        "https://example.com/coke.jpg",
        "https://example.com/franken-berry.jpg",
    ]
    assert all(p.issues == () for p in products)


# --- Malformed records ---


@by_why
def test_each_malformed_record_is_rejected_or_flagged(case) -> None:
    item = case["item"]
    if case["reject"] == "skipped":
        assert list(source_answering({"code": "OK", "items": [item]}).fetch()) == []
    elif case["reject"]:
        with pytest.raises(RecordRejected):
            transform(record(item))
    else:
        product = transform(record(item))
        assert sorted(product.issues) == sorted(case["issues"])


def test_a_mixed_batch_keeps_the_good_and_counts_the_bad() -> None:
    items = GOOD_ITEMS + [case["item"] for case in MALFORMED if case["reject"] is True]
    summary = SyncSummary()

    products = clean_records([record(item) for item in items], summary)

    assert [p.barcode for p in products] == [record(i).payload["upc"] for i in GOOD_ITEMS]
    assert summary.rejected == sum(case["reject"] is True for case in MALFORMED)
    assert len(summary.errors) == summary.rejected


# --- Malformed responses from the source ---


@pytest.mark.parametrize(
    "response",
    [
        [GOOD_ITEMS[0]],  # a list, not an object
        "<html>Service Unavailable</html>",
        None,
    ],
    ids=["list", "html text", "null"],
)
def test_response_that_isnt_an_object_means_the_source_is_unusable(response) -> None:
    with pytest.raises(SourceUnavailableError, match="unexpected response"):
        list(source_answering(response).fetch())


@pytest.mark.parametrize(
    "response",
    [
        {"code": "OK"},  # no items
        {"code": "OK", "items": None},
        {"code": "OK", "items": "not a list"},
        {"code": "OK", "items": [None, 7, "x"]},
        {"code": "INVALID_UPC", "message": "Not a valid UPC"},
        {"total": 0},  # no code
    ],
    ids=["no items", "null items", "items not a list", "junk items", "invalid upc", "no code"],
)
def test_odd_but_harmless_responses_give_no_records(response) -> None:
    assert list(source_answering(response).fetch()) == []


# --- Through the database ---


def stored(connection: psycopg.Connection) -> list[tuple]:
    connection.commit()
    return connection.execute(
        "SELECT barcode, name, size, source_id FROM products ORDER BY barcode"
    ).fetchall()


def test_good_data_loads_and_bad_data_is_rejected(connection) -> None:
    items = GOOD_ITEMS + [case["item"] for case in MALFORMED]
    good_barcodes = {"012000171741", "049000418347", "016000178199", "012000001291"}

    class Batch:
        source = "upcitemdb"

        def fetch(self):
            for item in items:
                if item.get("ean"):  # what the connector does
                    yield record(item)

    summary = run_sync(Batch(), connection)

    rows = stored(connection)
    assert {row[0] for row in rows} == good_barcodes
    # The flagged "Pepsi" records are one product (same barcode), stored once.
    assert len(rows) == 4
    assert summary.rejected == sum(case["reject"] is True for case in MALFORMED)
    assert (summary.inserted, summary.failed) == (4, 0)


def test_sync_command_on_a_payload_file(db_url, connection, tmp_path) -> None:
    path = tmp_path / "payload.json"
    path.write_text(
        json.dumps(GOOD_ITEMS + [case["item"] for case in MALFORMED if case["reject"] is True]),
        encoding="utf-8",
    )

    assert sync_products.main(["--file", str(path)], database_url=db_url) == 0

    assert [row[0] for row in stored(connection)] == [
        "012000171741",
        "016000178199",
        "049000418347",
    ]
    (run,) = connection.execute("SELECT status, inserted, rejected FROM ingest_runs").fetchall()
    assert run == ("succeeded", 3, sum(case["reject"] is True for case in MALFORMED))
