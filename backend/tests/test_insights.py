"""Home's "Popular at your store" and the admin overview counts (app/repositories/insights.py);
database tests skip without TEST_DATABASE_URL.

Uses test_store_staff.py's people and stores. Who may call which endpoint is in
test_permissions_audit.py.
"""

from tests import test_store_staff as store_staff
from tests.test_shopping import add_product, set_stock
from tests.test_store_staff import ADMIN, MANAGER, SHOPPER

# test_store_staff.py's fixtures, so tests here can use them by name.
client, signed_in, stores = store_staff.client, store_staff.signed_in, store_staff.stores


def activity(connection, product_id: int, store_id: int, views: int, scans: int, days_ago=0):
    connection.execute(
        "INSERT INTO product_activity (product_id, store_id, day, views, scans) "
        "VALUES (%s, %s, CURRENT_DATE - %s, %s, %s)",
        (product_id, store_id, days_ago, views, scans),
    )


def test_popular_ranks_a_stores_recent_views_and_scans(client, stores, connection) -> None:
    quantico, lejeune = stores["Quantico MCX"], stores["Camp Lejeune MCX"]
    chips = add_product(connection, "Sample Chips", "036000291452", "3.49")
    cola = add_product(connection, "Cola", "012000001291", None)
    gum = add_product(connection, "Mint Gum", "012000001307", "0.99")
    old = add_product(connection, "Old News", "012000001314", "1.00")
    set_stock(connection, chips, quantico, True, 3)
    connection.execute("UPDATE product_stock SET aisle = 'Aisle 7' WHERE product_id = %s", (chips,))
    activity(connection, chips, quantico, views=4, scans=2)
    activity(connection, cola, quantico, views=9, scans=0)
    activity(connection, gum, lejeune, views=50, scans=50)  # another store's
    activity(connection, old, quantico, views=99, scans=0, days_ago=45)  # too long ago
    connection.execute(
        "INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, 4), (%s, %s, 5)",
        (chips, MANAGER.id, chips, SHOPPER.id),
    )
    connection.commit()

    popular = client.get(f"/locations/{quantico}/popular").json()
    top_one = client.get(f"/locations/{quantico}/popular", params={"limit": 1}).json()

    assert [(p["product"]["name"], p["interest"]) for p in popular] == [
        ("Cola", 9),
        ("Sample Chips", 6),
    ]
    assert popular[0]["in_stock"] is None  # no stock record at this store
    assert popular[0]["product"]["price"] is None and popular[0]["rating"] is None
    chips_row = popular[1]
    assert (chips_row["in_stock"], chips_row["quantity"], chips_row["aisle"]) == (
        True,
        3,
        "Aisle 7",
    )
    # Low is the store's reorder point (5 by default), as in the restock list.
    assert (chips_row["low"], popular[0]["low"]) == (True, False)
    assert (chips_row["product"]["price"], chips_row["rating"], chips_row["rating_count"]) == (
        "3.49",
        4.5,
        2,
    )
    assert [p["product"]["name"] for p in top_one] == ["Cola"]


def test_popular_needs_a_real_store(client, stores) -> None:
    assert client.get("/locations/999999/popular").status_code == 404


def test_the_admin_overview_counts_every_store(client, signed_in, stores, connection) -> None:
    quantico, lejeune = stores["Quantico MCX"], stores["Camp Lejeune MCX"]
    chips = add_product(connection, "Sample Chips", "036000291452", "3.49")
    cola = add_product(connection, "Cola", "012000001291", None)
    set_stock(connection, chips, quantico, False, 0)  # out
    set_stock(connection, chips, lejeune, True, 2)  # low (default reorder point is 5)
    set_stock(connection, cola, quantico, True, 40)  # fine
    connection.execute(
        "INSERT INTO reviews (product_id, user_id, title, body) VALUES (%s, %s, 'Good', 'Crunchy')",
        (chips, SHOPPER.id),
    )
    connection.execute(
        "INSERT INTO restock_requests (product_id, store_id, quantity) VALUES (%s, %s, 12)",
        (chips, quantico),
    )
    connection.execute("UPDATE users SET deactivated_at = NOW() WHERE id = %s", (MANAGER.id,))
    connection.commit()
    signed_in.user = ADMIN

    overview = client.get("/admin/overview").json()

    assert overview == {
        "products": 2,
        "users": 4,  # five signed up, one deactivated
        "staff": 0,
        "admins": 1,
        "stores": 2,
        "reviews_today": 1,
        "out_of_stock": 1,
        "low_stock": 1,
        "open_reorders": 1,
    }
