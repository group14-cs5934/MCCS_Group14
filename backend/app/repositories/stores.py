from typing import Annotated, Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas.store import (
    AdminProductStock,
    AdminStoreStock,
    ProductAvailability,
    StoreAvailability,
    StoreRead,
)

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

_STORE_COLUMNS = "s.id, s.name, s.slug, s.address, s.hours"
_STORE_KEYS = ("id", "name", "slug", "address", "hours")

# Every store, with the product's stock row if the store has one. Stores without a row are out of
# stock (in_stock false, nothing else known). In-stock stores come first, then by name.
_AVAILABILITY = f"""
SELECT {_STORE_COLUMNS},
       COALESCE(ps.in_stock, FALSE) AS in_stock, ps.quantity, ps.aisle, ps.updated_at
FROM store_locations AS s
LEFT JOIN product_stock AS ps ON ps.store_id = s.id AND ps.product_id = %s
ORDER BY COALESCE(ps.in_stock, FALSE) DESC, s.name, s.id
"""


# The same, with when an admin set each row (T094).
_ADMIN_AVAILABILITY = f"""
SELECT {_STORE_COLUMNS},
       COALESCE(ps.in_stock, FALSE) AS in_stock, ps.quantity, ps.aisle, ps.updated_at,
       ps.admin_set_at
FROM store_locations AS s
LEFT JOIN product_stock AS ps ON ps.store_id = s.id AND ps.product_id = %s
ORDER BY COALESCE(ps.in_stock, FALSE) DESC, s.name, s.id
"""

# An admin setting a store's stock. Marks the row as admin-set, so automatic updates leave it.
# A quantity that isn't given is unknown (NULL); an aisle that isn't given keeps its value.
_SET_STOCK = """
INSERT INTO product_stock
    (product_id, store_id, in_stock, quantity, aisle, updated_at, admin_set_at)
VALUES (%(product_id)s, %(store_id)s, %(in_stock)s, %(quantity)s, %(aisle)s, NOW(), NOW())
ON CONFLICT (product_id, store_id) DO UPDATE SET
    in_stock = EXCLUDED.in_stock,
    quantity = EXCLUDED.quantity,
    aisle = CASE WHEN %(keep_aisle)s THEN product_stock.aisle ELSE EXCLUDED.aisle END,
    updated_at = NOW(),
    admin_set_at = NOW()
"""


def _to_availability(row: dict[str, Any]) -> StoreAvailability:
    store = {key: row.pop(key) for key in _STORE_KEYS}
    return StoreAvailability.model_validate({**row, "store": store})


def _to_admin_stock(row: dict[str, Any]) -> AdminStoreStock:
    store = {key: row.pop(key) for key in _STORE_KEYS}
    return AdminStoreStock.model_validate({**row, "store": store})


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

    # --- Admin (T094) ---

    def product_exists(self, product_id: int) -> bool:
        if not 0 < product_id <= _MAX_ID:
            return False
        row = self._connection.execute(
            "SELECT 1 FROM products WHERE id = %s", (product_id,)
        ).fetchone()
        return row is not None

    def get_store(self, store_id: int, *, lock: bool = False) -> StoreRead | None:
        """The store with this ID, or None. With lock, it's locked until the request's
        transaction ends, so the audit log's "before" values are right."""
        if not 0 < store_id <= _MAX_ID:
            return None
        lock_clause = " FOR UPDATE" if lock else ""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"SELECT {_STORE_COLUMNS} FROM store_locations AS s WHERE s.id = %s{lock_clause}",
                (store_id,),
            )
            row = cursor.fetchone()
        return StoreRead.model_validate(row) if row is not None else None

    def slug_taken(self, slug: str, except_id: int | None = None) -> bool:
        row = self._connection.execute(
            "SELECT 1 FROM store_locations WHERE slug = %s AND id IS DISTINCT FROM %s",
            (slug, except_id),
        ).fetchone()
        return row is not None

    def create_store(
        self, name: str, slug: str, address: str | None, hours: str | None = None
    ) -> StoreRead:
        (store_id,) = self._connection.execute(
            "INSERT INTO store_locations (name, slug, address, hours) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (name, slug, address, hours),
        ).fetchone()
        created = self.get_store(store_id)
        assert created is not None
        return created

    def update_store(self, store_id: int, fields: dict[str, Any]) -> StoreRead:
        """Change the given columns (name, slug, address, hours) of a store that exists."""
        allowed = [column for column in ("name", "slug", "address", "hours") if column in fields]
        if allowed:
            # Column names only ever come from the constant list above.
            assignments = ", ".join(f"{column} = %({column})s" for column in allowed)
            self._connection.execute(
                f"UPDATE store_locations SET {assignments} WHERE id = %(id)s",
                {**{column: fields[column] for column in allowed}, "id": store_id},
            )
        updated = self.get_store(store_id)
        assert updated is not None
        return updated

    def stock_count(self, store_id: int) -> int:
        (count,) = self._connection.execute(
            "SELECT count(*) FROM product_stock WHERE store_id = %s", (store_id,)
        ).fetchone()
        return count

    def delete_store(self, store_id: int) -> bool:
        """Remove the store and its stock rows. False if there's none."""
        if not 0 < store_id <= _MAX_ID:
            return False
        cursor = self._connection.execute("DELETE FROM store_locations WHERE id = %s", (store_id,))
        return cursor.rowcount > 0

    def admin_availability(self, product_id: int) -> AdminProductStock | None:
        """The product's stock at every store with when an admin set it, or None if there's no
        product with this ID."""
        if not self.product_exists(product_id):
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_ADMIN_AVAILABILITY, (product_id,))
            stores = [_to_admin_stock(row) for row in cursor.fetchall()]
        return AdminProductStock(product_id=product_id, stores=stores)

    def stock(self, product_id: int, store_id: int) -> dict[str, Any] | None:
        """The product's stock row at the store, locked until the request ends; None if the
        store has no record of it."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT in_stock, quantity, aisle, admin_set_at FROM product_stock "
                "WHERE product_id = %s AND store_id = %s FOR UPDATE",
                (product_id, store_id),
            )
            return cursor.fetchone()

    def set_stock(
        self,
        product_id: int,
        store_id: int,
        in_stock: bool,
        quantity: int | None,
        aisle: str | None,
        keep_aisle: bool,
    ) -> None:
        """Set the product's stock at the store as an admin (automatic updates then leave it)."""
        self._connection.execute(
            _SET_STOCK,
            {
                "product_id": product_id,
                "store_id": store_id,
                "in_stock": in_stock,
                "quantity": quantity,
                "aisle": aisle,
                "keep_aisle": keep_aisle,
            },
        )

    def clear_admin_stock(self, product_id: int, store_id: int) -> bool:
        """Hand a store's stock of the product back to automatic updates: the values stay as
        they are (so the app keeps showing them) until the monitor next updates them. False if
        an admin hadn't set it."""
        cursor = self._connection.execute(
            "UPDATE product_stock SET admin_set_at = NULL "
            "WHERE product_id = %s AND store_id = %s AND admin_set_at IS NOT NULL",
            (product_id, store_id),
        )
        return cursor.rowcount > 0


def get_store_repository(db: DbConnection) -> StoreRepository:
    return StoreRepository(db)


# Use as a route parameter: def list_locations(stores: Stores) -> ...
Stores = Annotated[StoreRepository, Depends(get_store_repository)]
