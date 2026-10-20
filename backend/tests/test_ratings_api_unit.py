"""Unit tests for POST /products/{id}/ratings and GET /products/{id}/ratings/me.

T053 acceptance: when I submit a rating of 1-5, it is saved; when I submit a rating of 0 or 6, it
is rejected with a 422. T054 acceptance (GET /products/{id}/ratings): when a product has ratings
of 4 and 2, the API returns an average of 3.0 and a count of 2.

The signed-in user and the rating repository are replaced with in-memory stand-ins, so these run
anywhere without Postgres or Supabase. test_ratings_api.py runs the same endpoints against a real
database.
"""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthUser, get_current_user
from app.repositories.ratings import get_rating_repository
from tests.fakes import FakeRatings

USER = AuthUser(id=UUID("8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00"), email="a@example.com", role="user")
PRODUCT_ID = 7


@pytest.fixture
def ratings() -> FakeRatings:
    return FakeRatings(PRODUCT_ID)


@pytest.fixture
def client(make_client, ratings: FakeRatings) -> TestClient:
    """A client signed in as USER."""
    client = make_client()
    client.app.dependency_overrides[get_rating_repository] = lambda: ratings
    client.app.dependency_overrides[get_current_user] = lambda: USER
    return client


def rate(client: TestClient, body: object, product_id: int = PRODUCT_ID):
    return client.post(f"/products/{product_id}/ratings", json=body)


@pytest.mark.parametrize("stars", [1, 2, 3, 4, 5])
def test_rating_of_one_to_five_is_saved(client, ratings, stars) -> None:
    response = rate(client, {"stars": stars})

    assert response.status_code == 200
    assert response.json() == {
        "product_id": PRODUCT_ID,
        "stars": stars,
        "created_at": "2026-09-30T12:00:00Z",
        "updated_at": "2026-09-30T12:00:00Z",
    }
    assert ratings.ratings[(PRODUCT_ID, USER.id)].stars == stars


@pytest.mark.parametrize("stars", [0, 6])
def test_rating_of_zero_or_six_is_rejected_with_422(client, ratings, stars) -> None:
    response = rate(client, {"stars": stars})

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert [detail["loc"] for detail in body["details"]] == [["body", "stars"]]
    assert ratings.ratings == {}


