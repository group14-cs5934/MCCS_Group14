"""Saved products, the cart, and the demo checkout (migration 021, app/api/shopping.py); database
tests skip without TEST_DATABASE_URL.

Uses test_store_staff.py's people and stores (Quantico MCX and Camp Lejeune MCX). Who may call
which endpoint is in test_permissions_audit.py.
"""

import pytest

from app.api.shopping import availability
from app.repositories.shopping import ShoppingRepository, StockLevel
from tests import test_store_staff as store_staff
from tests.test_store_staff import OTHER, SHOPPER

# test_store_staff.py's fixtures, so tests here can use them by name.
client, signed_in, stores = store_staff.client, store_staff.signed_in, store_staff.stores


# --- Whether a store can fill a line (no database) ---


@pytest.mark.parametrize(
    ("level", "wanted", "expected"),
    [
        (None, 1, ("unavailable", None)),  # the store doesn't carry it
        (StockLevel(False, 0), 1, ("unavailable", None)),
        (StockLevel(True, 2), 3, ("limited", 2)),
        (StockLevel(True, 3), 3, ("available", None)),
        (StockLevel(True, None), 50, ("available", None)),  # in stock, count unknown
    ],
)
def test_availability(level, wanted, expected) -> None:
    assert availability(level, wanted) == expected


# --- With a database ---


def add_product(connection, name: str, barcode: str, price: str | None) -> int:
    (product_id,) = connection.execute(
        "INSERT INTO products (barcode, name) VALUES (%s, %s) RETURNING id", (barcode, name)
    ).fetchone()
    if price is not None:
        connection.execute(
            "INSERT INTO prices (product_id, amount, source) VALUES (%s, %s, 'MCCS')",
            (product_id, price),
        )
    return product_id


def set_stock(connection, product_id: int, store_id: int, in_stock: bool, quantity: int | None):
    connection.execute(
        "INSERT INTO product_stock (product_id, store_id, in_stock, quantity) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (product_id, store_id) "
        "DO UPDATE SET in_stock = EXCLUDED.in_stock, quantity = EXCLUDED.quantity",
        (product_id, store_id, in_stock, quantity),
    )


@pytest.fixture
def shop(connection, stores, signed_in) -> dict[str, int]:
    """Chips ($3.49), soda ($1.25), and gum (no price). Quantico has 10 chips, 2 sodas, and no
    gum; Camp Lejeune has plenty of all three. The shopper is signed in."""
    products = {
        "chips": add_product(connection, "Sample Chips", "036000291452", "3.49"),
        "soda": add_product(connection, "Cola", "012000001291", "1.25"),
        "gum": add_product(connection, "Mint Gum", "012000001307", None),
    }
    quantico, lejeune = stores["Quantico MCX"], stores["Camp Lejeune MCX"]
    set_stock(connection, products["chips"], quantico, True, 10)
    set_stock(connection, products["soda"], quantico, True, 2)
    set_stock(connection, products["gum"], quantico, False, 0)
    for product_id in products.values():
        set_stock(connection, product_id, lejeune, True, 50)
    connection.commit()
    signed_in.user = SHOPPER
    return products | stores


def test_saving_and_unsaving_is_per_user_and_idempotent(client, signed_in, shop) -> None:
    chips, soda = shop["chips"], shop["soda"]

    client.put(f"/me/saved/{chips}")
    client.put(f"/me/saved/{soda}")
    again = client.put(f"/me/saved/{chips}")
    mine = client.get("/me/saved").json()
    signed_in.user = OTHER
    theirs = client.get("/me/saved").json()
    not_saved = client.get(f"/me/saved/{chips}")
    signed_in.user = SHOPPER
    client.delete(f"/me/saved/{soda}")
    twice = client.delete(f"/me/saved/{soda}")

    assert again.status_code == 200 and again.json()["product"]["price"] == "3.49"
    assert [s["product"]["name"] for s in mine] == ["Cola", "Sample Chips"]  # newest first
    assert theirs == []
    assert not_saved.status_code == 404 and not_saved.json()["code"] == "not_saved"
    assert twice.status_code == 204
    assert [s["product"]["id"] for s in client.get("/me/saved").json()] == [chips]
    assert client.put("/me/saved/999999").status_code == 404


