"""Restock statistics (app/core/restock.py): how often a product runs out, how fast it sells, and
what to reorder. No database needed."""

from datetime import UTC, datetime, timedelta

from app.core.restock import StockEvent, days_left, history_stats, interest_change, suggestion

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)


def days_ago(days: float, in_stock: bool, quantity: int | None) -> StockEvent:
    return StockEvent(NOW - timedelta(days=days), in_stock, quantity)


def test_no_history_means_nothing_known() -> None:
    found = history_stats([], NOW)

    assert (found.stockouts_30d, found.stockouts_90d, found.days_out_30d) == (0, 0, 0)
    assert found.sold_per_day is None


def test_stockouts_count_running_out_not_starting_out() -> None:
    events = [
        days_ago(100, False, None),  # started out of stock, before the window: not a stockout
        days_ago(80, True, 10),
        days_ago(60, False, 0),  # ran out (in the 90 days)
        days_ago(50, True, 10),
        days_ago(20, False, 0),  # ran out (in the 30 days)
        days_ago(15, True, 10),
        days_ago(5, False, 0),  # and again
    ]

    found = history_stats(events, NOW)

    assert (found.stockouts_30d, found.stockouts_90d) == (2, 3)
    assert found.days_out_30d == 10.0  # 5 days (20 to 15 ago) plus the last 5


def test_sales_are_the_drops_in_quantity_per_day_on_the_shelf() -> None:
    events = [
        days_ago(40, True, 30),  # the state the 30 days start in
        days_ago(25, True, 20),  # sold 10
        days_ago(20, True, 50),  # restocked: not sales
        days_ago(10, False, None),  # sold out: 50 more
        days_ago(5, True, 40),
    ]

    found = history_stats(events, NOW)

    # 60 sold over the 25 days it was on the shelf (out from 10 to 5 days ago).
    assert found.sold_per_day == 2.4
    assert found.days_out_30d == 5.0


def test_unknown_quantities_give_no_sales_rate() -> None:
    events = [days_ago(20, True, None), days_ago(10, False, None), days_ago(5, True, None)]

    assert history_stats(events, NOW).sold_per_day is None


def test_days_left_needs_stock_a_quantity_and_sales() -> None:
    assert days_left(True, 6, 2.0) == 3.0
    assert days_left(False, 0, 2.0) is None
    assert days_left(True, None, 2.0) is None
    assert days_left(True, 6, 0.0) is None


def test_interest_change_against_the_30_days_before() -> None:
    assert interest_change(30, 20) == 50.0
    assert interest_change(10, 20) == -50.0
    assert interest_change(10, None) is None
    assert interest_change(10, 0) is None


def suggest(**overrides):
    values = {
        "quantity": 2,
        "reorder_point": 5,
        "sold_per_day": None,
        "last_quantity": None,
        "popular": False,
        "stockouts_30d": 0,
        "days_left": None,
    }
    return suggestion(**(values | overrides))


def test_a_suggestion_covers_two_weeks_of_sales_plus_the_reorder_point() -> None:
    # 3 a day for 14 days, plus 5, less the 2 on hand.
    assert suggest(sold_per_day=3.0) == (45, None)


def test_without_sales_the_last_order_is_suggested_again() -> None:
    assert suggest(last_quantity=24) == (24, None)
    assert suggest() == (None, None)


def test_popular_products_that_keep_running_out_get_more_than_last_time() -> None:
    suggested, advice = suggest(last_quantity=24, popular=True, stockouts_30d=3)

    assert suggested == 36
    assert advice == "Popular and ran out 3 times in 30 days: order more than last time (24)."


def test_running_out_often_without_an_earlier_order_suggests_extra() -> None:
    suggested, advice = suggest(sold_per_day=1.0, stockouts_30d=2)

    assert suggested == 17
    assert advice == "Ran out 2 times in 30 days: consider ordering extra."


def test_nearly_sold_out_says_how_long_is_left() -> None:
    assert (
        suggest(sold_per_day=2.0, days_left=1.0)[1] == "Sells about 2 a day, so about 1 day left."
    )
    assert suggest(sold_per_day=2.0, days_left=2.5)[1] == (
        "Sells about 2 a day, so about 2.5 days left."
    )
