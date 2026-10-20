"""Admin product endpoints against a real database (skipped without TEST_DATABASE_URL).

T087 acceptance: when an admin creates, edits, or deletes a product, the change is saved and
shown in the app. "Shown in the app" is checked through the endpoints the app reads: GET
/products/{id}, GET /products/barcode/{code}, and GET /products/search.
"""

from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.main import create_app
from app.repositories import UserRepository
from tests.factories import add_product, add_user

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
SHOPPER = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email="shopper@example.com")

NEW_PRODUCT = {
    "barcode": "049000418347",
    "name": "Coca-Cola Classic 16.9 oz",
    "size": "16.9 fl oz",
    "description": "Classic Coke.",
    "image_url": "https://example.com/coke.jpg",
    "price": "1.95",
}


class Session:
    """A client for the app on the test database, signed in as `user` (change it to switch)."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.user = ADMIN


@pytest.fixture
def session(db_url: str, connection: psycopg.Connection) -> Iterator[Session]:
    users = UserRepository(connection)
    users.get_or_create(ADMIN.id, ADMIN.email)
    users.update(ADMIN.id, role="admin")
    connection.commit()

    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        session = Session(client)
        app.dependency_overrides[get_token_user] = lambda: session.user
        yield session


@pytest.fixture
def client(session: Session) -> TestClient:
    return session.client


@pytest.fixture
def category_id(connection: psycopg.Connection) -> int:
    (category_id,) = connection.execute(
        "INSERT INTO categories (name, slug) VALUES ('Beverages', 'beverages') RETURNING id"
    ).fetchone()
    connection.commit()
    return category_id


def prices(connection: psycopg.Connection, product_id: int) -> list[tuple]:
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    return connection.execute(
        "SELECT amount::text, source FROM prices WHERE product_id = %s ORDER BY id", (product_id,)
    ).fetchall()


# --- Create ---


def test_created_product_is_saved_and_shown_in_the_app(client, connection, category_id) -> None:
    response = client.post("/admin/products", json={**NEW_PRODUCT, "category_id": category_id})

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Coca-Cola Classic 16.9 oz"
    assert created["price"]["amount"] == "1.95"
    assert created["category"]["name"] == "Beverages"
    # The app finds it every way it looks products up.
    assert client.get(f"/products/{created['id']}").json() == created
    assert client.get("/products/barcode/049000418347").json()["id"] == created["id"]
    found = client.get("/products/search", params={"q": "coca cola"}).json()
    assert [product["id"] for product in found] == [created["id"]]
    assert prices(connection, created["id"]) == [("1.95", "admin")]


def test_product_can_be_created_with_only_a_barcode_and_name(client, connection) -> None:
    response = client.post("/admin/products", json={"barcode": "049000418347", "name": "Coke"})

    assert response.status_code == 201
    body = response.json()
    assert (body["price"], body["category"], body["image_url"]) == (None, None, None)
    assert prices(connection, body["id"]) == []


@pytest.mark.parametrize("barcode", ["036000291452", "0036000291452"])  # same, or with a 0 added
def test_creating_a_product_with_a_taken_barcode_is_409(client, connection, barcode) -> None:
    add_product(connection)  # has barcode 036000291452
    connection.commit()

    response = client.post("/admin/products", json={"barcode": barcode, "name": "Copy"})

    assert response.status_code == 409
    assert response.json()["code"] == "barcode_taken"


def test_creating_with_an_unknown_category_is_422(client) -> None:
    response = client.post("/admin/products", json={**NEW_PRODUCT, "category_id": 999})

    assert response.status_code == 422
    assert response.json()["code"] == "category_not_found"
    assert client.get("/products/barcode/049000418347").status_code == 404


# --- Edit ---


@pytest.fixture
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)  # Sample Chips, 184g, with a photo
    connection.commit()
    return product_id


def test_edited_product_is_saved_and_shown_in_the_app(client, connection, product_id) -> None:
    response = client.patch(
        f"/admin/products/{product_id}", json={"name": "Classic Chips", "price": "2.49"}
    )

    assert response.status_code == 200
    shown = client.get(f"/products/{product_id}").json()
    assert shown == response.json()
    assert (shown["name"], shown["price"]["amount"]) == ("Classic Chips", "2.49")
    assert shown["size"] == "184g"  # not sent, so unchanged
    assert shown["updated_at"] > shown["created_at"]


def test_new_price_becomes_current_and_old_prices_are_kept(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"price": "2.49"})
    client.patch(f"/admin/products/{product_id}", json={"price": "2.99"})

    assert client.get(f"/products/{product_id}").json()["price"]["amount"] == "2.99"
    assert prices(connection, product_id) == [("2.49", "admin"), ("2.99", "admin")]


def test_null_clears_optional_fields(client, product_id) -> None:
    response = client.patch(f"/admin/products/{product_id}", json={"size": None, "image_url": None})

    assert (response.json()["size"], response.json()["image_url"]) == (None, None)


def test_editing_the_category_and_barcode(client, product_id, category_id) -> None:
    response = client.patch(
        f"/admin/products/{product_id}",
        json={"category_id": category_id, "barcode": "012000171741"},
    )

    assert response.json()["category"]["name"] == "Beverages"
    assert client.get("/products/barcode/012000171741").json()["id"] == product_id
    assert client.get("/products/barcode/036000291452").status_code == 404


def test_keeping_a_products_own_barcode_is_fine(client, product_id) -> None:
    response = client.patch(f"/admin/products/{product_id}", json={"barcode": "0036000291452"})

    assert response.status_code == 200


def test_changing_to_another_products_barcode_is_409(client, connection, product_id) -> None:
    add_product(connection, barcode="012000171741")
    connection.commit()

    response = client.patch(f"/admin/products/{product_id}", json={"barcode": "012000171741"})

    assert response.status_code == 409
    assert client.get(f"/products/{product_id}").json()["barcode"] == "036000291452"


def test_editing_with_an_unknown_category_is_422(client, product_id) -> None:
    response = client.patch(f"/admin/products/{product_id}", json={"category_id": 999})

    assert response.status_code == 422
    assert response.json()["code"] == "category_not_found"


@pytest.mark.parametrize("unknown_id", [999, 2**31])
def test_editing_an_unknown_product_is_404(client, unknown_id) -> None:
    response = client.patch(f"/admin/products/{unknown_id}", json={"name": "Nothing"})

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"


# --- Delete ---


def test_deleted_product_is_gone_from_the_app(client, connection, product_id) -> None:
    connection.execute(
        "INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, 4)",
        (product_id, add_user(connection)),
    )
    connection.commit()

    response = client.delete(f"/admin/products/{product_id}")

    assert response.status_code == 204
    assert client.get(f"/products/{product_id}").status_code == 404
    assert client.get("/products/barcode/036000291452").status_code == 404
    assert client.get("/products/search", params={"q": "sample chips"}).json() == []
    connection.commit()
    assert connection.execute("SELECT count(*) FROM ratings").fetchone() == (0,)


def test_deleting_an_unknown_product_is_404(client) -> None:
    assert client.delete("/admin/products/999").status_code == 404


# --- Only admins ---


def test_regular_users_cant_change_products(session, connection, product_id) -> None:
    session.user = SHOPPER
    client = session.client

    assert client.post("/admin/products", json=NEW_PRODUCT).status_code == 403
    assert client.patch(f"/admin/products/{product_id}", json={"name": "X"}).status_code == 403
    assert client.delete(f"/admin/products/{product_id}").status_code == 403
    product = client.get(f"/products/{product_id}").json()
    assert product["name"] == "Sample Chips"
    assert client.get("/products/barcode/049000418347").status_code == 404


def test_demoted_admin_loses_product_access_on_their_next_request(
    session, connection, product_id
) -> None:
    # T088: the role is read from the database on every request, not from the sign-in token, so
    # an admin who is demoted can't keep using a token they already have.
    client = session.client
    renamed = client.patch(f"/admin/products/{product_id}", json={"name": "Renamed"})
    assert renamed.status_code == 200

    connection.execute("UPDATE users SET role = 'user' WHERE id = %s", (ADMIN.id,))
    connection.commit()

    assert client.delete(f"/admin/products/{product_id}").status_code == 403
    assert client.get(f"/products/{product_id}").json()["name"] == "Renamed"
