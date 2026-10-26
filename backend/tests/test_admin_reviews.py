"""Review moderation against a real database (skipped without TEST_DATABASE_URL).

T082 acceptance: when an admin hides a review, it no longer appears in the app. "In the app" is
checked through the endpoint the product page reads, GET /products/{id}/reviews. Who may call the
moderation endpoints at all is covered for every admin route by test_admin_access.py.
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
from tests.factories import add_product

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
ALICE = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email="alice@example.com")
BOB = TokenUser(id=UUID("c0000000-0000-4000-8000-000000000003"), email="bob@example.com")


class Session:
    """A client for the app on the test database, signed in as `user` (change it to switch)."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.user = ADMIN

    def as_user(self, user: TokenUser) -> TestClient:
        self.user = user
        return self.client


@pytest.fixture
def session(db_url: str, connection: psycopg.Connection) -> Iterator[Session]:
    users = UserRepository(connection)
    for user in (ADMIN, ALICE, BOB):
        users.get_or_create(user.id, user.email)
    users.update(ADMIN.id, role="admin")
    connection.commit()

    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        session = Session(client)
        app.dependency_overrides[get_token_user] = lambda: session.user
        yield session


@pytest.fixture
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)
    connection.commit()
    return product_id


def write_review(session: Session, product_id: int, user: TokenUser, body: str) -> int:
    """Post a review as `user`, the way the app does; return its ID."""
    response = session.as_user(user).post(f"/products/{product_id}/reviews", json={"body": body})
    assert response.status_code == 200
    return response.json()["id"]


def public_reviews(session: Session, product_id: int) -> dict:
    """What the product page shows (no sign-in needed, so whoever is signed in doesn't matter)."""
    return session.client.get(f"/products/{product_id}/reviews").json()


def hide(session: Session, review_id: int, hidden: bool = True):
    return session.as_user(ADMIN).patch(f"/admin/reviews/{review_id}", json={"hidden": hidden})


def stored(connection: psycopg.Connection, review_id: int) -> tuple | None:
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    return connection.execute(
        "SELECT hidden_at IS NOT NULL, hidden_by FROM reviews WHERE id = %s", (review_id,)
    ).fetchone()


# --- The acceptance criterion ---


def test_hidden_review_no_longer_appears_in_the_app(session, product_id) -> None:
    rude = write_review(session, product_id, ALICE, "Rude review")
    write_review(session, product_id, BOB, "Helpful review")
    assert public_reviews(session, product_id)["total"] == 2

    response = hide(session, rude)

    assert response.status_code == 200
    assert response.json()["hidden"] is True
    shown = public_reviews(session, product_id)
    assert [review["body"] for review in shown["items"]] == ["Helpful review"]
    assert shown["total"] == 1


def test_shown_again_review_comes_back(session, product_id) -> None:
    review_id = write_review(session, product_id, ALICE, "Was hidden by mistake")
    hide(session, review_id)

    response = hide(session, review_id, hidden=False)

    assert response.json()["hidden"] is False
    assert response.json()["hidden_at"] is None
    assert [r["id"] for r in public_reviews(session, product_id)["items"]] == [review_id]


# --- Edge cases ---


def test_hiding_records_the_admin_and_hiding_again_keeps_the_first_time(
    session, connection, product_id
) -> None:
    review_id = write_review(session, product_id, ALICE, "Hide me")
    first = hide(session, review_id).json()["hidden_at"]

    second = hide(session, review_id).json()["hidden_at"]

    assert second == first
    assert stored(connection, review_id) == (True, ADMIN.id)


def test_author_still_sees_their_hidden_review_and_editing_keeps_it_hidden(
    session, connection, product_id
) -> None:
    review_id = write_review(session, product_id, ALICE, "Original")
    hide(session, review_id)

    mine = session.as_user(ALICE).get(f"/products/{product_id}/reviews/me")
    write_review(session, product_id, ALICE, "Edited to try to get it back")

    assert mine.status_code == 200
    assert mine.json()["id"] == review_id
    assert stored(connection, review_id) == (True, ADMIN.id)
    assert public_reviews(session, product_id)["total"] == 0


def test_author_can_still_remove_their_hidden_review(session, connection, product_id) -> None:
    review_id = write_review(session, product_id, ALICE, "Hidden, then removed")
    hide(session, review_id)

    response = session.as_user(ALICE).delete(f"/products/{product_id}/reviews/me")

    assert response.status_code == 204
    assert stored(connection, review_id) is None


def test_hiding_a_review_keeps_the_authors_rating(session, product_id) -> None:
    session.as_user(ALICE).post(f"/products/{product_id}/ratings", json={"stars": 2})
    review_id = write_review(session, product_id, ALICE, "Hide the words, keep the stars")

    hide(session, review_id)

    summary = session.client.get(f"/products/{product_id}/ratings").json()
    assert (summary["average"], summary["count"]) == (2.0, 1)


