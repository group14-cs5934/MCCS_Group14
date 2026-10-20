"""Admin product management (US11, T087): create, edit, and delete products.

Every route needs a signed-in admin: 401 without a valid token, 403 for anyone else. The app reads
products fresh on every request, so changes show up there right away.
"""

from fastapi import APIRouter, Response, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import Products
from app.schemas import ProductRead
from app.schemas.admin_product import AdminProductCreate, AdminProductUpdate

router = APIRouter(
    prefix="/admin/products",
    tags=["admin"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        403: error_response("Not an admin, or the admin's account is deactivated"),
        422: error_response("Invalid request, or category_id isn't a category"),
    },
)

_NOT_FOUND = error_response("No product with this ID")
_BARCODE_TAKEN = error_response("Another product already has this barcode")


def _product_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


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


@router.post("", status_code=status.HTTP_201_CREATED, responses={409: _BARCODE_TAKEN})
def create_product(
    product: AdminProductCreate, admin: AdminUser, products: Products
) -> ProductRead:
    """Add a product, optionally with its current price. Returns it as GET /products/{id} does.

    The barcode must be new: one that matches an existing product (even with different leading
    zeros, e.g. 012000001291 and 0012000001291) is a 409.
    """
    _check_new_values(products, product.barcode, product.category_id, product_id=None)
    fields = product.model_dump(exclude={"price"})
    fields["image_url"] = str(product.image_url) if product.image_url else None
    product_id = products.create(fields, price=product.price)
    created = products.get_by_id(product_id)
    assert created is not None  # added in this same transaction
    return created


@router.patch("/{product_id:int}", responses={404: _NOT_FOUND, 409: _BARCODE_TAKEN})
def update_product(
    product_id: int, change: AdminProductUpdate, admin: AdminUser, products: Products
) -> ProductRead:
    """Change a product: only the fields sent change, and null clears an optional field. A new
    price becomes the current price (earlier prices are kept as history). Returns the product."""
    if products.get_by_id(product_id) is None:
        raise _product_not_found()
    _check_new_values(products, change.barcode, change.category_id, product_id=product_id)
    products.update(product_id, change.product_changes(), price=change.price)
    updated = products.get_by_id(product_id)
    assert updated is not None
    return updated


@router.delete(
    "/{product_id:int}", status_code=status.HTTP_204_NO_CONTENT, responses={404: _NOT_FOUND}
)
def delete_product(product_id: int, admin: AdminUser, products: Products) -> Response:
    """Remove a product, along with its prices, ratings, and reviews. 204 (no body) when done."""
    if not products.delete(product_id):
        raise _product_not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
