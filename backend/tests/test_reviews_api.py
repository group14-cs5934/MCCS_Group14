"""Review endpoints against a real database (skipped without TEST_DATABASE_URL).

T059 acceptance: when a signed-in user posts a valid review, it is saved and returned.
"""

from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_product

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
