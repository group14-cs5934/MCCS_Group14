"""Permissions audit (T093): every API endpoint, and who may call it.

T093 acceptance: when every admin endpoint is called by a regular user, all return 403 (checked
per admin endpoint in test_admin_access.py, which finds them by itself).

ACCESS below lists every endpoint with its access level. test_every_endpoint_has_an_access_level
fails when an endpoint is added without an entry, so nobody can add one without deciding who may
call it; then each level is checked for every endpoint that has it, with real signed tokens:

- public: works without signing in, and never changes data (GET only, plus endpoints that are
  known to save nothing);
- signed_in: 401 without a valid token, works for any signed-in user;
- admin: lives under /admin, 401 without a valid token, 403 for regular users;
- store_member: lives under /staff/stores/{store_id}; works for any of that store's staff, whatever
  their role, and for admins; 403 for regular users and for staff of another store, even with
  every permission (migrations 016 and 019);
- store_permission: the same, but the store's staff also need one of the permissions listed for
  it in STORE_PERMISSIONS; 403 for staff whose role has none of them.

Data access is replaced by tripwires (see test_admin_access.py), so these never need a database:
a request that gets past the access check either succeeds or trips one.
"""

from typing import Any, Literal, get_args
from uuid import UUID

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core.auth import TokenVerifier
from app.core.config import load_settings
from app.main import create_app
from app.repositories.audit_log import get_audit_log_repository
from app.repositories.products import get_product_repository
from app.repositories.ratings import get_rating_repository
from app.repositories.restock import get_restock_repository
from app.repositories.reviews import get_review_repository
from app.repositories.shopping import get_shopping_repository
from app.repositories.store_roles import get_store_role_repository
from app.repositories.stores import get_store_repository
from app.repositories.users import get_user_repository
from app.schemas import Permission
from tests.conftest import VALID_DATABASE_URL, VALID_SUPABASE_URL
from tests.fakes import FakeUsers
from tests.test_admin_access import ADMIN_ID, ISSUER, SHOPPER_ID, TrippedError, Tripwire, token

Access = Literal["public", "signed_in", "admin", "store_member", "store_permission"]

