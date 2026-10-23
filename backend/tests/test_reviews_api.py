"""Review endpoints against a real database (skipped without TEST_DATABASE_URL).

T059 acceptance: when a signed-in user posts a valid review, it is saved and returned. T060
acceptance: when a product has 25 reviews, they are returned 10 per page, newest first. T072:
each review is linked to the account that wrote it. Sign-in checks with real tokens are in
test_review_rating_access.py.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
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

REVIEW = {"title": "Great for road trips", "body": "Crunchy and not too salty."}


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
    """Every stored review as (product_id, user_id, title, body)."""
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    return connection.execute(
        "SELECT product_id, user_id, title, body FROM reviews ORDER BY user_id"
    ).fetchall()


def test_valid_review_is_saved_and_returned(client, connection, product_id) -> None:
    response = client.post(f"/products/{product_id}/reviews", json=REVIEW)

    assert response.status_code == 200
    body = response.json()
    assert body["product_id"] == product_id
    assert (body["title"], body["body"]) == (REVIEW["title"], REVIEW["body"])
    assert body["author"] == "a***"
    assert body["stars"] is None  # Alice hasn't rated it
    assert stored(connection) == [(product_id, ALICE.id, REVIEW["title"], REVIEW["body"])]


def test_review_without_a_title_is_saved(client, connection, product_id) -> None:
    response = client.post(f"/products/{product_id}/reviews", json={"body": "Pretty good."})

    assert response.status_code == 200
    assert response.json()["title"] is None
    assert stored(connection) == [(product_id, ALICE.id, None, "Pretty good.")]


def test_review_shows_the_authors_rating(client, product_id) -> None:
    client.post(f"/products/{product_id}/ratings", json={"stars": 4})

    response = client.post(f"/products/{product_id}/reviews", json=REVIEW)

    assert response.json()["stars"] == 4


def test_reviewing_again_replaces_my_review(client, connection, product_id) -> None:
    first = client.post(f"/products/{product_id}/reviews", json=REVIEW).json()
    second = client.post(
        f"/products/{product_id}/reviews", json={"body": "Changed my mind."}
    ).json()

    assert stored(connection) == [(product_id, ALICE.id, None, "Changed my mind.")]
    assert second["id"] == first["id"]
    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] >= first["updated_at"]


def test_each_user_has_their_own_review(session, connection, product_id) -> None:
    session.client.post(f"/products/{product_id}/reviews", json={"body": "Alice's review."})
    session.user = BOB
    session.client.post(f"/products/{product_id}/reviews", json={"body": "Bob's review."})

    assert stored(connection) == [
        (product_id, ALICE.id, None, "Alice's review."),
        (product_id, BOB.id, None, "Bob's review."),
    ]


@pytest.mark.parametrize("body", ["", "   ", "a" * 2001])
def test_empty_or_too_long_review_is_rejected_and_not_saved(
    client, connection, product_id, body
) -> None:
    response = client.post(f"/products/{product_id}/reviews", json={"body": body})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert stored(connection) == []


@pytest.mark.parametrize("unknown_id", [999, 2**31])  # 2**31 is past Postgres's INTEGER max
def test_reviewing_an_unknown_product_is_404(client, connection, product_id, unknown_id) -> None:
    response = client.post(f"/products/{unknown_id}/reviews", json=REVIEW)

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"
    assert stored(connection) == []


def add_reviews(connection: psycopg.Connection, product_id: int, count: int) -> None:
    """`count` reviews of the product by different users: "Review 1" is the oldest, one minute
    apart."""
    start = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    for number in range(1, count + 1):
        connection.execute(
            "INSERT INTO reviews (product_id, user_id, body, created_at) VALUES (%s, %s, %s, %s)",
            (
                product_id,
                add_user(connection),
                f"Review {number}",
                start + timedelta(minutes=number),
            ),
        )
    connection.commit()


def bodies(page: dict) -> list[str]:
    return [review["body"] for review in page["items"]]


def test_25_reviews_come_10_per_page_newest_first(client, connection, product_id) -> None:
    add_reviews(connection, product_id, 25)

    pages = [
        client.get(f"/products/{product_id}/reviews", params={"offset": offset}).json()
        for offset in (0, 10, 20)
    ]

    assert bodies(pages[0]) == [f"Review {n}" for n in range(25, 15, -1)]
    assert bodies(pages[1]) == [f"Review {n}" for n in range(15, 5, -1)]
    assert bodies(pages[2]) == [f"Review {n}" for n in range(5, 0, -1)]
    assert [(p["total"], p["limit"], p["offset"]) for p in pages] == [
        (25, 10, 0),
        (25, 10, 10),
        (25, 10, 20),
    ]


def test_page_past_the_end_is_empty(client, connection, product_id) -> None:
    add_reviews(connection, product_id, 3)

    page = client.get(f"/products/{product_id}/reviews", params={"offset": 10}).json()

    assert page == {"items": [], "total": 3, "limit": 10, "offset": 10}


def test_page_size_can_be_changed(client, connection, product_id) -> None:
    add_reviews(connection, product_id, 5)

    page = client.get(f"/products/{product_id}/reviews", params={"limit": 2}).json()

    assert bodies(page) == ["Review 5", "Review 4"]


def test_reviews_posted_at_the_same_moment_keep_a_stable_order(
    client, connection, product_id
) -> None:
    same_time = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    for number in range(1, 4):
        connection.execute(
            "INSERT INTO reviews (product_id, user_id, body, created_at) VALUES (%s, %s, %s, %s)",
            (product_id, add_user(connection), f"Review {number}", same_time),
        )
    connection.commit()

    first = client.get(f"/products/{product_id}/reviews", params={"limit": 2}).json()
    second = client.get(f"/products/{product_id}/reviews", params={"limit": 2, "offset": 2}).json()

    assert bodies(first) + bodies(second) == ["Review 3", "Review 2", "Review 1"]


def test_product_without_reviews_gives_an_empty_page(client, product_id) -> None:
    response = client.get(f"/products/{product_id}/reviews")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 10, "offset": 0}


def test_reading_reviews_needs_no_sign_in(db_url, connection, product_id) -> None:
    add_reviews(connection, product_id, 1)

    with TestClient(create_app(load_settings(_env_file=None, database_url=db_url))) as anonymous:
        response = anonymous.get(f"/products/{product_id}/reviews")

    assert response.status_code == 200
    assert bodies(response.json()) == ["Review 1"]


def test_only_this_products_reviews_are_listed(client, connection, product_id) -> None:
    other_id = add_product(connection, barcode="012000171741")
    add_reviews(connection, other_id, 2)

    assert client.get(f"/products/{product_id}/reviews").json()["total"] == 0


def test_listed_reviews_show_author_and_their_rating(session, product_id) -> None:
    session.client.post(f"/products/{product_id}/ratings", json={"stars": 5})
    session.client.post(f"/products/{product_id}/reviews", json=REVIEW)

    (review,) = session.client.get(f"/products/{product_id}/reviews").json()["items"]

    assert (review["author"], review["stars"], review["title"]) == ("a***", 5, REVIEW["title"])
    assert "alice@example.com" not in str(review)


@pytest.mark.parametrize("unknown_id", [999, 2**31])
def test_reviews_of_an_unknown_product_is_404(client, product_id, unknown_id) -> None:
    response = client.get(f"/products/{unknown_id}/reviews")

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 51}, {"offset": -1}])
def test_bad_paging_values_are_422(client, product_id, params) -> None:
    response = client.get(f"/products/{product_id}/reviews", params=params)

    assert response.status_code == 422


def test_review_is_linked_to_the_signed_in_users_account(client, connection, product_id) -> None:
    client.post(f"/products/{product_id}/reviews", json=REVIEW)

    connection.commit()
    row = connection.execute(
        "SELECT u.id, u.email FROM reviews AS r JOIN users AS u ON u.id = r.user_id"
    ).fetchone()
    assert row == (ALICE.id, ALICE.email)


def test_deleting_an_account_removes_its_reviews(client, connection, product_id) -> None:
    client.post(f"/products/{product_id}/reviews", json=REVIEW)

    connection.commit()
    connection.execute("DELETE FROM users WHERE id = %s", (ALICE.id,))
    assert stored(connection) == []


def test_my_review_is_404_until_i_write_one(client, product_id) -> None:
    response = client.get(f"/products/{product_id}/reviews/me")
    assert response.status_code == 404
    assert response.json()["code"] == "review_not_found"

    client.post(f"/products/{product_id}/reviews", json=REVIEW)

    assert client.get(f"/products/{product_id}/reviews/me").json()["body"] == REVIEW["body"]


def test_my_review_is_only_mine(session, product_id) -> None:
    session.client.post(f"/products/{product_id}/reviews", json=REVIEW)
    session.user = BOB

    assert session.client.get(f"/products/{product_id}/reviews/me").status_code == 404


def test_removing_my_review_leaves_others(session, connection, product_id) -> None:
    session.client.post(f"/products/{product_id}/reviews", json={"body": "Alice's review."})
    session.user = BOB
    session.client.post(f"/products/{product_id}/reviews", json={"body": "Bob's review."})

    response = session.client.delete(f"/products/{product_id}/reviews/me")

    assert response.status_code == 204
    assert stored(connection) == [(product_id, ALICE.id, None, "Alice's review.")]
    assert session.client.delete(f"/products/{product_id}/reviews/me").status_code == 404
