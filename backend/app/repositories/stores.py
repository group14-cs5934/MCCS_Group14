from typing import Annotated, Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas.store import ProductAvailability, StoreAvailability, StoreRead

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

_STORE_COLUMNS = "s.id, s.name, s.slug, s.address"

# Every store, with the product's stock row if the store has one. Stores without a row are out of
# stock (in_stock false, nothing else known). In-stock stores come first, then by name.
_AVAILABILITY = f"""
SELECT {_STORE_COLUMNS},
       COALESCE(ps.in_stock, FALSE) AS in_stock, ps.quantity, ps.aisle, ps.updated_at
FROM store_locations AS s
LEFT JOIN product_stock AS ps ON ps.store_id = s.id AND ps.product_id = %s
ORDER BY COALESCE(ps.in_stock, FALSE) DESC, s.name, s.id
"""


def _to_availability(row: dict[str, Any]) -> StoreAvailability:
    store = {key: row.pop(key) for key in ("id", "name", "slug", "address")}
    return StoreAvailability.model_validate({**row, "store": store})


class StoreRepository:
    """Store and stock queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def list_locations(self) -> list[StoreRead]:
        """Every store, sorted by name."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"SELECT {_STORE_COLUMNS} FROM store_locations AS s ORDER BY s.name, s.id"
            )
            return [StoreRead.model_validate(row) for row in cursor.fetchall()]

    def availability(self, product_id: int) -> ProductAvailability | None:
        """The product's stock at every store, or None if there's no product with this ID."""
        if not 0 < product_id <= _MAX_ID:
            return None
        exists = self._connection.execute(
            "SELECT 1 FROM products WHERE id = %s", (product_id,)
        ).fetchone()
        if exists is None:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_AVAILABILITY, (product_id,))
            stores = [_to_availability(row) for row in cursor.fetchall()]
        return ProductAvailability(product_id=product_id, stores=stores)


def get_store_repository(db: DbConnection) -> StoreRepository:
    return StoreRepository(db)


# Use as a route parameter: def list_locations(stores: Stores) -> ...
Stores = Annotated[StoreRepository, Depends(get_store_repository)]
