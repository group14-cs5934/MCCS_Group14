"""Unit tests for the admin user-management endpoints (GET/PATCH /admin/users).

T081 acceptance: when an admin changes a user's role or deactivates them, it takes effect on the
user's next request.

Who's signed in is set per request, and the users table is an in-memory stand-in, so these run
without Postgres or Supabase. The real role and deactivation checks (CurrentUser, AdminUser) run
as they do in the app. test_admin_users.py runs the same endpoints against a real database.
"""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.repositories.users import get_user_repository
from tests.fakes import FakeUsers

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
SHOPPER = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email="shopper@example.com")


class Session:
    """Who the next request comes from; change `user` to switch."""

    user: TokenUser | None = ADMIN


@pytest.fixture
def users() -> FakeUsers:
    users = FakeUsers()
    users.get_or_create(ADMIN.id, ADMIN.email)
    users.update(ADMIN.id, role="admin")
    users.get_or_create(SHOPPER.id, SHOPPER.email)
    return users


@pytest.fixture
def session() -> Session:
    return Session()


@pytest.fixture
def client(make_client, users: FakeUsers, session: Session) -> TestClient:
    client = make_client()
    client.app.dependency_overrides[get_user_repository] = lambda: users
    client.app.dependency_overrides[get_token_user] = lambda: session.user
    return client


def patch_user(client: TestClient, user_id: UUID, body: object):
    return client.patch(f"/admin/users/{user_id}", json=body)


# --- The acceptance criteria: changes apply on the user's next request ---


def test_promoting_a_user_lets_them_use_admin_endpoints_on_their_next_request(
    client, session
) -> None:
    session.user = SHOPPER
    assert client.get("/admin/users").status_code == 403

    session.user = ADMIN
    assert patch_user(client, SHOPPER.id, {"role": "admin"}).status_code == 200

    session.user = SHOPPER
    assert client.get("/admin/users").status_code == 200
    assert client.get("/me").json()["role"] == "admin"


def test_demoting_an_admin_takes_away_admin_access_on_their_next_request(
    client, session, users
) -> None:
    users.update(SHOPPER.id, role="admin")

    patch_user(client, SHOPPER.id, {"role": "user"})

    session.user = SHOPPER
    assert client.get("/admin/users").status_code == 403
    assert client.get("/me").json()["role"] == "user"


def test_deactivated_user_is_rejected_on_their_next_request(client, session) -> None:
    session.user = SHOPPER
    assert client.get("/me").status_code == 200

    session.user = ADMIN
    response = patch_user(client, SHOPPER.id, {"active": False})
    assert response.status_code == 200
    assert response.json()["active"] is False

    session.user = SHOPPER
    response = client.get("/me")
    assert response.status_code == 403
    assert response.json() == {
        "code": "account_deactivated",
        "message": "This account has been deactivated.",
    }


def test_reactivated_user_can_use_the_app_again(client, session) -> None:
    patch_user(client, SHOPPER.id, {"active": False})

    patch_user(client, SHOPPER.id, {"active": True})

    session.user = SHOPPER
    assert client.get("/me").status_code == 200


# --- Listing users ---


def test_admin_lists_users_with_role_and_status(client) -> None:
    response = client.get("/admin/users")

    assert response.status_code == 200
    assert [(u["email"], u["role"], u["active"]) for u in response.json()] == [
        ("admin@example.com", "admin", True),
        ("shopper@example.com", "user", True),
    ]
    assert set(response.json()[0]) == {"id", "email", "role", "active", "created_at"}


def test_list_passes_the_email_search_and_paging(client, users) -> None:
    client.get("/admin/users", params={"email": "SHOP", "limit": 10, "offset": 0})

    assert users.searches == [("SHOP", 10, 0)]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
def test_list_rejects_bad_paging(client, params) -> None:
    assert client.get("/admin/users", params=params).status_code == 422


# --- Changing users ---


def test_change_returns_the_updated_user(client) -> None:
    response = patch_user(client, SHOPPER.id, {"role": "admin", "active": False})

    assert response.status_code == 200
    body = response.json()
    assert (body["id"], body["role"], body["active"]) == (str(SHOPPER.id), "admin", False)


def test_unknown_user_is_404(client) -> None:
    response = patch_user(client, uuid4(), {"role": "admin"})

    assert response.status_code == 404
    assert response.json()["code"] == "user_not_found"


@pytest.mark.parametrize("body", [{"role": "user"}, {"active": False}])
def test_admin_cant_demote_or_deactivate_themselves(client, users, body) -> None:
    response = patch_user(client, ADMIN.id, body)

    assert response.status_code == 409
    assert response.json()["code"] == "cannot_change_own_account"
    assert users.accounts[ADMIN.id].role == "admin"
    assert users.accounts[ADMIN.id].active


@pytest.mark.parametrize(
    "body",
    [
        {},  # nothing to change
        {"role": None, "active": None},
        {"role": "owner"},  # not a role
        {"active": "no"},
        {"role": "admin", "email": "x@example.com"},  # can't change other fields
    ],
)
def test_invalid_changes_are_422(client, body) -> None:
    response = patch_user(client, SHOPPER.id, body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_user_id_must_be_a_uuid(client) -> None:
    assert patch_user(client, "not-a-uuid", {"role": "admin"}).status_code == 422


# --- Who can use these endpoints ---


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/admin/users"), ("PATCH", f"/admin/users/{SHOPPER.id}")],
)
def test_regular_users_get_403(client, session, users, method, path) -> None:
    session.user = SHOPPER

    response = client.request(method, path, json={"role": "admin"})

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert users.accounts[SHOPPER.id].role == "user"


def test_signing_in_is_required(make_client, users) -> None:
    client = make_client()  # the real token check, and no token is sent
    client.app.dependency_overrides[get_user_repository] = lambda: users

    assert client.get("/admin/users").status_code == 401


def test_a_deactivated_admin_is_rejected(client, session, users) -> None:
    users.update(SHOPPER.id, role="admin", active=False)
    session.user = SHOPPER

    response = client.get("/admin/users")

    assert response.status_code == 403
    assert response.json()["code"] == "account_deactivated"