# Every endpoint and who may call it. Adding an endpoint means adding it here.
ACCESS: dict[tuple[str, str], Access] = {
    ("GET", "/"): "public",
    ("GET", "/health"): "public",
    ("GET", "/locations"): "public",
    ("GET", "/locations/{store_id}"): "public",
    ("GET", "/products/barcode/{code}"): "public",
    ("GET", "/products/search"): "public",
    ("POST", "/products/validate"): "public",  # checks a payload; saves nothing
    ("GET", "/products/{product_id}"): "public",
    ("GET", "/products/{product_id}/availability"): "public",
    ("GET", "/products/{product_id}/ratings"): "public",
    ("GET", "/products/{product_id}/reviews"): "public",
    ("POST", "/products/{product_id}/activity"): "public",  # anonymous view and scan counts
    ("GET", "/me"): "signed_in",
    ("DELETE", "/me/cart"): "signed_in",
    ("DELETE", "/me/cart/{product_id}"): "signed_in",
    ("DELETE", "/me/saved/{product_id}"): "signed_in",
    ("GET", "/me/cart"): "signed_in",
    ("GET", "/me/cart/check"): "signed_in",
    ("GET", "/me/orders"): "signed_in",
    ("GET", "/me/orders/{order_id}"): "signed_in",
    ("GET", "/me/saved"): "signed_in",
    ("GET", "/me/saved/{product_id}"): "signed_in",
    ("POST", "/me/cart/{product_id}"): "signed_in",
    ("POST", "/me/cart/{product_id}/save-for-later"): "signed_in",
    ("POST", "/me/orders"): "signed_in",
    ("PUT", "/me/cart/{product_id}"): "signed_in",
    ("PUT", "/me/saved/{product_id}"): "signed_in",
    ("GET", "/staff/permissions"): "signed_in",
    ("POST", "/products/{product_id}/ratings"): "signed_in",
    ("GET", "/products/{product_id}/ratings/me"): "signed_in",
    ("DELETE", "/products/{product_id}/ratings/me"): "signed_in",
    ("POST", "/products/{product_id}/reviews"): "signed_in",
    ("GET", "/products/{product_id}/reviews/me"): "signed_in",
    ("DELETE", "/products/{product_id}/reviews/me"): "signed_in",
    ("GET", "/admin/audit-log"): "admin",
    ("GET", "/admin/products"): "admin",
    ("POST", "/admin/products"): "admin",
    ("PATCH", "/admin/products/{product_id}"): "admin",
    ("DELETE", "/admin/products/{product_id}"): "admin",
    ("GET", "/admin/reviews"): "admin",
    ("PATCH", "/admin/reviews/{review_id}"): "admin",
    ("DELETE", "/admin/reviews/{review_id}"): "admin",
    ("GET", "/admin/users"): "admin",
    ("PATCH", "/admin/users/{user_id}"): "admin",
    ("GET", "/admin/products/{product_id}/stock"): "admin",
    ("PUT", "/admin/products/{product_id}/stock/{store_id}"): "admin",
    ("DELETE", "/admin/products/{product_id}/stock/{store_id}"): "admin",
    ("POST", "/admin/stores"): "admin",
    ("PATCH", "/admin/stores/{store_id}"): "admin",
    ("DELETE", "/admin/stores/{store_id}"): "admin",
    ("GET", "/staff/stores/{store_id}/roles"): "store_member",
    ("PATCH", "/staff/stores/{store_id}"): "store_permission",
    ("GET", "/staff/stores/{store_id}/stock"): "store_permission",
    ("PUT", "/staff/stores/{store_id}/stock/{product_id}"): "store_permission",
    ("DELETE", "/staff/stores/{store_id}/stock/{product_id}"): "store_permission",
    ("GET", "/staff/stores/{store_id}/staff"): "store_permission",
    ("POST", "/staff/stores/{store_id}/staff"): "store_permission",
    ("PATCH", "/staff/stores/{store_id}/staff/{user_id}"): "store_permission",
    ("DELETE", "/staff/stores/{store_id}/staff/{user_id}"): "store_permission",
    ("POST", "/staff/stores/{store_id}/roles"): "store_permission",
    ("PATCH", "/staff/stores/{store_id}/roles/{role_id}"): "store_permission",
    ("DELETE", "/staff/stores/{store_id}/roles/{role_id}"): "store_permission",
    ("GET", "/staff/stores/{store_id}/restock"): "store_permission",
    ("GET", "/staff/stores/{store_id}/restock/summary"): "store_permission",
    ("GET", "/staff/stores/{store_id}/restock/requests"): "store_permission",
    ("POST", "/staff/stores/{store_id}/restock/{product_id}/requests"): "store_permission",
    ("DELETE", "/staff/stores/{store_id}/restock/{product_id}/requests/open"): "store_permission",
    ("PUT", "/staff/stores/{store_id}/restock/{product_id}/reorder-point"): "store_permission",
    ("PUT", "/staff/stores/{store_id}/restock/settings"): "store_permission",
}

