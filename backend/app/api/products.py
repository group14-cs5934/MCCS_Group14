from typing import Annotated

from fastapi import APIRouter, Query

from app.core.errors import ApiError, error_response
from app.repositories import Products
from app.schemas import ErrorAction, ProductCreate, ProductRead

# Most search results returned at once; page through more with offset.
MAX_SEARCH_LIMIT = 50

# Declaring 422 here replaces FastAPI's default 422 docs, which show its old {"detail": ...} body.
router = APIRouter(
    prefix="/products",
    tags=["products"],
    responses={422: error_response("Invalid request; details lists each problem")},
)


def _product_not_found(actions: list[ErrorAction] | None = None) -> ApiError:
    return ApiError(404, "product_not_found", "Product not found", actions=actions)


@router.post("/validate")
def validate_product(product: ProductCreate) -> ProductCreate:
    """Dry run: check a product payload without saving it.

    Returns the cleaned-up product (whitespace trimmed) if it's valid, or 422 with every problem
    if not. Nothing is stored; creating products is added with the database (T017/T087).
    """
    return product


@router.get("/search")
def search_products(
    products: Products,
    q: Annotated[
        str, Query(max_length=100, description="Words in the product name; small typos are OK")
    ] = "",
    category: Annotated[
        str | None, Query(max_length=100, description="Only this category's slug, e.g. snacks")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_SEARCH_LIMIT)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000, description="Results to skip, for paging")] = 0,
) -> list[ProductRead]:
    """Products matching a name search (best match first) and/or in one category (by slug).

    Always a list: no matches, a blank search, or an unknown category give [], never an error.
    For example, /products/search?q=coffe finds coffee, and ?q=chips&category=snacks finds chips
    in Snacks only.
    """
    return products.search(q, category, limit=limit, offset=offset)


# ":int" makes this route match digits only, so /products/abc is a 404 (not a 422) and named
# routes like /products/search or /products/barcode/... never get mistaken for an ID.
@router.get("/{product_id:int}", responses={404: error_response("No product with this ID")})
def get_product(product_id: int, products: Products) -> ProductRead:
    """A product with its name, photo URL, category, and current price."""
    product = products.get_by_id(product_id)
    if product is None:
        raise _product_not_found()
    return product


@router.get(
    "/barcode/{code}",
    responses={
        404: error_response(
            "No product with this barcode; actions tells the app to offer scanning again "
            "and searching by name"
        )
    },
)
def get_product_by_barcode(code: str, products: Products) -> ProductRead:
    """The product with this UPC/EAN barcode (e.g. 036000291452), as returned by GET /{id}.

    The app sends what the scanner read, already normalized (UPC-E expanded to UPC-A, iOS's
    leading 0 removed). Leading zeros are ignored when matching, so 012000001291 (UPC-A) finds a
    product stored as 0012000001291 (EAN-13). Anything else that isn't a stored barcode,
    including codes that aren't 8, 12, 13, or 14 digits, is a 404 whose "actions" are
    ["retry_scan", "manual_search"]: the barcode may have been misread, or the product isn't in
    the catalog yet, so the app should offer to scan again or search by name.
    """
    product = products.get_by_barcode(code)
    if product is None:
        raise _product_not_found([ErrorAction.RETRY_SCAN, ErrorAction.MANUAL_SEARCH])
    return product
