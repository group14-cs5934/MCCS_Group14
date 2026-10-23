"""Sprint 3 integration test for reviews and ratings (T073), needs TEST_DATABASE_URL.

T073 acceptance: when a review is posted in the app, it is stored in the database and visible to
other users.

Nothing is replaced here: the real app runs on a real database, and each shopper sends a real
signed access token (the legacy HS256 kind, so no Supabase keys need fetching), which goes through
the same sign-in check, users table, and repositories as in production. The requests are the ones
the app sends (mobile/src/api/reviews.ts and ratings.ts).

The list another shopper sees at the end is also saved as
mobile/__tests__/fixtures/reviews-api-response.json, which
mobile/__tests__/reviews-api-contract.test.tsx feeds to the product page to check the app shows
it correctly. If the API's response changes on purpose, regenerate it and commit it:
    UPDATE_REVIEWS_FIXTURE=1 uv run pytest tests/test_reviews_integration.py
"""

import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import jwt
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.conftest import VALID_SUPABASE_URL
from tests.factories import add_product

FIXTURE = (
    Path(__file__).resolve().parents[2] / "mobile/__tests__/fixtures/reviews-api-response.json"
)
SECRET = "integration-test-secret-at-least-32-bytes-long"
ISSUER = f"{VALID_SUPABASE_URL}/auth/v1"

ALICE = (UUID("8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00"), "alice@example.com")
BOB = (UUID("c9f0f895-fb98-4ab2-9a3e-4b1b2f0c7a11"), "bob@example.com")
CAROL = (UUID("45c48cce-2e2d-4fbd-9a6e-b4a3c1d2e3f4"), "carol@example.com")


def token(user: tuple[UUID, str]) -> dict[str, str]:
    """The Authorization header the app sends for this signed-in shopper."""
    now = datetime.now(UTC)
    claims = {
        "sub": str(user[0]),
        "email": user[1],
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return {"Authorization": f"Bearer {jwt.encode(claims, SECRET, algorithm='HS256')}"}


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    settings = load_settings(_env_file=None, database_url=db_url, supabase_jwt_secret=SECRET)
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)
    connection.commit()
    return product_id


def stored_reviews(connection: psycopg.Connection) -> list[tuple]:
    connection.commit()  # see what the API committed
    return connection.execute(
        """
        SELECT r.product_id, u.email, r.title, r.body FROM reviews AS r
        JOIN users AS u ON u.id = r.user_id ORDER BY r.id
        """
    ).fetchall()


def test_review_posted_in_the_app_is_stored_and_visible_to_other_users(
    client, connection, product_id
) -> None:
    alice, bob = token(ALICE), token(BOB)
    # The app calls GET /me right after signing in, which adds the user's row.
    assert client.get("/me", headers=alice).status_code == 200

    # Alice rates and reviews the product.
    rating = client.post(f"/products/{product_id}/ratings", json={"stars": 5}, headers=alice)
    posted = client.post(
        f"/products/{product_id}/reviews",
        json={"title": "Crisp and cold", "body": "Exactly what I wanted."},
        headers=alice,
    )
    assert (rating.status_code, posted.status_code) == (200, 200)

    # It's stored in the database, linked to Alice's account.
    assert stored_reviews(connection) == [
        (product_id, "alice@example.com", "Crisp and cold", "Exactly what I wanted.")
    ]

    # Bob, another shopper, sees it with her rating, but not her email.
    page = client.get(f"/products/{product_id}/reviews", headers=bob).json()
    assert page["total"] == 1
    (review,) = page["items"]
    assert (review["title"], review["body"], review["author"], review["stars"]) == (
        "Crisp and cold",
        "Exactly what I wanted.",
        "a***",
        5,
    )
    assert "alice@example.com" not in json.dumps(page)
    assert client.get(f"/products/{product_id}/ratings", headers=bob).json() == {
        "product_id": product_id,
        "average": 5.0,
        "count": 1,
    }

    # So does someone who isn't signed in.
    assert client.get(f"/products/{product_id}/reviews").json()["total"] == 1


def test_reviews_from_several_users_show_newest_first_and_edits_show_to_everyone(
    client, connection, product_id
) -> None:
    alice, bob, carol = token(ALICE), token(BOB), token(CAROL)
    client.post(f"/products/{product_id}/reviews", json={"body": "Too sweet."}, headers=alice)
    client.post(f"/products/{product_id}/ratings", json={"stars": 4}, headers=bob)
    client.post(
        f"/products/{product_id}/reviews",
        json={"title": "Good value", "body": "Cheaper here than off base."},
        headers=bob,
    )
    # Alice changes her mind; her review keeps its place (posting time) but shows the new text.
    client.post(f"/products/{product_id}/ratings", json={"stars": 3}, headers=alice)
    client.post(
        f"/products/{product_id}/reviews",
        json={"title": None, "body": "Grew on me after a week."},
        headers=alice,
    )
    _pin_review_times(connection)

    page = client.get(f"/products/{product_id}/reviews", headers=carol).json()

    assert [(r["author"], r["stars"], r["body"]) for r in page["items"]] == [
        ("b***", 4, "Cheaper here than off base."),
        ("a***", 3, "Grew on me after a week."),
    ]
    assert len(stored_reviews(connection)) == 2  # still one review per shopper
    assert client.get(f"/products/{product_id}/ratings").json()["average"] == 3.5

    _check_shared_fixture(page)


def test_anonymous_shopper_cant_post_and_nothing_is_stored(client, connection, product_id) -> None:
    response = client.post(f"/products/{product_id}/reviews", json={"body": "Spam."})

    assert response.status_code == 401
    assert stored_reviews(connection) == []


def test_review_that_breaks_the_rules_is_rejected_and_not_stored(
    client, connection, product_id
) -> None:
    response = client.post(
        f"/products/{product_id}/reviews", json={"body": "a" * 2001}, headers=token(ALICE)
    )

    assert response.status_code == 422
    assert stored_reviews(connection) == []


def _pin_review_times(connection: psycopg.Connection) -> None:
    """Fix each review's times (in the order they were first posted), so the saved fixture is the
    same on every run."""
    connection.commit()
    rows = connection.execute("SELECT id FROM reviews ORDER BY created_at, id").fetchall()
    for day, (review_id,) in enumerate(rows, start=20):
        at = datetime(2026, 10, day, 12, 0, tzinfo=UTC)
        connection.execute(
            "UPDATE reviews SET created_at = %s, updated_at = %s WHERE id = %s",
            (at, at, review_id),
        )
    connection.commit()


def _check_shared_fixture(page: dict) -> None:
    if os.environ.get("UPDATE_REVIEWS_FIXTURE"):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(page, indent=2) + "\n", encoding="utf-8", newline="\n")

    # Product and review IDs depend on the database, so compare everything else.
    def without_ids(data: dict) -> list[dict]:
        return [
            {k: v for k, v in r.items() if k not in ("id", "product_id")} for r in data["items"]
        ]

    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert without_ids(page) == without_ids(expected), (
        "GET /products/{id}/reviews no longer returns what the mobile tests expect. If that's on "
        "purpose, regenerate the fixture (see this file's docstring)."
    )
    assert {k: page[k] for k in ("total", "limit", "offset")} == {
        k: expected[k] for k in ("total", "limit", "offset")
    }