# The store_permission endpoints, and the permissions that each allow (any one is enough).
STORE_PERMISSIONS: dict[tuple[str, str], tuple[Permission, ...]] = {
    ("PATCH", "/staff/stores/{store_id}"): ("edit_store_info",),
    ("GET", "/staff/stores/{store_id}/stock"): ("edit_stock",),
    ("PUT", "/staff/stores/{store_id}/stock/{product_id}"): ("edit_stock",),
    ("DELETE", "/staff/stores/{store_id}/stock/{product_id}"): ("edit_stock",),
    ("GET", "/staff/stores/{store_id}/staff"): ("view_staff", "manage_staff"),
    ("POST", "/staff/stores/{store_id}/staff"): ("manage_staff",),
    ("PATCH", "/staff/stores/{store_id}/staff/{user_id}"): ("manage_staff",),
    ("DELETE", "/staff/stores/{store_id}/staff/{user_id}"): ("manage_staff",),
    ("POST", "/staff/stores/{store_id}/roles"): ("manage_roles",),
    ("PATCH", "/staff/stores/{store_id}/roles/{role_id}"): ("manage_roles",),
    ("DELETE", "/staff/stores/{store_id}/roles/{role_id}"): ("manage_roles",),
    ("GET", "/staff/stores/{store_id}/restock"): ("view_restock", "request_restock"),
    ("GET", "/staff/stores/{store_id}/restock/summary"): ("view_restock", "request_restock"),
    ("GET", "/staff/stores/{store_id}/restock/requests"): ("view_restock", "request_restock"),
    ("POST", "/staff/stores/{store_id}/restock/{product_id}/requests"): ("request_restock",),
    ("DELETE", "/staff/stores/{store_id}/restock/{product_id}/requests/open"): ("request_restock",),
    ("PUT", "/staff/stores/{store_id}/restock/{product_id}/reorder-point"): ("request_restock",),
    ("PUT", "/staff/stores/{store_id}/restock/settings"): ("request_restock",),
}

ALL_PERMISSIONS: list[Permission] = list(get_args(Permission))
NEEDED: list[tuple[Permission, ...]] = sorted(set(STORE_PERMISSIONS.values()))

# Store staff for the store checks; requests go to store 2 (PATH_VALUES).
EVERYTHING_ID = UUID("c0000000-0000-4000-8000-000000000003")  # a role with every permission
NOTHING_ID = UUID("c0000000-0000-4000-8000-000000000004")  # a role with none
OTHER_STORE_ID = UUID("c0000000-0000-4000-8000-000000000005")  # every permission, at store 9


def only(permission: Permission) -> UUID:
    """Staff at store 2 whose role has just this one permission."""
    return UUID(f"d0000000-0000-4000-8000-{ALL_PERMISSIONS.index(permission):012d}")


def all_but(permissions: tuple[Permission, ...]) -> UUID:
    """Staff at store 2 whose role has every permission except these."""
    return UUID(f"e0000000-0000-4000-8000-{NEEDED.index(permissions):012d}")


# Public endpoints that aren't GET; each must save nothing.
# Validating saves nothing; activity only adds to anonymous daily view and scan counts.
PUBLIC_NON_GET = {("POST", "/products/validate"), ("POST", "/products/{product_id}/activity")}

PATH_VALUES = {
    "product_id": "7",
    "user_id": str(SHOPPER_ID),
    "review_id": "3",
    "code": "036000291452",
    "store_id": "2",
    "role_id": "4",
    "order_id": "5",
}

# A body that's valid for every endpoint that takes one, so a 422 can't hide an access check.
BODY = {
    "barcode": "036000291452",
    "name": "Sample Chips",
    "stars": 4,
    "body": "Crunchy.",
    "role": "admin",
    "active": True,
    "hidden": True,
    "in_stock": False,
    "email": "shopper@example.com",
    "role_id": 1,
    "permissions": ["edit_stock"],
}


def endpoints() -> set[tuple[str, str]]:
    """Every (method, path) the app serves, from its own API description (what /docs shows)."""
    app = create_app(
        load_settings(
            _env_file=None, database_url=VALID_DATABASE_URL, supabase_url=VALID_SUPABASE_URL
        )
    )
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }


def with_access(level: Access) -> list[tuple[str, str]]:
    return sorted(endpoint for endpoint, access in ACCESS.items() if access == level)


def ids(routes: list[tuple[str, str]]) -> list[str]:
    return [f"{method} {path}" for method, path in routes]


# --- The list itself ---


def test_every_endpoint_has_an_access_level() -> None:
    served = endpoints()

    missing = sorted(served - ACCESS.keys())
    stale = sorted(ACCESS.keys() - served)
    assert not missing, f"endpoints with no access level (add them to ACCESS): {missing}"
    assert not stale, f"ACCESS lists endpoints that don't exist any more: {stale}"