def test_review_stays_hidden_if_the_admin_who_hid_it_is_deleted(
    session, connection, product_id
) -> None:
    review_id = write_review(session, product_id, ALICE, "Hidden by a former admin")
    hide(session, review_id)

    connection.execute("DELETE FROM users WHERE id = %s", (ADMIN.id,))
    connection.commit()

    assert stored(connection, review_id) == (True, None)
    assert public_reviews(session, product_id)["total"] == 0


# --- The admin review list ---


def test_admin_list_includes_hidden_reviews_with_the_authors_email(session, product_id) -> None:
    hidden_id = write_review(session, product_id, ALICE, "Hidden one")
    write_review(session, product_id, BOB, "Visible one")
    hide(session, hidden_id)

    reviews = session.as_user(ADMIN).get("/admin/reviews").json()

    assert [(r["body"], r["author_email"], r["hidden"]) for r in reviews] == [
        ("Visible one", "bob@example.com", False),  # newest first
        ("Hidden one", "alice@example.com", True),
    ]
    assert reviews[1]["user_id"] == str(ALICE.id)
    assert reviews[1]["author"] == "a***"


def test_admin_list_filters_by_hidden_and_product(session, connection, product_id) -> None:
    other_id = add_product(connection, barcode="012000171741")
    connection.commit()
    hidden_id = write_review(session, product_id, ALICE, "Hidden one")
    write_review(session, product_id, BOB, "Visible one")
    write_review(session, other_id, ALICE, "Other product")
    hide(session, hidden_id)
    client = session.as_user(ADMIN)

    only_hidden = client.get("/admin/reviews", params={"hidden": "true"}).json()
    only_visible = client.get("/admin/reviews", params={"hidden": "false"}).json()
    one_product = client.get("/admin/reviews", params={"product_id": other_id}).json()

    assert [r["body"] for r in only_hidden] == ["Hidden one"]
    assert [r["body"] for r in only_visible] == ["Other product", "Visible one"]
    assert [r["body"] for r in one_product] == ["Other product"]


def test_admin_list_pages(session, product_id) -> None:
    write_review(session, product_id, ALICE, "First")
    write_review(session, product_id, BOB, "Second")
    client = session.as_user(ADMIN)

    page_one = client.get("/admin/reviews", params={"limit": 1}).json()
    page_two = client.get("/admin/reviews", params={"limit": 1, "offset": 1}).json()

    assert [r["body"] for r in page_one + page_two] == ["Second", "First"]


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"product_id": 0}, {"hidden": "x"}]
)
def test_admin_list_rejects_bad_filters_and_paging(session, params) -> None:
    assert session.as_user(ADMIN).get("/admin/reviews", params=params).status_code == 422


# --- Deleting ---


def test_deleted_review_is_gone_for_good(session, connection, product_id) -> None:
    review_id = write_review(session, product_id, ALICE, "Spam")

    response = session.as_user(ADMIN).delete(f"/admin/reviews/{review_id}")

    assert response.status_code == 204
    assert stored(connection, review_id) is None
    assert public_reviews(session, product_id)["total"] == 0
    assert session.as_user(ADMIN).get("/admin/reviews").json() == []


@pytest.mark.parametrize("unknown_id", [999, 2**31])  # 2**31 is past Postgres's INTEGER max
def test_unknown_review_is_404(session, unknown_id) -> None:
    client = session.as_user(ADMIN)

    hidden = client.patch(f"/admin/reviews/{unknown_id}", json={"hidden": True})
    deleted = client.delete(f"/admin/reviews/{unknown_id}")

    assert (hidden.status_code, deleted.status_code) == (404, 404)
    assert hidden.json()["code"] == "review_not_found"


# --- Bad requests and regular users ---


@pytest.mark.parametrize(
    "body",
    [
        {},  # nothing to change
        {"hidden": "yes"},  # only true or false
        {"hidden": None},
        {"hidden": True, "reason": "spam"},  # unknown field
    ],
)
def test_invalid_moderation_is_422(session, connection, product_id, body) -> None:
    review_id = write_review(session, product_id, ALICE, "Still visible")

    response = session.as_user(ADMIN).patch(f"/admin/reviews/{review_id}", json=body)

    assert response.status_code == 422
    assert stored(connection, review_id) == (False, None)


def test_regular_users_cant_hide_or_delete_reviews(session, connection, product_id) -> None:
    review_id = write_review(session, product_id, ALICE, "Bob doesn't like this")
    client = session.as_user(BOB)

    assert client.patch(f"/admin/reviews/{review_id}", json={"hidden": True}).status_code == 403
    assert client.delete(f"/admin/reviews/{review_id}").status_code == 403
    assert stored(connection, review_id) == (False, None)