def test_the_cart_adds_sets_and_totals(client, shop) -> None:
    chips, soda, gum = shop["chips"], shop["soda"], shop["gum"]

    client.post(f"/me/cart/{chips}")
    client.post(f"/me/cart/{chips}", json={"quantity": 2})
    client.put(f"/me/cart/{soda}", json={"quantity": 4})
    cart = client.post(f"/me/cart/{gum}").json()

    assert [(i["product"]["name"], i["quantity"], i["line_total"]) for i in cart["items"]] == [
        ("Sample Chips", 3, "10.47"),
        ("Cola", 4, "5.00"),
        ("Mint Gum", 1, None),
    ]
    assert (cart["item_count"], cart["subtotal"], cart["unpriced_items"]) == (8, "15.47", 1)
    capped = client.post(f"/me/cart/{chips}", json={"quantity": 99}).json()
    assert capped["items"][0]["quantity"] == 99
    assert client.put(f"/me/cart/{chips}", json={"quantity": 0}).status_code == 422
    removed = client.delete(f"/me/cart/{gum}").json()
    assert [i["product"]["name"] for i in removed["items"]] == ["Sample Chips", "Cola"]
    assert client.delete("/me/cart").status_code == 204
    assert client.get("/me/cart").json() == {
        "items": [],
        "item_count": 0,
        "subtotal": None,
        "unpriced_items": 0,
    }


def test_save_for_later_moves_it_from_the_cart(client, shop) -> None:
    chips = shop["chips"]
    client.post(f"/me/cart/{chips}")

    cart = client.post(f"/me/cart/{chips}/save-for-later").json()
    again = client.post(f"/me/cart/{chips}/save-for-later")

    assert cart["items"] == []
    assert [s["product"]["id"] for s in client.get("/me/saved").json()] == [chips]
    assert again.status_code == 404 and again.json()["code"] == "not_in_cart"


def test_the_check_says_what_each_store_can_fill(client, shop) -> None:
    quantico = shop["Quantico MCX"]
    client.post(f"/me/cart/{shop['chips']}", json={"quantity": 3})
    client.post(f"/me/cart/{shop['soda']}", json={"quantity": 4})
    client.post(f"/me/cart/{shop['gum']}")

    check = client.get("/me/cart/check", params={"store_id": quantico}).json()

    assert check["store"]["id"] == quantico and check["all_available"] is False
    assert [
        (i["product"]["name"], i["status"], i["available_quantity"]) for i in check["items"]
    ] == [
        ("Sample Chips", "available", None),
        ("Cola", "limited", 2),
        ("Mint Gum", "unavailable", None),
    ]
    assert [
        (o["store"]["name"], o["available_items"], o["total_items"]) for o in check["stores"]
    ] == [
        ("Camp Lejeune MCX", 3, 3),  # has everything, so it comes first
        ("Quantico MCX", 1, 3),
    ]


def test_the_check_needs_a_cart_and_a_store(client, shop) -> None:
    empty = client.get("/me/cart/check", params={"store_id": shop["Quantico MCX"]})
    client.post(f"/me/cart/{shop['chips']}")
    no_store = client.get("/me/cart/check", params={"store_id": 999_999})

    assert empty.status_code == 409 and empty.json()["code"] == "cart_empty"
    assert no_store.status_code == 404 and no_store.json()["code"] == "store_not_found"