def test_admin_endpoints_are_exactly_the_ones_under_admin() -> None:
    # test_admin_access.py checks every route under /admin, so admin-only routes must live there.
    under_admin = {endpoint for endpoint in ACCESS if endpoint[1].startswith("/admin")}

    assert set(with_access("admin")) == under_admin


def test_store_staff_endpoints_are_exactly_the_ones_under_staff() -> None:
    # Kept out of /admin, so test_admin_access.py's "every /admin route is admins only" holds.
    under_staff = {endpoint for endpoint in ACCESS if endpoint[1].startswith("/staff/stores/")}

    assert set(with_access("store_member") + with_access("store_permission")) == under_staff


def test_every_store_permission_endpoint_lists_its_permissions() -> None:
    assert set(STORE_PERMISSIONS) == set(with_access("store_permission"))
    assert all(STORE_PERMISSIONS.values())


def test_public_endpoints_never_change_data() -> None:
    changing = {endpoint for endpoint in with_access("public") if endpoint[0] != "GET"}

    assert changing == PUBLIC_NON_GET


# --- Each level, for every endpoint that has it ---


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def users() -> FakeUsers:
    users = FakeUsers()
    users.get_or_create(SHOPPER_ID, "shopper@example.com")
    users.get_or_create(ADMIN_ID, "admin@example.com")
    users.update(ADMIN_ID, role="admin")
    staff: list[tuple[UUID, int, list[Permission]]] = [
        (EVERYTHING_ID, 2, ALL_PERMISSIONS),
        (NOTHING_ID, 2, []),
        (OTHER_STORE_ID, 9, ALL_PERMISSIONS),
    ]
    staff += [(only(p), 2, [p]) for p in ALL_PERMISSIONS]
    staff += [(all_but(n), 2, [p for p in ALL_PERMISSIONS if p not in n]) for n in NEEDED]
    for role_id, (user_id, store_id, permissions) in enumerate(staff, start=1):
        users.add_role(role_id, store_id, permissions)
        users.get_or_create(user_id, f"{user_id.hex}@example.com")
        users.update(user_id, role="staff", store_role_id=role_id)
    return users


@pytest.fixture
def client(make_client, private_key, users) -> TestClient:
    """The real app, trusting tokens signed with private_key; data access is tripwires."""
    client = make_client()
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, key_resolver=lambda _token: private_key.public_key()
    )
    overrides = client.app.dependency_overrides
    overrides[get_user_repository] = lambda: users
    for dependency, name in [
        (get_product_repository, "products"),
        (get_rating_repository, "ratings"),
        (get_review_repository, "reviews"),
        (get_store_repository, "stores"),
        (get_store_role_repository, "store roles"),
        (get_restock_repository, "restock"),
        (get_shopping_repository, "shopping"),
        (get_audit_log_repository, "audit log"),
    ]:
        overrides[dependency] = lambda name=name: Tripwire(name)
    return client


def call(client: TestClient, method: str, path: str, auth: str | None = None) -> Any:
    """The response, or None if the request got past the access check and reached the data."""
    headers = {"Authorization": f"Bearer {auth}"} if auth else {}
    try:
        return client.request(method, path.format(**PATH_VALUES), json=BODY, headers=headers)
    except TrippedError:
        return None


def passed_access_check(response: Any) -> bool:
    return response is None or response.status_code not in (401, 403)


@pytest.mark.parametrize("endpoint", with_access("public"), ids=ids(with_access("public")))
def test_public_endpoints_work_without_signing_in(client, endpoint) -> None:
    assert passed_access_check(call(client, *endpoint))


@pytest.mark.parametrize("endpoint", with_access("signed_in"), ids=ids(with_access("signed_in")))
def test_signed_in_endpoints_need_a_valid_token(client, endpoint) -> None:
    response = call(client, *endpoint)

    assert response is not None and response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


