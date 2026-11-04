"""Custom store roles (migration 019): each store names its own roles, e.g. "Cashier" or
"Stocker", and ticks what each may do from PERMISSIONS.

Adding a permission: add its key to Permission and its entry to PERMISSIONS (the app's checklist
is built from GET /staff/permissions, so it shows up there by itself), check it in the routes it
allows, and decide whether the starting Manager role (add_default_store_roles, last changed in
migration 020) should have it.
"""

from typing import Annotated, Literal, Self, get_args

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

Permission = Literal[
    "edit_stock",
    "view_staff",
    "manage_staff",
    "manage_roles",
    "edit_store_info",
    "view_restock",
    "request_restock",
]


class PermissionInfo(BaseModel):
    """One box on the role checklist."""

    key: Permission
    label: str
    description: str


# In the order the app lists them.
PERMISSIONS: tuple[PermissionInfo, ...] = (
    PermissionInfo(
        key="edit_stock",
        label="Edit stock",
        description="Mark products in or out of stock and set quantities and aisles.",
    ),
    PermissionInfo(
        key="view_staff",
        label="See staff",
        description="See who works at the store and their roles.",
    ),
    PermissionInfo(
        key="manage_staff",
        label="Manage staff",
        description="Add people to the store, change their roles, and remove them.",
    ),
    PermissionInfo(
        key="manage_roles",
        label="Manage roles",
        description="Create, change, and delete the store's roles.",
    ),
    PermissionInfo(
        key="edit_store_info",
        label="Edit store info",
        description="Change the store's address and opening hours.",
    ),
    PermissionInfo(
        key="view_restock",
        label="See low stock",
        description="See what's low or out of stock, how popular it is, and reorder requests.",
    ),
    PermissionInfo(
        key="request_restock",
        label="Request reorders",
        description="Request reorders of low stock and set when each product counts as low.",
    ),
)

assert {p.key for p in PERMISSIONS} == set(get_args(Permission)), "PERMISSIONS must list each one"

# Having the key gives these too, e.g. managing staff means seeing them.
IMPLIED: dict[Permission, tuple[Permission, ...]] = {
    "manage_staff": ("view_staff",),
    "request_restock": ("view_restock",),
}

_ORDER = {p.key: index for index, p in enumerate(PERMISSIONS)}


def _in_catalog_order(permissions: list[Permission]) -> list[Permission]:
    """Each permission once, in the checklist's order."""
    return sorted(set(permissions), key=_ORDER.__getitem__)


def _known_only(value: object) -> object:
    """Drops permissions this version doesn't know, e.g. one that was removed, when reading roles
    from the database."""
    if isinstance(value, list):
        return [item for item in value if item in _ORDER]
    return value


# A role's permissions as sent by a client: unknown keys are a 422.
Permissions = Annotated[list[Permission], Field(max_length=50), AfterValidator(_in_catalog_order)]

# A role's permissions as read from the database: unknown keys are left out.
StoredPermissions = Annotated[
    list[Permission], BeforeValidator(_known_only), AfterValidator(_in_catalog_order)
]

RoleName = Annotated[str, Field(min_length=1, max_length=50, examples=["Cashier"])]


class StoreRoleSummary(BaseModel):
    """A staff member's role, as shown with their account."""

    id: int
    name: str
    permissions: StoredPermissions


class StoreRoleRead(StoreRoleSummary):
    """One of a store's roles (GET /staff/stores/{id}/roles)."""

    store_id: int
    member_count: int = Field(description="How many people have this role")


class StoreRoleCreate(BaseModel):
    """A new role at a store, e.g. {"name": "Stocker", "permissions": ["edit_stock"]}."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: RoleName
    permissions: Permissions = Field(examples=[["edit_stock"]])


class StoreRoleUpdate(BaseModel):
    """Changes to a role; only the fields sent change."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: RoleName | None = None
    permissions: Permissions | None = None

    @model_validator(mode="after")
    def _has_a_change(self) -> Self:
        if self.name is None and self.permissions is None:
            raise ValueError("send name, permissions, or both")
        return self
