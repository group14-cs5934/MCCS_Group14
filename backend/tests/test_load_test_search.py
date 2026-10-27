"""The search load test (T096, scripts/load_test_search.py) and what it led to fixing.

The timing target itself (95% of 50 simultaneous searches in under 1 second) is checked by
running the script on a full-size catalog; see docs/performance/2026-10-27-search-load-test.md.
These tests check the script works, plus the two fixes it found: the prices index (migration 015)
and that a burst of requests no longer stalls waiting for a database connection. Shared CI
machines are too uneven to assert timings, so only correctness is checked here.
"""

import os
import random
from urllib.parse import parse_qs, urlsplit

import psycopg
import pytest

from app.schemas.product import _check_barcode
from scripts import load_test_search as load
from scripts.load_test_search import Report, Result


def test_percentile_is_nearest_rank() -> None:
    values = [float(n) for n in range(1, 101)]

    assert load.percentile(values, 50) == 50
    assert load.percentile(values, 95) == 95
    assert load.percentile([0.3, 0.1, 0.2], 95) == 0.3
    with pytest.raises(ValueError):
        load.percentile([], 95)


def test_barcodes_are_unique_and_pass_the_apis_check() -> None:
    barcodes = [load.upc_a(number) for number in (1, 2, 14_266, 99_999, 100_000)]

    assert len(set(barcodes)) == len(barcodes)
    for barcode in barcodes:
        assert len(barcode) == 12
        assert _check_barcode(barcode) == barcode


def test_a_typo_drops_one_inner_letter_of_long_words_only() -> None:
    rng = random.Random(1)

    typo = load.with_typo("chocolate", rng)

    assert len(typo) == len("chocolate") - 1
    assert typo[0] == "c" and typo[-1] == "e"
    assert load.with_typo("soda", rng) == "soda"


def test_searches_are_mixed_like_the_app_sends_them() -> None:
    plan = load.search_plan(2_000, random.Random(96), ["quantico-mcx"])

    kinds = {kind for kind, _ in plan}
    assert kinds == set(load.SEARCH_KINDS)
    for kind, path in plan:
        url = urlsplit(path)
        params = parse_qs(url.query)
        assert url.path == "/products/search"
        assert params["limit"] == [str(load.PAGE_SIZE)]
        assert ("q" in params) == kind.startswith("name")
        assert ("store" in params) == ("store" in kind)
        assert ("in_stock" in params) == kind.endswith("in_stock")
    name_searches = sum(kind == "name" for kind, _ in plan)
    assert 0.3 < name_searches / len(plan) < 0.5  # 40% asked for


def test_the_report_passes_only_under_a_second_with_no_errors() -> None:
    fast = [Result("name", 0.2, 200)] * 99 + [Result("name", 2.0, 200)]
    slow = [Result("name", 1.2, 200)] * 10 + [Result("name", 0.2, 200)] * 90
    failed = [Result("name", 0.2, 200)] * 99 + [Result("name", 0.2, 500)]

    assert Report(fast, 50).passed  # one slow search in 100 is within the 95%
    assert not Report(slow, 50).passed
    assert not Report(failed, 50).passed
    assert Report(fast, 50).lines()[-1].startswith("PASS")


@pytest.mark.parametrize(
    ("url", "local"),
    [
        ("postgresql://postgres:postgres@localhost:5433/postgres", True),
        ("postgresql://postgres@127.0.0.1/postgres", True),
        ("postgresql://user:secret@db.abcd1234.supabase.co:5432/postgres", False),
    ],
)
def test_only_a_local_database_is_used_unless_allowed(url, local) -> None:
    assert load.is_local(url) is local


def test_main_refuses_a_remote_database(capsys) -> None:
    with pytest.raises(SystemExit):
        load.main(["--database-url", "postgresql://u:p@db.example.com/postgres"])

    assert "--allow-remote" in capsys.readouterr().err


def test_a_url_without_a_host_uses_pghost(monkeypatch) -> None:
    monkeypatch.setenv("PGHOST", "db.example.com")
    monkeypatch.delenv("PGHOSTADDR", raising=False)

    assert not load.is_local("postgresql:///postgres")
    assert not load.is_local("postgresql://postgres@/postgres?hostaddr=10.0.0.5")


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (["--database-url", "host=localhost dbname=postgres"], "postgresql:// URL"),
        (["--database-url", "postgresql://localhost/db?options=-c%20x"], "options="),
        (["--database-url", "postgresql://localhost/db", "--requests", "0"], "at least 1"),
    ],
)
def test_main_rejects_arguments_it_cant_use(args, message, capsys) -> None:
    with pytest.raises(SystemExit):
        load.main(args)

    assert message in capsys.readouterr().err


# --- Against Postgres (needs TEST_DATABASE_URL) ---


def test_prices_have_an_index_for_the_latest_price(connection: psycopg.Connection) -> None:
    (definition,) = connection.execute(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'prices_product_latest_idx'"
    ).fetchone()

    assert "(product_id, observed_at DESC, id DESC)" in definition


def load_test_schemas(database_url: str) -> set[str]:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'loadtest\\_%'"
        ).fetchall()
    return {name for (name,) in rows}


def test_a_small_run_answers_every_search_and_cleans_up(db_url: str) -> None:
    base_url = os.environ["TEST_DATABASE_URL"]
    before = load_test_schemas(base_url)

    # The whole script end to end, at the real 50 at once (tests/test_connection_slots.py checks
    # the stall it found, deterministically).
    catalog, report = load.run(base_url, products=300, stores=3, requests=150, concurrency=50)

    assert (catalog.products, catalog.stores, catalog.stock_rows) == (300, 3, 900)
    assert len(report.results) == 150
    assert report.errors == 0
    assert load_test_schemas(base_url) == before  # its schema was dropped


def test_the_schema_is_dropped_even_if_setting_it_up_fails(db_url: str, monkeypatch) -> None:
    base_url = os.environ["TEST_DATABASE_URL"]
    before = load_test_schemas(base_url)
    monkeypatch.setattr(load, "build_catalog", lambda *args: 1 / 0)

    with pytest.raises(ZeroDivisionError):
        load.run(base_url, products=10, stores=1, requests=1, concurrency=1)

    assert load_test_schemas(base_url) == before
