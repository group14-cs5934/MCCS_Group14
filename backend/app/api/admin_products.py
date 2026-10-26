"""Admin product management (US11): list products (T090), and create, edit, and delete them
(T087).

Every route needs a signed-in admin: 401 without a valid token, 403 for anyone else. The app reads
products fresh on every request, so changes show up there right away. Each change is recorded in
the audit log (T083).
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, Products
from app.repositories.audit_log import changed_fields
from app.schemas import ProductRead
from app.schemas.admin_product import AdminProductCreate, AdminProductRead, AdminProductUpdate

router = APIRouter(
    prefix="/admin/products",
    tags=["admin"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        403: error_response("Not an admin, or the admin's account is deactivated"),
        422: error_response("Invalid request, or category_id isn't a category"),
    },
)

MAX_PRODUCTS_PER_PAGE = 100

_NOT_FOUND = error_response("No product with this ID")
_BARCODE_TAKEN = error_response("Another product already has this barcode")


def _product_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


def _admin_view(products: Products, product: ProductRead) -> AdminProductRead:
    """The product with which of its fields an admin set (the sync leaves those alone)."""
    fields = products.admin_fields([product.id]).get(product.id, [])
    return AdminProductRead(**product.model_dump(), admin_fields=fields)


def _admin_views(products: Products, found: list[ProductRead]) -> list[AdminProductRead]:
    fields = products.admin_fields([product.id for product in found])
    return [
        AdminProductRead(**product.model_dump(), admin_fields=fields.get(product.id, []))
        for product in found
    ]


def _product_fields(product: AdminProductRead) -> dict[str, object]:
    """What the audit log compares for a product: its editable fields, current price, and which
    of them an admin set."""
    return {
        "barcode": product.barcode,
        "name": product.name,
        "description": product.description,
        "size": product.size,
        "image_url": str(product.image_url) if product.image_url else None,
        "brand_id": product.brand_id,
        "category_id": product.category_id,
        "price": product.price.amount if product.price else None,
        "admin_fields": product.admin_fields or None,
    }


def _record(audit: AuditLog, admin: AdminUser, action: str, product_id: int, changes) -> None:
    audit.record(
        admin_id=admin.id,
        admin_email=admin.email,
        action=action,
        target_type="product",
        target_id=product_id,
        changes=changes,
    )


def _check_new_values(
    products: Products, barcode: str | None, category_id: int | None, product_id: int | None
) -> None:
    """409 if the barcode belongs to another product; 422 if the category doesn't exist."""
    if barcode is not None and products.barcode_in_use(barcode, except_id=product_id):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "barcode_taken",
            "Another product already has this barcode",
        )
    if category_id is not None and not products.category_exists(category_id):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "category_not_found",
            "There's no category with this ID",
        )


@router.get("")
def list_products(
    admin: AdminUser,
    products: Products,
    q: Annotated[
        str, Query(max_length=100, description="Words in the product name; small typos are OK")
    ] = "",
    limit: Annotated[int, Query(ge=1, le=MAX_PRODUCTS_PER_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0, le=10_000, description="Products to skip, for paging")] = 0,
) -> list[AdminProductRead]:
    """Every product, sorted by name, for the admin product list. With q, only products whose
    name matches, best match first (the same search shoppers use). Each says which fields an
    admin set, which the product sync leaves alone."""
    if q.strip():
        return _admin_views(products, products.search(q, limit=limit, offset=offset))
    return _admin_views(products, products.list_all(limit=limit, offset=offset))


@router.post("", status_code=status.HTTP_201_CREATED, responses={409: _BARCODE_TAKEN})
def create_product(
    product: AdminProductCreate, admin: AdminUser, products: Products, audit: AuditLog
) -> AdminProductRead:
    """Add a product, optionally with its current price. Returns it as GET /products/{id} does,
    plus admin_fields.

    The barcode must be new: one that matches an existing product (even with different leading
    zeros, e.g. 012000001291 and 0012000001291) is a 409. Every field given is marked as set by
    an admin, so the product sync won't replace it.
    """
    _check_new_values(products, product.barcode, product.category_id, product_id=None)
    fields = product.model_dump(exclude={"price"})
    fields["image_url"] = str(product.image_url) if product.image_url else None
    product_id = products.create(fields, price=product.price)
    given = {name for name, value in product.model_dump().items() if value is not None}
    products.change_admin_fields(product_id, protect=given)
    found = products.get_by_id(product_id)
    assert found is not None  # added in this same transaction
    created = _admin_view(products, found)
    changes = changed_fields({}, _product_fields(created))
    _record(audit, admin, "product.create", product_id, changes)
    return created


@router.patch("/{product_id:int}", responses={404: _NOT_FOUND, 409: _BARCODE_TAKEN})
def update_product(
    product_id: int,
    change: AdminProductUpdate,
    admin: AdminUser,
    products: Products,
    audit: AuditLog,
) -> AdminProductRead:
    """Change a product: only the fields sent change, and null clears an optional field. A new
    price becomes the current price (earlier prices are kept as history); sending the price it
    already has adds nothing. Returns the product.

    Every field sent is marked as set by an admin, so the product sync won't replace it.
    {"resume_sync": ["name"]} hands fields back to the sync (true for all of them); it can be sent
    on its own or with changes.
    """
    if not products.lock(product_id):
        raise _product_not_found()
    found = products.get_by_id(product_id)
    assert found is not None  # locked above
    before = _admin_view(products, found)
    _check_new_values(products, change.barcode, change.category_id, product_id=product_id)
    current_price = before.price.amount if before.price else None
    new_price = change.price if change.price != current_price else None
    products.update(product_id, change.product_changes(), price=new_price)
    release = "all" if change.resume_sync is True else set(change.resume_sync or [])
    products.change_admin_fields(product_id, protect=change.edited_fields(), release=release)
    found = products.get_by_id(product_id)
    assert found is not None
    updated = _admin_view(products, found)
    changes = changed_fields(_product_fields(before), _product_fields(updated))
    _record(audit, admin, "product.update", product_id, changes)
    return updated


@router.delete(
    "/{product_id:int}", status_code=status.HTTP_204_NO_CONTENT, responses={404: _NOT_FOUND}
)
def delete_product(
    product_id: int, admin: AdminUser, products: Products, audit: AuditLog
) -> Response:
    """Remove a product, along with its prices, ratings, and reviews. 204 (no body) when done."""
    if not products.lock(product_id):
        raise _product_not_found()
    found = products.get_by_id(product_id)
    assert found is not None  # locked above
    before = _admin_view(products, found)
    # The log keeps what was deleted, and how many prices, ratings, and reviews went with it.
    counts = products.related_counts(product_id)
    products.delete(product_id)
    changes = changed_fields(_product_fields(before), {})
    changes |= changed_fields(counts, {name: 0 for name in counts})
    _record(audit, admin, "product.delete", product_id, changes)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
