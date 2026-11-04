from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import Role, UserAccount

# Adds a new user with the default role, or updates the email if it changed in Supabase. The
# role of an existing user is never touched, and two first requests at once can't both insert.
_UPSERT = """
INSERT INTO users (id, email) VALUES (%s, %s)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
WHERE users.email IS DISTINCT FROM EXCLUDED.email
"""

# Each user with their store role (staff only), as UserAccount expects it.
_SELECT = """
SELECT u.id, u.email, u.role, u.store_id, u.created_at, u.deactivated_at IS NULL AS active,
    CASE WHEN r.id IS NOT NULL
        THEN json_build_object('id', r.id, 'name', r.name, 'permissions', r.permissions)
    END AS store_role
FROM users AS u
LEFT JOIN store_roles AS r ON r.id = u.store_role_id
"""

# Changes only what's given: a NULL role, store_role_id, or active keeps the current value. Staff
# have a store role and that role's store (migration 019), so any other role clears both. A role
# ID that doesn't exist leaves staff without a store, which the database refuses; callers check
# it first. Deactivating an already deactivated user keeps the original time.
_UPDATE = """
UPDATE users SET
    role = COALESCE(%(role)s::text, role),
    store_role_id = CASE
        WHEN COALESCE(%(role)s::text, role) = 'staff'
            THEN COALESCE(%(store_role_id)s::integer, store_role_id)
    END,
    store_id = CASE
        WHEN COALESCE(%(role)s::text, role) = 'staff'
            THEN (
                SELECT r.store_id FROM store_roles AS r
                WHERE r.id = COALESCE(%(store_role_id)s::integer, users.store_role_id)
            )
    END,
    deactivated_at = CASE
        WHEN %(active)s::boolean IS NULL THEN deactivated_at
        WHEN %(active)s::boolean THEN NULL
        ELSE COALESCE(deactivated_at, NOW())
    END
WHERE id = %(id)s
"""


class UserRepository:
    """User queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def get_or_create(self, user_id: UUID, email: str | None) -> UserAccount:
        """The user's row, added with the "user" role the first time they're seen. Read fresh on
        every request, so role changes and deactivation take effect on the user's next request."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_UPSERT, (user_id, email))
            cursor.execute(f"{_SELECT} WHERE u.id = %s", (user_id,))
            row = cursor.fetchone()
        return UserAccount.model_validate(row)

    def lock(self, user_id: UUID) -> bool:
        """Lock the user's row until this request's transaction ends, so a concurrent
        change waits and the audit log's "before" values are right. False if there's none."""
        row = self._connection.execute(
            "SELECT 1 FROM users WHERE id = %s FOR UPDATE", (user_id,)
        ).fetchone()
        return row is not None

    def get(self, user_id: UUID) -> UserAccount | None:
        """The user with this ID, or None if there isn't one."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(f"{_SELECT} WHERE u.id = %s", (user_id,))
            row = cursor.fetchone()
        return UserAccount.model_validate(row) if row is not None else None

    def list_users(self, email: str = "", limit: int = 50, offset: int = 0) -> list[UserAccount]:
        """Users in the order they joined, optionally only those whose email contains `email`
        (any case)."""
        email = email.strip().lower()
        if "\x00" in email:  # Postgres rejects text containing NUL, and no email contains one
            return []
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"{_SELECT} "
                "WHERE %(email)s = '' OR position(%(email)s IN lower(u.email)) > 0 "
                "ORDER BY u.created_at, u.id LIMIT %(limit)s OFFSET %(offset)s",
                {"email": email, "limit": limit, "offset": offset},
            )
            return [UserAccount.model_validate(row) for row in cursor.fetchall()]

    def update(
        self,
        user_id: UUID,
        role: Role | None = None,
        active: bool | None = None,
        store_role_id: int | None = None,
    ) -> UserAccount | None:
        """Change the user's role and/or store role, and/or deactivate (active=False) or
        reactivate them. Staff need a store role (given here, or the one they have), and their
        store is that role's; any other role clears both. None if there's no user with this ID."""
        cursor = self._connection.execute(
            _UPDATE,
            {"id": user_id, "role": role, "active": active, "store_role_id": store_role_id},
        )
        return self.get(user_id) if cursor.rowcount else None

    def find_by_email(self, email: str) -> UserAccount | None:
        """The user with exactly this email (any case), or None."""
        email = email.strip().lower()
        if not email or "\x00" in email:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"{_SELECT} WHERE lower(u.email) = %s ORDER BY u.created_at LIMIT 1",
                (email,),
            )
            row = cursor.fetchone()
        return UserAccount.model_validate(row) if row is not None else None

    def list_staff(self, store_id: int) -> list[UserAccount]:
        """The store's staff: those whose role can do the most first, then by role name and
        email."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"{_SELECT} WHERE u.store_id = %s "
                "ORDER BY cardinality(r.permissions) DESC, lower(r.name), lower(u.email), u.id",
                (store_id,),
            )
            return [UserAccount.model_validate(row) for row in cursor.fetchall()]

    def remove_store_staff(self, store_id: int) -> int:
        """Make all of this store's staff regular users again (before the store is deleted);
        returns how many there were."""
        cursor = self._connection.execute(
            "UPDATE users SET role = 'user', store_id = NULL, store_role_id = NULL "
            "WHERE store_id = %s",
            (store_id,),
        )
        return cursor.rowcount


def get_user_repository(db: DbConnection) -> UserRepository:
    return UserRepository(db)


# Use as a route parameter: def get_thing(users: Users) -> ...
Users = Annotated[UserRepository, Depends(get_user_repository)]
