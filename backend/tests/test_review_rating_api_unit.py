"""Review and rating API tests, valid, invalid, and unauthorized cases (T071).

T071 acceptance: when the tests run, valid, invalid, and unauthorized cases all pass.

The signed-in user and the repositories are in-memory stand-ins, so these run anywhere without
Postgres or Supabase. The same endpoints run against a real database in test_reviews_api.py and
test_ratings_api.py, and with real signed tokens in test_review_rating_access.py.
"""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthUser, get_current_user
from app.repositories.ratings import get_rating_repository
from app.repositories.reviews import get_review_repository
from tests.fakes import FakeRatings, FakeReviews

USER = AuthUser(id=UUID("8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00"), email="a@example.com", role="user")
PRODUCT_ID = 7
REVIEW = {"title": "Great for road trips", "body": "Crunchy and not too salty."}


@pytest.fixture
def reviews() -> FakeReviews:
    return FakeReviews(PRODUCT_ID)


@pytest.fixture
def ratings() -> FakeRatings:
    return FakeRatings(PRODUCT_ID)


@pytest.fixture
def anonymous(make_client, reviews, ratings) -> TestClient:
    """A client with no sign-in (the real token check runs and finds no token)."""
    client = make_client()
    client.app.dependency_overrides[get_review_repository] = lambda: reviews
    client.app.dependency_overrides[get_rating_repository] = lambda: ratings
    return client


@pytest.fixture
def client(anonymous) -> TestClient:
    """A client signed in as USER."""
    anonymous.app.dependency_overrides[get_current_user] = lambda: USER
    return anonymous


# --- Valid ---


def test_posting_a_review_saves_and_returns_it(client, reviews) -> None:
    response = client.post(f"/products/{PRODUCT_ID}/reviews", json=REVIEW)

    assert response.status_code == 200
    assert response.json() == {
        "id": 1,
        "product_id": PRODUCT_ID,
        "title": REVIEW["title"],
        "body": REVIEW["body"],
        "author": "u***",
        "stars": None,
        "created_at": "2026-09-30T12:00:00Z",
        "updated_at": "2026-09-30T12:00:00Z",
    }
    assert reviews.reviews[(PRODUCT_ID, USER.id)].body == REVIEW["body"]


def test_review_text_is_trimmed_before_saving(client, reviews) -> None:
    client.post(f"/products/{PRODUCT_ID}/reviews", json={"title": "  ", "body": "  Tasty.  \n"})

    saved = reviews.reviews[(PRODUCT_ID, USER.id)]
    assert (saved.title, saved.body) == (None, "Tasty.")


def test_posted_review_shows_up_in_the_list(client) -> None:
    client.post(f"/products/{PRODUCT_ID}/reviews", json=REVIEW)

    page = client.get(f"/products/{PRODUCT_ID}/reviews").json()

    assert [review["body"] for review in page["items"]] == [REVIEW["body"]]
    assert page["total"] == 1


def test_rating_and_review_together(client) -> None:
    assert client.post(f"/products/{PRODUCT_ID}/ratings", json={"stars": 5}).status_code == 200
    assert client.post(f"/products/{PRODUCT_ID}/reviews", json=REVIEW).status_code == 200

    assert client.get(f"/products/{PRODUCT_ID}/ratings").json()["count"] == 1
    assert client.get(f"/products/{PRODUCT_ID}/reviews").json()["total"] == 1


def test_removing_my_review(client, reviews) -> None:
    client.post(f"/products/{PRODUCT_ID}/reviews", json=REVIEW)

    assert client.delete(f"/products/{PRODUCT_ID}/reviews/me").status_code == 204
    assert reviews.reviews == {}


# --- Invalid ---

INVALID_REVIEWS = {
    "empty body": {"body": ""},
    "blank body": {"body": " \n\t "},
    "body too long": {"body": "a" * 2001},
    "title too long": {"title": "t" * 101, "body": "Fine."},
    "missing body": {"title": "Only a title"},
    "body not text": {"body": 42},
    "title not text": {"title": ["a"], "body": "Fine."},
    "unknown field": {"body": "Fine.", "rating": 5},
    "not an object": ["Fine."],
    "null": None,
}