@pytest.mark.parametrize("endpoint", with_access("signed_in"), ids=ids(with_access("signed_in")))
def test_signed_in_endpoints_work_for_any_user(client, private_key, endpoint) -> None:
    assert passed_access_check(call(client, *endpoint, auth=token(private_key, SHOPPER_ID)))


@pytest.mark.parametrize("endpoint", with_access("signed_in"), ids=ids(with_access("signed_in")))
def test_signed_in_endpoints_turn_away_deactivated_users(client, private_key, users, endpoint):
    users.update(SHOPPER_ID, active=False)

    response = call(client, *endpoint, auth=token(private_key, SHOPPER_ID))

    assert response is not None and response.status_code == 403
    assert response.json()["code"] == "account_deactivated"


@pytest.mark.parametrize("endpoint", with_access("admin"), ids=ids(with_access("admin")))
def test_admin_endpoints_turn_away_regular_users_and_need_a_token(
    client, private_key, endpoint
) -> None:
    # The full set of admin checks (forged, expired, deactivated admins) is in
    # test_admin_access.py; this keeps the audit's three levels side by side.
    as_user = call(client, *endpoint, auth=token(private_key, SHOPPER_ID))
    anonymous = call(client, *endpoint)

    assert as_user is not None and as_user.status_code == 403
    assert anonymous is not None and anonymous.status_code == 401


STORE_LEVELS = with_access("store_member") + with_access("store_permission")
PERMISSION_LEVEL = with_access("store_permission")


@pytest.mark.parametrize("endpoint", STORE_LEVELS, ids=ids(STORE_LEVELS))
def test_store_endpoints_turn_away_regular_users_other_stores_and_no_token(
    client, private_key, endpoint
) -> None:
    anonymous = call(client, *endpoint)
    as_user = call(client, *endpoint, auth=token(private_key, SHOPPER_ID))
    other_store = call(client, *endpoint, auth=token(private_key, OTHER_STORE_ID))

    assert anonymous is not None and anonymous.status_code == 401
    assert as_user is not None and as_user.status_code == 403
    assert as_user.json()["code"] == "forbidden"
    assert other_store is not None and other_store.status_code == 403
    assert other_store.json()["code"] == "not_your_store"


@pytest.mark.parametrize("endpoint", STORE_LEVELS, ids=ids(STORE_LEVELS))
def test_store_endpoints_work_for_the_stores_staff_with_every_permission_and_admins(
    client, private_key, endpoint
) -> None:
    assert passed_access_check(call(client, *endpoint, auth=token(private_key, EVERYTHING_ID)))
    assert passed_access_check(call(client, *endpoint, auth=token(private_key, ADMIN_ID)))


@pytest.mark.parametrize(
    "endpoint", with_access("store_member"), ids=ids(with_access("store_member"))
)
def test_store_member_endpoints_work_for_staff_with_no_permissions(
    client, private_key, endpoint
) -> None:
    assert passed_access_check(call(client, *endpoint, auth=token(private_key, NOTHING_ID)))


@pytest.mark.parametrize("endpoint", PERMISSION_LEVEL, ids=ids(PERMISSION_LEVEL))
def test_store_permission_endpoints_work_with_any_one_of_their_permissions(
    client, private_key, endpoint
) -> None:
    for permission in STORE_PERMISSIONS[endpoint]:
        response = call(client, *endpoint, auth=token(private_key, only(permission)))
        assert passed_access_check(response), permission


@pytest.mark.parametrize("endpoint", PERMISSION_LEVEL, ids=ids(PERMISSION_LEVEL))
def test_store_permission_endpoints_turn_away_staff_without_them(
    client, private_key, endpoint
) -> None:
    # Staff with no permissions, and staff with every permission except the ones it allows.
    for person in (NOTHING_ID, all_but(STORE_PERMISSIONS[endpoint])):
        response = call(client, *endpoint, auth=token(private_key, person))

        assert response is not None and response.status_code == 403
        assert response.json()["code"] == "missing_permission"
