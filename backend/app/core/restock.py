"""Restock statistics (migration 020): how often a product runs out at a store, how fast it sells,
and how much to reorder. Pure functions over a product's stock history, so they're easy to test;
app/repositories/restock.py loads the history and app/api/restock.py puts it together.

There's no sales data, so sales are estimated from drops in quantity between stock updates: a
product that goes from 20 to 12 sold about 8. Restocks (quantity going up) aren't sales.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

# How far back the history is read, and the shorter window most stats use.
HISTORY_DAYS = 90
RECENT_DAYS = 30
# A suggested order covers this many days of sales, on top of the reorder point.
COVER_DAYS = 14
# Running out this many times in RECENT_DAYS means "keeps running out".
FREQUENT_STOCKOUTS = 2
# How much more to suggest than last time for a product that's popular or keeps running out.
GROWTH = 1.5


@dataclass(frozen=True)
class StockEvent:
    """One change to a product's stock at a store (a stock_events row)."""

    changed_at: datetime
    in_stock: bool
    quantity: int | None


@dataclass(frozen=True)
class HistoryStats:
    stockouts_30d: int
    stockouts_90d: int
    days_out_30d: float
    sold_per_day: float | None


def history_stats(events: list[StockEvent], now: datetime) -> HistoryStats:
    """Stats from a product's stock events at one store, oldest first. The events may start
    before the 90-day window (the state it started in); later ones count from when they
    happened."""
    recent_start = now - timedelta(days=RECENT_DAYS)
    history_start = now - timedelta(days=HISTORY_DAYS)

    stockouts_30d = stockouts_90d = 0
    sold = 0
    knew_quantities = False
    out_seconds = in_seconds = 0.0
    previous: StockEvent | None = None
    for index, event in enumerate(events):
        if previous is not None and previous.in_stock and not event.in_stock:
            stockouts_90d += event.changed_at >= history_start
            stockouts_30d += event.changed_at >= recent_start
        if previous is not None and event.changed_at >= recent_start:
            before = previous.quantity if previous.in_stock else 0
            # Out of stock with no count means none left.
            after = event.quantity if event.in_stock else (event.quantity or 0)
            if before is not None and after is not None:
                knew_quantities = True
                sold += max(before - after, 0)

        # How long this state lasted inside the recent window.
        ends = events[index + 1].changed_at if index + 1 < len(events) else now
        seconds = (min(ends, now) - max(event.changed_at, recent_start)).total_seconds()
        if seconds > 0:
            if event.in_stock:
                in_seconds += seconds
            else:
                out_seconds += seconds
        previous = event

    sold_per_day = None
    if knew_quantities:
        # Only days it was on the shelf could have had sales; at least one, so a quick sell-out
        # doesn't look endless.
        in_days = max(in_seconds / 86_400, 1.0)
        sold_per_day = round(sold / in_days, 1)
    return HistoryStats(
        stockouts_30d=stockouts_30d,
        stockouts_90d=stockouts_90d,
        days_out_30d=round(out_seconds / 86_400, 1),
        sold_per_day=sold_per_day,
    )


def days_left(in_stock: bool, quantity: int | None, sold_per_day: float | None) -> float | None:
    """Days until it runs out at the current rate, when that can be told."""
    if not in_stock or quantity is None or not sold_per_day:
        return None
    return round(quantity / sold_per_day, 1)


def interest_change(recent: int, before: int | None) -> float | None:
    """% change in views and scans against the period before; None without earlier interest."""
    if not before:
        return None
    return round((recent - before) / before * 100, 1)


def suggestion(
    *,
    quantity: int | None,
    reorder_point: int,
    sold_per_day: float | None,
    last_quantity: int | None,
    popular: bool,
    stockouts_30d: int,
    days_left: float | None,
) -> tuple[int | None, str | None]:
    """How many to reorder, and a sentence saying why when there's something worth saying."""
    suggested: int | None = None
    if sold_per_day:
        on_hand = quantity or 0
        suggested = math.ceil(sold_per_day * COVER_DAYS) + reorder_point - on_hand
    elif last_quantity:
        suggested = last_quantity

    keeps_running_out = stockouts_30d >= FREQUENT_STOCKOUTS
    if last_quantity and (popular or keeps_running_out):
        suggested = max(suggested or 0, math.ceil(last_quantity * GROWTH))
    if suggested is not None:
        suggested = max(suggested, 1)

    reasons = []
    if popular:
        reasons.append("Popular")
    if keeps_running_out:
        reasons.append(f"ran out {stockouts_30d} times in 30 days")
    if reasons:
        why = " and ".join(reasons)
        why = why[0].upper() + why[1:]
        if last_quantity and suggested and suggested > last_quantity:
            return suggested, f"{why}: order more than last time ({last_quantity})."
        return suggested, f"{why}: consider ordering extra."
    if days_left is not None and sold_per_day and days_left < 3:
        days = "day" if days_left == 1 else "days"
        return suggested, f"Sells about {sold_per_day:g} a day, so about {days_left:g} {days} left."
    return suggested, None