def test_an_order_is_placed_where_everything_is_in_stock(client, signed_in, shop, connection):
    lejeune, quantico = shop["Camp Lejeune MCX"], shop["Quantico MCX"]
    client.post(f"/me/cart/{shop['chips']}", json={"quantity": 3})
    client.post(f"/me/cart/{shop['gum']}")

    refused = client.post("/me/orders", json={"store_id": quantico, "fulfillment": "pickup"})
    placed = client.post(
        "/me/orders",
        json={
            "store_id": lejeune,
            "fulfillment": "delivery",
            "delivery_address": "123 Example St, Jacksonville NC",
            "contact_name": "  ",
        },
    )

    assert refused.status_code == 409 and refused.json()["code"] == "items_unavailable"
    assert placed.status_code == 201
    order = placed.json()
    assert order["number"] == f"R-{1000 + order['id']}"
    assert order["store"] == {"id": lejeune, "name": "Camp Lejeune MCX"}
    assert (order["fulfillment"], order["contact_name"], order["status"]) == (
        "delivery",
        None,
        "placed",
    )
    assert [(i["name"], i["quantity"], i["unit_price"]) for i in order["items"]] == [
        ("Sample Chips", 3, "3.49"),
        ("Mint Gum", 1, None),
    ]
    assert (order["item_count"], order["total"]) == (4, "10.47")
    assert client.get("/me/cart").json()["items"] == []  # the cart is emptied
    stock = connection.execute(
        "SELECT quantity FROM product_stock WHERE product_id = %s AND store_id = %s",
        (shop["chips"], lejeune),
    ).fetchone()
    assert stock == (50,)  # a demo: stock isn't changed
    assert client.get(f"/me/orders/{order['id']}").json() == order
    signed_in.user = OTHER
    assert client.get(f"/me/orders/{order['id']}").status_code == 404  # only your own
    assert client.get("/me/orders").json() == []


def test_placing_an_order_only_takes_out_what_it_ordered(client, shop, connection) -> None:
    """Something added from another device while the order is placed stays in the cart."""
    shopping = ShoppingRepository(connection)
    client.post(f"/me/cart/{shop['chips']}")
    client.post(f"/me/cart/{shop['soda']}")
    ordered = shopping.cart_lines(SHOPPER.id)[:1]

    shopping.empty_cart(SHOPPER.id, [line.product.id for line in ordered])

    assert [line.product.id for line in shopping.cart_lines(SHOPPER.id)] == [shop["soda"]]


def test_order_details_are_checked(client, shop) -> None:
    quantico = shop["Quantico MCX"]

    empty = client.post("/me/orders", json={"store_id": quantico, "fulfillment": "pickup"})
    client.post(f"/me/cart/{shop['chips']}")
    no_address = client.post("/me/orders", json={"store_id": quantico, "fulfillment": "delivery"})
    pickup_address = client.post(
        "/me/orders",
        json={"store_id": quantico, "fulfillment": "pickup", "delivery_address": "1 Main St"},
    )

    assert empty.status_code == 409 and empty.json()["code"] == "cart_empty"
    assert no_address.json()["code"] == "delivery_address_required"
    assert pickup_address.json()["code"] == "delivery_address_not_allowed"


def test_orders_stay_readable_after_the_store_and_product_go(client, shop, connection) -> None:
    lejeune = shop["Camp Lejeune MCX"]
    client.post(f"/me/cart/{shop['soda']}", json={"quantity": 2})
    order = client.post("/me/orders", json={"store_id": lejeune, "fulfillment": "pickup"}).json()
    connection.execute("DELETE FROM products WHERE id = %s", (shop["soda"],))
    connection.execute("DELETE FROM store_locations WHERE id = %s", (lejeune,))
    connection.commit()

    listed = client.get("/me/orders").json()

    assert listed[0]["id"] == order["id"]
    assert listed[0]["store"] == {"id": None, "name": "Camp Lejeune MCX"}
    assert listed[0]["items"] == [
        {"product_id": None, "name": "Cola", "quantity": 2, "unit_price": "1.25"}
    ]
