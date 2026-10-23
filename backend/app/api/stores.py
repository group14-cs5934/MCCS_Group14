"""MCCS store locations and product availability (US06): which stores carry a product and
whether it's in stock there. No sign-in needed."""

from fastapi import APIRouter

from app.core.errors import ApiError, error_response
from app.repositories import Stores
from app.schemas.store import ProductAvailability, StoreRead

router = APIRouter(
    tags=["stores"], responses={422: error_response("Invalid request; details lists each problem")}
)


@router.get("/locations")
def list_locations(stores: Stores) -> list[StoreRead]:
    """Every MCCS store, sorted by name."""
    return stores.list_locations()


@router.get(
    "/products/{product_id:int}/availability",
    responses={404: error_response("No product with this ID")},
)
def get_availability(product_id: int, stores: Stores) -> ProductAvailability:
    """Each store with whether it has the product in stock, in-stock stores first.

    Every store is listed: one with no stock record for the product shows in_stock false and
    updated_at null. Quantity and aisle are included when the store recorded them.
    """
    availability = stores.availability(product_id)
    if availability is None:
        raise ApiError(404, "product_not_found", "Product not found")
    return availability
