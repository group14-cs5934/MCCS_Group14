from typing import Annotated

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import Permission, StoreRoleRead
from app.schemas.user import MAX_ID

# Each role with how many people have it.
_SELECT = """
SELECT r.id, r.store_id, r.name, r.permissions,
    (SELECT count(*) FROM users AS u WHERE u.store_role_id = r.id) AS member_count
FROM store_roles AS r
"""


class StoreRoleRepository:
    """Custom store role queries (migration 019), run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def list_for_store(self, store_id: int) -> list[StoreRoleRead]:
        """The store's roles: those that can do the most first, then by name."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"{_SELECT} WHERE r.store_id = %s "
                "ORDER BY cardinality(r.permissions) DESC, lower(r.name), r.id",
                (store_id,),
            )
            return [StoreRoleRead.model_validate(row) for row in cursor.fetchall()]

    def get(self, role_id: int, *, lock: bool = False) -> StoreRoleRead | None:
        """The role with this ID, at any store, or None. With lock, it's locked until the
        request's transaction ends, so a concurrent change waits and the audit log's "before"
        values are right."""
        if not 0 < role_id <= MAX_ID:
            return None
        # FOR UPDATE can't lock a row read with an aggregate, so lock it first.
        if (
            lock
            and not self._connection.execute(
                "SELECT 1 FROM store_roles WHERE id = %s FOR UPDATE", (role_id,)
            ).fetchone()
        ):
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(f"{_SELECT} WHERE r.id = %s", (role_id,))
            row = cursor.fetchone()
        return StoreRoleRead.model_validate(row) if row is not None else None

    def name_taken(self, store_id: int, name: str, except_id: int | None = None) -> bool:
        """Whether another of the store's roles has this name, ignoring case."""
        row = self._connection.execute(
            "SELECT 1 FROM store_roles "
            "WHERE store_id = %s AND lower(name) = lower(%s) AND id IS DISTINCT FROM %s",
            (store_id, name, except_id),
        ).fetchone()
        return row is not None

    def create(self, store_id: int, name: str, permissions: list[Permission]) -> StoreRoleRead:
        (role_id,) = self._connection.execute(
            "INSERT INTO store_roles (store_id, name, permissions) VALUES (%s, %s, %s) "
            "RETURNING id",
            (store_id, name, permissions),
        ).fetchone()
        created = self.get(role_id)
        assert created is not None
        return created

    def update(
        self, role_id: int, name: str | None = None, permissions: list[Permission] | None = None
    ) -> StoreRoleRead:
        """Change a role that exists; a None field keeps its value."""
        self._connection.execute(
            "UPDATE store_roles SET name = COALESCE(%s, name), "
            "permissions = COALESCE(%s, permissions) WHERE id = %s",
            (name, permissions, role_id),
        )
        updated = self.get(role_id)
        assert updated is not None
        return updated

    def delete(self, role_id: int) -> bool:
        """Remove a role nobody has (the database refuses otherwise). False if there's none."""
        cursor = self._connection.execute("DELETE FROM store_roles WHERE id = %s", (role_id,))
        return cursor.rowcount > 0


def get_store_role_repository(db: DbConnection) -> StoreRoleRepository:
    return StoreRoleRepository(db)


# Use as a route parameter: def list_roles(roles: StoreRoles) -> ...
StoreRoles = Annotated[StoreRoleRepository, Depends(get_store_role_repository)]