@pytest.mark.parametrize(
    "body",
    [
        {"stars": -1},
        {"stars": 4.5},  # half stars
        {"stars": "4"},  # a string, not a number
        {"stars": True},
        {"stars": None},
        {},  # no stars
        {"stars": 4, "comment": "nice"},  # unknown field
        [4],
    ],
)
def test_other_invalid_ratings_are_rejected_with_422(client, ratings, body) -> None:
    response = rate(client, body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert ratings.ratings == {}


def test_rating_again_changes_the_stars(client, ratings) -> None:
    rate(client, {"stars": 2})

    response = rate(client, {"stars": 5})

    assert response.json()["stars"] == 5
    assert list(ratings.ratings) == [(PRODUCT_ID, USER.id)]


def test_rating_an_unknown_product_is_404(client, ratings) -> None:
    response = rate(client, {"stars": 4}, product_id=999)

    assert response.status_code == 404
    assert response.json() == {"code": "product_not_found", "message": "Product not found"}
    assert ratings.ratings == {}


@pytest.mark.parametrize(
    ("method", "path"), [("POST", "/products/abc/ratings"), ("GET", "/products/abc/ratings/me")]
)
def test_non_numeric_product_id_is_404(client, method, path) -> None:
    assert client.request(method, path, json={"stars": 4}).status_code == 404


def test_my_rating_is_returned_after_rating(client) -> None:
    rate(client, {"stars": 3})

    response = client.get(f"/products/{PRODUCT_ID}/ratings/me")

    assert response.status_code == 200
    assert response.json()["stars"] == 3


def test_my_rating_is_404_before_rating(client) -> None:
    response = client.get(f"/products/{PRODUCT_ID}/ratings/me")

    assert response.status_code == 404
    assert response.json() == {
        "code": "rating_not_found",
        "message": "You haven't rated this product",
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", f"/products/{PRODUCT_ID}/ratings"), ("GET", f"/products/{PRODUCT_ID}/ratings/me")],
)
def test_signing_in_is_required(make_client, ratings, method, path) -> None:
    client = make_client()  # the real token check, and no token is sent
    client.app.dependency_overrides[get_rating_repository] = lambda: ratings

    response = client.request(method, path, json={"stars": 4})

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"
    assert ratings.ratings == {}


def test_docs_describe_the_rating_endpoints(client) -> None:
    schema = client.app.openapi()
    post = schema["paths"]["/products/{product_id}/ratings"]["post"]
    get = schema["paths"]["/products/{product_id}/ratings/me"]["get"]

    assert {"401", "404", "422"} <= set(post["responses"])
    assert {"401", "404"} <= set(get["responses"])
    stars = schema["components"]["schemas"]["RatingCreate"]["properties"]["stars"]
    assert (stars["minimum"], stars["maximum"]) == (1, 5)


def add_ratings(ratings: FakeRatings, *stars: int) -> None:
    """Each of these ratings of PRODUCT_ID comes from a different user."""
    for count in stars:
        ratings.save(PRODUCT_ID, uuid4(), count)


def test_ratings_of_4_and_2_average_3_with_a_count_of_2(client, ratings) -> None:
    add_ratings(ratings, 4, 2)

    response = client.get(f"/products/{PRODUCT_ID}/ratings")

    assert response.status_code == 200
    assert response.json() == {"product_id": PRODUCT_ID, "average": 3.0, "count": 2}


def test_product_nobody_rated_has_no_average(client) -> None:
    response = client.get(f"/products/{PRODUCT_ID}/ratings")

    assert response.json() == {"product_id": PRODUCT_ID, "average": None, "count": 0}


def test_summary_of_an_unknown_product_is_404(client) -> None:
    response = client.get("/products/999/ratings")

    assert response.status_code == 404
    assert response.json()["code"] == "product_not_found"


def test_summary_needs_no_sign_in(make_client, ratings) -> None:
    client = make_client()  # the real token check, and no token is sent
    client.app.dependency_overrides[get_rating_repository] = lambda: ratings
    add_ratings(ratings, 5)

    response = client.get(f"/products/{PRODUCT_ID}/ratings")

    assert response.status_code == 200
    assert response.json()["average"] == 5.0


def test_my_new_rating_counts_towards_the_summary(client, ratings) -> None:
    add_ratings(ratings, 4)

    rate(client, {"stars": 2})

    assert client.get(f"/products/{PRODUCT_ID}/ratings").json()["count"] == 2


def test_docs_show_the_summary_is_public(client) -> None:
    operation = client.app.openapi()["paths"]["/products/{product_id}/ratings"]["get"]

    assert "404" in operation["responses"]
    assert "401" not in operation["responses"]


def test_removing_my_rating_deletes_it(client, ratings) -> None:
    rate(client, {"stars": 4})

    response = client.delete(f"/products/{PRODUCT_ID}/ratings/me")

    assert response.status_code == 204
    assert response.content == b""
    assert ratings.ratings == {}
    assert client.get(f"/products/{PRODUCT_ID}/ratings/me").status_code == 404


def test_removing_a_rating_i_never_made_is_404(client) -> None:
    response = client.delete(f"/products/{PRODUCT_ID}/ratings/me")

    assert response.status_code == 404
    assert response.json()["code"] == "rating_not_found"


def test_removing_my_rating_leaves_other_ratings(client, ratings) -> None:
    add_ratings(ratings, 2)
    rate(client, {"stars": 4})

    client.delete(f"/products/{PRODUCT_ID}/ratings/me")

    summary = client.get(f"/products/{PRODUCT_ID}/ratings").json()
    assert (summary["average"], summary["count"]) == (2.0, 1)


def test_removing_a_rating_needs_sign_in(make_client, ratings) -> None:
    client = make_client()  # the real token check, and no token is sent
    client.app.dependency_overrides[get_rating_repository] = lambda: ratings

    response = client.delete(f"/products/{PRODUCT_ID}/ratings/me")

    assert response.status_code == 401
