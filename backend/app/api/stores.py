"""MCCS store locations and product availability (US06): which stores carry a product and
whether it's in stock there. No sign-in needed."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.errors import ApiError, error_response
from app.repositories import Stores
from app.repositories.insights import Insights
from app.schemas.insights import PopularProduct
from app.schemas.store import ProductAvailability, StoreRead

MAX_POPULAR = 20

router = APIRouter(
    tags=["stores"], responses={422: error_response("Invalid request; details lists each problem")}
)


@router.get("/locations")
def list_locations(stores: Stores) -> list[StoreRead]:
    """Every MCCS store, sorted by name."""
    return stores.list_locations()


@router.get("/locations/{store_id:int}", responses={404: error_response("No store with this ID")})
def get_location(store_id: int, stores: Stores) -> StoreRead:
    """One store, with its address and hours (the app's store page, T080)."""
    store = stores.get_store(store_id)
    if store is None:
        raise ApiError(404, "store_not_found", "Store not found")
    return store


@router.get(
    "/locations/{store_id:int}/popular",
    responses={404: error_response("No store with this ID")},
)
def get_popular(
    store_id: int,
    stores: Stores,
    insights: Insights,
    limit: Annotated[int, Query(ge=1, le=MAX_POPULAR)] = 5,
) -> list[PopularProduct]:
    """The store's most viewed and scanned products in the last 30 days, most first, with their
    stock there and rating (Home's "Popular at your store"). Empty when nothing was looked at."""
    if stores.get_store(store_id) is None:
        raise ApiError(404, "store_not_found", "Store not found")
    return insights.popular(store_id, limit)


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
