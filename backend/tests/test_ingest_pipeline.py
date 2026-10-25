"""The scheduled sync (T065): what the nightly run looks up, and that it pulls fresh data on its
own. Tests that need Postgres are skipped without TEST_DATABASE_URL.

T065 acceptance: when the scheduled time arrives (or a live search happens), fresh data is pulled
without manual steps. The schedule itself is GitHub Actions' job
(.github/workflows/nightly-sync.yml); these tests check that file asks for a nightly run of the
sync, and that the command it runs refreshes stored products with no other input.
"""

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
import yaml

from app.ingest.connectors import UpcItemDbConnector
from app.ingest.pipeline import plan_barcodes, stored_barcodes
from scripts import sync_products

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/nightly-sync.yml"


def test_plan_keeps_order_and_drops_repeats_of_any_barcode_form() -> None:
    planned = plan_barcodes(
        ["012000171741", "049000418347"], ["0012000171741", "016000509405"], limit=None
    )

    assert planned == ["012000171741", "049000418347", "016000509405"]


def test_plan_stops_at_the_limit() -> None:
    assert plan_barcodes(["1", "2"], ["3", "4"], limit=3) == ["1", "2", "3"]


def test_workflow_runs_the_sync_every_night() -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    triggers = workflow[True]  # YAML 1.1 reads the key "on" as true

    (schedule,) = triggers["schedule"]
    minute, hour, day, month, weekday = schedule["cron"].split()
    assert (day, month, weekday) == ("*", "*", "*")  # every day
    assert "workflow_dispatch" in triggers  # and on demand

    steps = workflow["jobs"]["sync"]["steps"]
    commands = [step.get("run", "") for step in steps]
    assert any(
        "python -m scripts.sync_products --include-stored --limit" in command
        for command in commands
    )
    assert workflow["jobs"]["sync"]["env"]["DATABASE_URL"] == "${{ secrets.SYNC_DATABASE_URL }}"


def test_workflow_stays_under_the_daily_quota() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    limit = int(text.split("--limit", 1)[1].split()[0])

    assert limit < 100  # UPCitemdb's free trial: 100 lookups a day


# --- With a database ---

OLD = datetime(2026, 10, 1, tzinfo=UTC)
NEWER = datetime(2026, 10, 15, tzinfo=UTC)


def add_imported(connection, barcode: str, name: str, synced: datetime) -> None:
    (product_id,) = connection.execute(
        """
        INSERT INTO products (barcode, name, source, source_id, last_synced_at)
        VALUES (%s, %s, 'upcitemdb', %s, %s) RETURNING id
        """,
        (barcode, name, "0" + barcode, synced),
    ).fetchone()
    connection.execute(
        "INSERT INTO prices (product_id, amount, source, observed_at) VALUES (%s, 1.00, 'x', %s)",
        (product_id, synced),
    )


@pytest.fixture
def catalog(connection):
    add_imported(connection, "049000418347", "Coca-Cola 24 pack", NEWER)
    add_imported(connection, "012000171741", "Diet Pepsi (old name)", OLD)
    connection.execute(
        "INSERT INTO products (barcode, name) VALUES ('036000291452', 'Hand-added chips')"
    )
    connection.commit()


def test_stored_barcodes_are_imported_products_synced_longest_ago_first(connection, catalog):
    assert stored_barcodes(connection, "upcitemdb") == ["012000171741", "049000418347"]


class FakeUpcItemDb:
    """Today's data at the source: new names and prices for both stored products."""

    ITEMS = {
        "012000171741": {
            "ean": "0012000171741",
            "title": "Diet Pepsi 20 fl oz",
            "lowest_recorded_price": 1.89,
        },
        "049000418347": {
            "ean": "0049000418347",
            "title": "Coca-Cola 16.9 oz 24 pack",
            "lowest_recorded_price": 9.99,
        },
    }

    def __init__(self) -> None:
        self.looked_up: list[str] = []

    def __call__(self, url, payload):
        self.looked_up.append(payload["upc"])
        item = self.ITEMS.get(payload["upc"])
        return {"code": "OK", "items": [item] if item else []}


@pytest.fixture
def source(monkeypatch) -> FakeUpcItemDb:
    fake = FakeUpcItemDb()
    monkeypatch.setattr(
        sync_products,
        "UpcItemDbConnector",
        lambda barcodes: UpcItemDbConnector(barcodes, post=fake, sleep=lambda _s: None),
    )
    return fake


def test_nightly_command_pulls_fresh_data_for_stored_products(
    db_url, connection, catalog, source, tmp_path
) -> None:
    empty_list = tmp_path / "barcodes.txt"
    empty_list.write_text("", encoding="utf-8")

    status = sync_products.main(
        ["--include-stored", "--limit", "90", "--barcodes-file", str(empty_list)],
        database_url=db_url,
    )

    assert status == 0
    assert source.looked_up == ["012000171741", "049000418347"]  # oldest first
    connection.commit()
    rows = connection.execute(
        """
        SELECT p.name, pr.amount, p.last_synced_at > %s FROM products AS p
        JOIN LATERAL (SELECT amount FROM prices WHERE product_id = p.id
                      ORDER BY observed_at DESC, id DESC LIMIT 1) AS pr ON TRUE
        WHERE p.source = 'upcitemdb' ORDER BY p.barcode
        """,
        (NEWER,),
    ).fetchall()
    assert rows == [
        ("Diet Pepsi 20 fl oz", Decimal("1.89"), True),
        ("Coca-Cola 16.9 oz 24 pack", Decimal("9.99"), True),
    ]


def test_nightly_command_adds_listed_barcodes_after_stored_ones_within_the_limit(
    db_url, catalog, source, tmp_path
) -> None:
    listed = tmp_path / "barcodes.txt"
    listed.write_text("0049000418347\n016000509405\n016000178199\n", encoding="utf-8")

    sync_products.main(
        ["--include-stored", "--limit", "3", "--barcodes-file", str(listed)], database_url=db_url
    )

    # Stored first; 0049000418347 is already stored; the limit cuts the last one.
    assert source.looked_up == ["012000171741", "049000418347", "016000509405"]
