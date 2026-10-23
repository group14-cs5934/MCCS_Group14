"""Sync run history, logging, and error handling (T066), needs TEST_DATABASE_URL.

T066 acceptance: when a sync finishes, a run record shows start/end time, counts, and any errors.
"""

import json
import logging
import urllib.error
from pathlib import Path

import psycopg
import pytest

from app.ingest.connectors import UpcItemDbConnector
from scripts import sync_products
from scripts.seed_dev import SAMPLE_CATALOG_FILE

GOOD = {"ean": "0012000171741", "title": "Diet Pepsi 20 fl oz", "lowest_recorded_price": 1.59}
NO_PRICE = {"ean": "0012000001291", "title": "Pepsi 20 fl oz", "lowest_recorded_price": 0}
BAD_BARCODE = {"ean": "0012000171742", "title": "Wrong check digit"}


def runs(connection: psycopg.Connection) -> list[dict]:
    connection.commit()
    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        return cursor.execute("SELECT * FROM ingest_runs ORDER BY id").fetchall()


def records_file(tmp_path: Path, *items: dict) -> str:
    path = tmp_path / "records.json"
    path.write_text(json.dumps(list(items)), encoding="utf-8")
    return str(path)


def test_finished_run_records_times_counts_and_errors(db_url, connection, tmp_path) -> None:
    status = sync_products.main(
        ["--file", records_file(tmp_path, GOOD, NO_PRICE, BAD_BARCODE)], database_url=db_url
    )

    assert status == 0
    (run,) = runs(connection)
    assert run["source"] == "upcitemdb"
    assert run["status"] == "succeeded"
    assert run["started_at"] <= run["finished_at"]
    assert (run["fetched"], run["rejected"], run["inserted"], run["updated"]) == (3, 1, 2, 0)
    assert (run["unchanged"], run["failed"]) == (0, 0)
    assert run["issues"]["no_price"] == 1
    assert run["errors"] == [
        "Rejected upcitemdb record 0012000171742: barcode '0012000171742' isn't a valid UPC/EAN"
    ]


def test_each_run_gets_its_own_record(db_url, connection) -> None:
    args = ["--file", str(SAMPLE_CATALOG_FILE)]
    sync_products.main(args, database_url=db_url)
    sync_products.main(args, database_url=db_url)

    first, second = runs(connection)
    assert (first["inserted"], second["inserted"], second["unchanged"]) == (18, 0, 18)
    assert second["started_at"] >= first["finished_at"]


def test_source_down_is_recorded_as_failed_with_the_reason(db_url, connection, caplog) -> None:
    def unreachable(url, payload):
        raise urllib.error.URLError("Network is unreachable")

    down = UpcItemDbConnector(["012000171741"], post=unreachable)

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        status = sync_products.main([], connector=down, database_url=db_url)

    assert status == 1
    (run,) = runs(connection)
    assert run["status"] == "failed"
    assert run["finished_at"] is not None
    assert "upcitemdb source is unavailable" in run["errors"][0]
    assert "Network is unreachable" in run["errors"][0]
    assert f"Sync run {run['id']} started" in caplog.text


def test_unexpected_crash_is_recorded_and_nothing_is_saved(db_url, connection, monkeypatch):
    def crash(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr("app.ingest.pipeline.load_products", crash)

    status = sync_products.main(["--file", str(SAMPLE_CATALOG_FILE)], database_url=db_url)

    assert status == 1
    (run,) = runs(connection)
    assert run["status"] == "failed"
    assert run["errors"] == ["Unexpected error: RuntimeError: disk full"]
    assert connection.execute("SELECT count(*) FROM products").fetchone() == (0,)


def test_products_that_cant_be_saved_make_a_partial_run(db_url, connection, tmp_path) -> None:
    # A product already stored with this source ID but another barcode, which belongs to a third
    # product: updating it would duplicate a barcode, so that one product fails.
    connection.execute(
        "INSERT INTO products (barcode, name, source, source_id) "
        "VALUES ('036000291452', 'Old', 'upcitemdb', '0012000171741')"
    )
    connection.execute("INSERT INTO products (barcode, name) VALUES ('012000171741', 'Other')")
    connection.commit()

    status = sync_products.main(
        ["--file", records_file(tmp_path, GOOD, NO_PRICE)], database_url=db_url
    )

    assert status == 1
    (run,) = runs(connection)
    assert (run["status"], run["inserted"], run["failed"]) == ("partial", 1, 1)
    assert run["errors"][0].startswith("Couldn't save 012000171741 Diet Pepsi 20 fl oz")


def test_dry_run_isnt_recorded(db_url, connection) -> None:
    sync_products.main(["--dry-run", "--file", str(SAMPLE_CATALOG_FILE)], database_url=db_url)

    assert runs(connection) == []


def test_running_and_finished_rules_are_enforced(connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "INSERT INTO ingest_runs (source, status, finished_at) VALUES ('x', 'running', NOW())"
        )


def test_long_error_lists_are_capped(db_url, connection, tmp_path) -> None:
    bad = [{"ean": f"00120001717{n:02d}", "title": ""} for n in range(250)]

    sync_products.main(["--file", records_file(tmp_path, *bad)], database_url=db_url)

    (run,) = runs(connection)
    assert run["rejected"] == 250
    assert len(run["errors"]) == 201
    assert run["errors"][-1] == "... and 50 more"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Never let these tests reach the real UPCitemdb."""
    monkeypatch.setattr(
        sync_products,
        "UpcItemDbConnector",
        lambda barcodes: pytest.fail("tests must not call the real UPCitemdb"),
    )
