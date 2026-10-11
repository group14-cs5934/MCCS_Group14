"""T022: Discover and verify real products using UPCitemdb."""

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://api.upcitemdb.com/prod/trial"
SEARCH_URL = f"{BASE_URL}/search"
LOOKUP_URL = f"{BASE_URL}/lookup"

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPT_DIR / "sample_products.json"
HISTORY_FILE = SCRIPT_DIR / "lookup_history.json"

TARGET_COUNT = 50
REQUEST_DELAY = 2

# Safety limit for API calls per run.
# This is not a guarantee of UPCitemdb's actual quota.
MAX_REQUESTS_PER_RUN = 60

# Diverse discovery queries, used only to find real barcodes.
# They are NOT part of the mobile app's scanning workflow.
SEARCH_CATEGORIES = {
    "Food": ["pasta", "cereal", "chocolate"],
    "Beverages": ["juice", "coffee", "tea"],
    "Personal Care": ["shampoo", "toothpaste", "deodorant"],
    "Household": ["detergent", "dish soap", "paper towels"],
    "Electronics": ["headphones", "mouse", "charger"],
    "Kitchen": ["knife", "spatula", "mug"],
    "Office": ["notebook", "pen", "tape"],
    "Pet Supplies": ["dog food", "cat treats", "pet shampoo"],
}

# Already verified or previously discovered barcodes.
SEED_BARCODES = [
    "4002293401102",
    "012000001291",
    "012000100109",
    "012000171741",
    "012000171864",
    "012000171956",
    "798235678735",
    "049000418347",
]


def load_json(path, default):
    if not path.exists():
        return default

    with open(path, encoding="utf-8") as file:
        return json.load(file)


def save_json(path, data):
    temporary = path.with_suffix(".tmp")

    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)

    temporary.replace(path)


def request_api(endpoint, payload):
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "MCCS-Group14-T022/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def fetch_product(barcode):
    """Verify a product using UPCitemdb Barcode Lookup."""
    return request_api(LOOKUP_URL, {"upc": barcode})


def search_products(keyword):
    """Discover real product barcodes from UPCitemdb."""
    return request_api(SEARCH_URL, {"s": keyword})


def get_product_barcode(product):
    return str(product.get("upc") or product.get("ean") or "").strip()


def main():
    print("\n========== T022 PRODUCT COLLECTION ==========\n")

    products = load_json(OUTPUT_FILE, [])
    history = load_json(HISTORY_FILE, {})

    if not isinstance(products, list):
        raise ValueError("sample_products.json must contain a list.")

    if not isinstance(history, dict):
        raise ValueError("lookup_history.json must contain an object.")

    # Preserve and deduplicate existing products.
    unique_products = {}

    for product in products:
        barcode = get_product_barcode(product)

        if barcode and product.get("title"):
            unique_products[barcode] = product

    products = list(unique_products.values())
    existing_barcodes = set(unique_products)

    for barcode in existing_barcodes:
        history[barcode] = "found"

    print(f"Previously saved: {len(products)}")
    print(f"Target: {TARGET_COUNT}")
    print(f"Remaining: {max(0, TARGET_COUNT - len(products))}")

    requests_made = 0
    new_products = 0
    discovered_barcodes = list(SEED_BARCODES)
    discovered_set = set(discovered_barcodes)

    # Step 1: Discover barcodes across multiple categories.
    print("\n--- STEP 1: DISCOVER REAL BARCODES ---\n")

    stop = False

    for category, keywords in SEARCH_CATEGORIES.items():
        if stop:
            break

        print(f"\nCategory: {category}")

        for keyword in keywords:
            if requests_made >= MAX_REQUESTS_PER_RUN:
                print("Request safety limit reached.")
                stop = True
                break

            print(f"  Searching: {keyword}")

            try:
                data = search_products(keyword)
                requests_made += 1

                if data.get("code") != "OK":
                    print(f"  API response: {data.get('code')}")
                    stop = True
                    break

                items = data.get("items", [])
                added = 0

                for item in items:
                    barcode = get_product_barcode(item)

                    if not barcode:
                        continue

                    if barcode in discovered_set:
                        continue

                    if barcode in existing_barcodes:
                        continue

                    if history.get(barcode) == "not_found":
                        continue

                    discovered_barcodes.append(barcode)
                    discovered_set.add(barcode)
                    added += 1

                print(f"  Discovered {added} new barcodes")

            except urllib.error.HTTPError as error:
                requests_made += 1
                print(f"  HTTP error: {error.code}")
                stop = True
                break

            except (
                urllib.error.URLError,
                TimeoutError,
                ValueError,
            ) as error:
                print(f"  Request failed: {error}")
                stop = True
                break

            time.sleep(REQUEST_DELAY)

    print(f"\nTotal candidate barcodes: {len(discovered_barcodes)}")

    # Step 2: Verify each barcode through Lookup.
    print("\n--- STEP 2: VERIFY USING BARCODE LOOKUP ---\n")

    for index, barcode in enumerate(discovered_barcodes, start=1):
        if len(products) >= TARGET_COUNT:
            print("\nTarget reached!")
            break

        if requests_made >= MAX_REQUESTS_PER_RUN:
            print("\nRequest safety limit reached.")
            break

        if barcode in existing_barcodes:
            continue

        if history.get(barcode) in ("found", "not_found"):
            continue

        print(f"[{index}] Lookup: {barcode}")

        try:
            data = fetch_product(barcode)
            requests_made += 1

            if data.get("code") != "OK":
                print(f"  API response: {data.get('code')}")
                break

            items = data.get("items", [])

            if not items:
                print("  Not found")
                history[barcode] = "not_found"
                save_json(HISTORY_FILE, history)
                continue

            found = False

            for item in items:
                product_barcode = get_product_barcode(item)
                title = item.get("title")

                if not product_barcode or not title:
                    continue

                found = True

                if product_barcode in existing_barcodes:
                    continue

                products.append(item)
                existing_barcodes.add(product_barcode)
                new_products += 1

                print(f"  VERIFIED: {title}")
                print(f"  Progress: {len(products)}/{TARGET_COUNT}")

                save_json(OUTPUT_FILE, products)

                if len(products) >= TARGET_COUNT:
                    break

            history[barcode] = "found" if found else "not_found"
            save_json(HISTORY_FILE, history)

        except urllib.error.HTTPError as error:
            requests_made += 1
            print(f"  HTTP error: {error.code}")

            if error.code == 429:
                print("  Rate limit reached.")
            break

        except (
            urllib.error.URLError,
            TimeoutError,
            ValueError,
        ) as error:
            print(f"  Lookup failed: {error}")
            break

        time.sleep(REQUEST_DELAY)

    # Step 3: Save and summarize.
    save_json(OUTPUT_FILE, products)
    save_json(HISTORY_FILE, history)

    print("\n========== T022 SUMMARY ==========")
    print(f"Total products: {len(products)}")
    print(f"New products this run: {new_products}")
    print(f"API requests this run: {requests_made}")
    print(f"Target: {TARGET_COUNT}")
    print(f"Remaining: {max(0, TARGET_COUNT - len(products))}")
    print(f"Saved to: {OUTPUT_FILE}")
    print("==================================")

    if len(products) >= TARGET_COUNT:
        print("\nSUCCESS: T022 target reached!")
    else:
        print("\nTarget not reached. Run again when API quota allows.")


if __name__ == "__main__":
    main()
