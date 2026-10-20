"""Rating endpoints against a real database (skipped without TEST_DATABASE_URL).

T053 acceptance: when I submit a rating of 1-5, it is saved; when I submit a rating of 0 or 6, it
is rejected with a 422. T054 acceptance: when a product has ratings of 4 and 2, the API returns
an average of 3.0 and a count of 2. Unit tests that need no database are in
test_ratings_api_unit.py.
"""

from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_product, add_user

ALICE = TokenUser(id=UUID("8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00"), email="alice@example.com")
BOB = TokenUser(id=UUID("c9f0f895-fb98-4ab2-9a3e-4b1b2f0c7a11"), email="bob@example.com")


class SignedIn:
    """A client for the app on the test database, signed in as `user` (change it to switch)."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.user = ALICE


@pytest.fixture
def session(db_url: str) -> Iterator[SignedIn]:
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        session = SignedIn(client)
        app.dependency_overrides[get_token_user] = lambda: session.user
        yield session


@pytest.fixture
def client(session: SignedIn) -> TestClient:
    return session.client


@pytest.fixture
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)
    connection.commit()
    return product_id


def stored(connection: psycopg.Connection) -> list[tuple]:
    """Every stored rating as (product_id, user_id, stars)."""
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    return connection.execute(
        "SELECT product_id, user_id, stars FROM ratings ORDER BY user_id"
    ).fetchall()


@pytest.mark.parametrize("stars", [1, 5])
def test_rating_is_saved_for_the_signed_in_user(client, connection, product_id, stars) -> None:
    response = client.post(f"/products/{product_id}/ratings", json={"stars": stars})

    assert response.status_code == 200
    assert response.json()["stars"] == stars
    assert stored(connection) == [(product_id, ALICE.id, stars)]


def test_first_rating_adds_the_users_record(client, connection, product_id) -> None:
    # The ratings table links to users, so the user's row must exist; signing in adds it.
    client.post(f"/products/{product_id}/ratings", json={"stars": 4})

    connection.commit()
    assert connection.execute("SELECT id FROM users").fetchall() == [(ALICE.id,)]


@pytest.mark.parametrize("stars", [0, 6])
def test_rating_of_zero_or_six_is_rejected_and_not_saved(
    client, connection, product_id, stars
) -> None:
    response = client.post(f"/products/{product_id}/ratings", json={"stars": stars})

    assert response.status_code == 422
    assert stored(connection) == []


def test_rating_again_updates_the_one_rating(client, connection, product_id) -> None:
    first = client.post(f"/products/{product_id}/ratings", json={"stars": 2}).json()
    second = client.post(f"/products/{product_id}/ratings", json={"stars": 5}).json()

    assert stored(connection) == [(product_id, ALICE.id, 5)]
    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] >= first["updated_at"]


def test_each_user_has_their_own_rating(session, connection, product_id) -> None:
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 2})
    session.user = BOB
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 5})

    assert stored(connection) == [(product_id, ALICE.id, 2), (product_id, BOB.id, 5)]
    assert session.client.get(f"/products/{product_id}/ratings/me").json()["stars"] == 5
    session.user = ALICE
    assert session.client.get(f"/products/{product_id}/ratings/me").json()["stars"] == 2


@pytest.mark.parametrize("unknown_id", [999, 2**31])  # 2**31 is past Postgres's INTEGER max
def test_rating_an_unknown_product_is_404(client, connection, product_id, unknown_id) -> None:
    response = client.post(f"/products/{unknown_id}/ratings", json={"stars": 4})

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"
    assert stored(connection) == []


def test_my_rating_is_404_until_i_rate(client, product_id) -> None:
    assert client.get(f"/products/{product_id}/ratings/me").status_code == 404

    client.post(f"/products/{product_id}/ratings", json={"stars": 3})

    response = client.get(f"/products/{product_id}/ratings/me")
    assert response.status_code == 200
    assert (response.json()["product_id"], response.json()["stars"]) == (product_id, 3)


def add_ratings(connection: psycopg.Connection, product_id: int, *stars: int) -> None:
    """Each of these ratings of the product comes from a different (new) user."""
    for count in stars:
        connection.execute(
            "INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, %s)",
            (product_id, add_user(connection), count),
        )
    connection.commit()


def test_ratings_of_4_and_2_average_3_with_a_count_of_2(session, product_id) -> None:
    # Rated through the API by two users.
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 4})
    session.user = BOB
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 2})

    response = session.client.get(f"/products/{product_id}/ratings")

    assert response.status_code == 200
    assert response.json() == {"product_id": product_id, "average": 3.0, "count": 2}


@pytest.mark.parametrize(
    ("stars", "average"),
    [
        ([5], 5.0),
        ([4, 4, 5], 4.33),  # rounded to 2 decimal places
        ([1, 2, 2], 1.67),
        ([1, 2, 3, 4, 5], 3.0),
    ],
)
def test_average_is_the_mean_rounded_to_2_places(
    client, connection, product_id, stars, average
) -> None:
    add_ratings(connection, product_id, *stars)

    summary = client.get(f"/products/{product_id}/ratings").json()

    assert (summary["average"], summary["count"]) == (average, len(stars))


def test_product_nobody_rated_has_no_average(client, product_id) -> None:
    response = client.get(f"/products/{product_id}/ratings")

    assert response.json() == {"product_id": product_id, "average": None, "count": 0}


def test_only_this_products_ratings_count(client, connection, product_id) -> None:
    other_id = add_product(connection, barcode="012000171741")
    add_ratings(connection, product_id, 4, 2)
    add_ratings(connection, other_id, 1, 1, 1)

    summary = client.get(f"/products/{product_id}/ratings").json()

    assert (summary["average"], summary["count"]) == (3.0, 2)


def test_changing_my_rating_changes_the_average(client, connection, product_id) -> None:
    add_ratings(connection, product_id, 4)
    client.post(f"/products/{product_id}/ratings", json={"stars": 2})
    client.post(f"/products/{product_id}/ratings", json={"stars": 4})  # changed my mind

    summary = client.get(f"/products/{product_id}/ratings").json()

    assert (summary["average"], summary["count"]) == (4.0, 2)


@pytest.mark.parametrize("unknown_id", [999, 2**31])
def test_summary_of_an_unknown_product_is_404(client, product_id, unknown_id) -> None:
    response = client.get(f"/products/{unknown_id}/ratings")

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"


def test_removing_my_rating_takes_it_out_of_the_average(session, connection, product_id) -> None:
    add_ratings(connection, product_id, 2)
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 4})

    response = session.client.delete(f"/products/{product_id}/ratings/me")

    assert response.status_code == 204
    summary = session.client.get(f"/products/{product_id}/ratings").json()
    assert (summary["average"], summary["count"]) == (2.0, 1)
    assert ALICE.id not in [user_id for _, user_id, _ in stored(connection)]


def test_removing_only_removes_my_own_rating(session, connection, product_id) -> None:
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 2})
    session.user = BOB

    response = session.client.delete(f"/products/{product_id}/ratings/me")

    assert response.status_code == 404  # Bob never rated it
    assert stored(connection) == [(product_id, ALICE.id, 2)]


def test_can_rate_again_after_removing(client, connection, product_id) -> None:
    client.post(f"/products/{product_id}/ratings", json={"stars": 2})
    client.delete(f"/products/{product_id}/ratings/me")

    client.post(f"/products/{product_id}/ratings", json={"stars": 5})

    assert stored(connection) == [(product_id, ALICE.id, 5)]
