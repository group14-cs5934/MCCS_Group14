"""
Build products.yaml for the product monitor from backend/scripts/demo_products.csv.

Writes one entry per CSV product for one store (the MCCS online store by default). The CSV has
no product page URLs, so new entries get a null url, marked TODO, and the monitor skips them
until it's filled in. The monitor reads each barcode off the product page, so barcode can stay
null. Running this again keeps every url and barcode already filled in, and any entries added
by hand.

Usage:
  uv run make_products_yaml.py
  uv run make_products_yaml.py --store mcx-online --csv path/to/products.csv --out products.yaml
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
DEFAULT_CSV = HERE.parent.parent / "backend" / "scripts" / "demo_products.csv"
DEFAULT_OUT = HERE / "products.yaml"
# store_locations.slug of the MCCS online store.
DEFAULT_STORE = "mcx-online"
# Sizes that add nothing to the name, e.g. "1 unit", "1 deck".
SINGLE_ITEM = re.compile(r"1 [a-z]+")

HEADER = """\
# Products the monitor checks. Made by make_products_yaml.py; safe to edit by hand.
# store must be a store_locations.slug. Entries with a null url are skipped until it's filled in.
# barcode is read off the product page; set it (quoted) only to make the page match it."""


def product_name(row: dict[str, str]) -> str:
    """The CSV name plus its size, so Claude can tell e.g. a single can from a 12-pack."""
    name = " ".join(row["name"].split())
    size = " ".join((row.get("size") or "").split())
    return f"{name} ({size})" if size and not SINGLE_ITEM.fullmatch(size) else name


def load_existing(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return raw.get("products") or []


def scalar(value: Any) -> str:
    """value as YAML: JSON strings are valid YAML, and quoting keeps barcodes as strings."""
    return "null" if value is None else json.dumps(value, ensure_ascii=False)


def render(entries: list[dict[str, Any]]) -> str:
    lines = [HEADER, "products:"]
    for entry in entries:
        lines.append(f"  - name: {scalar(entry.get('name'))}")
        lines.append(f"    store: {scalar(entry.get('store'))}")
        todo = "" if entry.get("url") else "  # TODO"
        lines.append(f"    url: {scalar(entry.get('url'))}{todo}")
        optional = "" if entry.get("barcode") else "  # optional"
        lines.append(f"    barcode: {scalar(entry.get('barcode'))}{optional}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="products CSV to read")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="YAML file to write")
    parser.add_argument("--store", default=DEFAULT_STORE, help="store_locations.slug to use")
    args = parser.parse_args()

    with args.csv.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    # Keyed by (name, store), so filled-in barcodes and urls survive a rerun.
    existing = {(e.get("name"), e.get("store")): e for e in load_existing(args.out)}
    entries = []
    for row in rows:
        name = product_name(row)
        old = existing.pop((name, args.store), {})
        barcode, url = old.get("barcode"), old.get("url")
        entries.append({"name": name, "store": args.store, "barcode": barcode, "url": url})
    entries.extend(existing.values())  # entries added by hand, or for other stores

    args.out.write_text(render(entries), encoding="utf-8", newline="\n")
    todo = sum(1 for e in entries if not e.get("url"))
    print(f"Wrote {len(entries)} entries to {args.out} ({todo} still need a url)")


if __name__ == "__main__":
    main()