@pytest.mark.parametrize("payload", INVALID_REVIEWS.values(), ids=INVALID_REVIEWS.keys())
def test_invalid_review_is_422_and_not_saved(client, reviews, payload) -> None:
    response = client.post(f"/products/{PRODUCT_ID}/reviews", json=payload)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["details"]
    assert reviews.reviews == {}


def test_too_long_review_says_what_the_limit_is(client) -> None:
    response = client.post(f"/products/{PRODUCT_ID}/reviews", json={"body": "a" * 2001})

    (problem,) = response.json()["details"]
    assert problem["loc"] == ["body", "body"]
    assert "keep it to 2000 or fewer" in problem["msg"]


def test_review_that_isnt_json_is_422(client, reviews) -> None:
    response = client.post(
        f"/products/{PRODUCT_ID}/reviews",
        content=b"body=Fine.",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 422
    assert reviews.reviews == {}


INVALID_RATINGS = {
    "zero": {"stars": 0},
    "six": {"stars": 6},
    "negative": {"stars": -1},
    "half star": {"stars": 4.5},
    "text": {"stars": "4"},
    "true": {"stars": True},
    "null": {"stars": None},
    "missing": {},
    "unknown field": {"stars": 4, "body": "Fine."},
}


@pytest.mark.parametrize("payload", INVALID_RATINGS.values(), ids=INVALID_RATINGS.keys())
def test_invalid_rating_is_422_and_not_saved(client, ratings, payload) -> None:
    response = client.post(f"/products/{PRODUCT_ID}/ratings", json=payload)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert ratings.ratings == {}


@pytest.mark.parametrize("kind", ["reviews", "ratings"])
def test_unknown_product_is_404(client, kind) -> None:
    body = REVIEW if kind == "reviews" else {"stars": 3}

    for response in (
        client.post(f"/products/999/{kind}", json=body),
        client.get(f"/products/999/{kind}"),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "product_not_found"


@pytest.mark.parametrize("kind", ["reviews", "ratings"])
def test_product_id_that_isnt_a_number_is_404(client, kind) -> None:
    assert client.get(f"/products/abc/{kind}").status_code == 404


@pytest.mark.parametrize("kind", ["reviews", "ratings"])
def test_removing_one_i_dont_have_is_404(client, kind) -> None:
    response = client.delete(f"/products/{PRODUCT_ID}/{kind}/me")

    assert response.status_code == 404
    assert response.json()["code"] == (
        "review_not_found" if kind == "reviews" else "rating_not_found"
    )


@pytest.mark.parametrize("params", ["limit=0", "limit=51", "offset=-1", "limit=ten"])
def test_bad_review_paging_is_422(client, params) -> None:
    assert client.get(f"/products/{PRODUCT_ID}/reviews?{params}").status_code == 422


def test_put_isnt_a_way_to_post_a_review(client) -> None:
    assert client.put(f"/products/{PRODUCT_ID}/reviews", json=REVIEW).status_code == 405


# --- Unauthorized ---

PRIVATE_CALLS = {
    "post review": ("POST", "reviews", REVIEW),
    "post rating": ("POST", "ratings", {"stars": 4}),
    "my review": ("GET", "reviews/me", None),
    "my rating": ("GET", "ratings/me", None),
    "remove review": ("DELETE", "reviews/me", None),
    "remove rating": ("DELETE", "ratings/me", None),
}


@pytest.mark.parametrize("call", PRIVATE_CALLS.values(), ids=PRIVATE_CALLS.keys())
def test_anonymous_calls_are_401_and_change_nothing(anonymous, reviews, ratings, call) -> None:
    method, path, body = call

    response = anonymous.request(method, f"/products/{PRODUCT_ID}/{path}", json=body)

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"
    assert reviews.reviews == {} and ratings.ratings == {}


def test_anonymous_users_can_still_read(anonymous) -> None:
    assert anonymous.get(f"/products/{PRODUCT_ID}/reviews").status_code == 200
    assert anonymous.get(f"/products/{PRODUCT_ID}/ratings").status_code == 200
