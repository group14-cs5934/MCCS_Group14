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

_COLUMNS = "id, email, role, store_id, created_at, deactivated_at IS NULL AS active"

# Changes only what's given: a NULL role, store_id, or active keeps the current value. Only
# workers and managers have a store (migration 016), so any other role clears it. Deactivating an
# already deactivated user keeps the original time.
_UPDATE = f"""
UPDATE users SET
    role = COALESCE(%(role)s::text, role),
    store_id = CASE
        WHEN COALESCE(%(role)s::text, role) IN ('worker', 'manager')
            THEN COALESCE(%(store_id)s::integer, store_id)
        ELSE NULL
    END,
    deactivated_at = CASE
        WHEN %(active)s::boolean IS NULL THEN deactivated_at
        WHEN %(active)s::boolean THEN NULL
        ELSE COALESCE(deactivated_at, NOW())
    END
WHERE id = %(id)s
RETURNING {_COLUMNS}
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
            cursor.execute(f"SELECT {_COLUMNS} FROM users WHERE id = %s", (user_id,))
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
            cursor.execute(f"SELECT {_COLUMNS} FROM users WHERE id = %s", (user_id,))
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
                f"SELECT {_COLUMNS} FROM users "
                "WHERE %(email)s = '' OR position(%(email)s IN lower(email)) > 0 "
                "ORDER BY created_at, id LIMIT %(limit)s OFFSET %(offset)s",
                {"email": email, "limit": limit, "offset": offset},
            )
            return [UserAccount.model_validate(row) for row in cursor.fetchall()]

    def update(
        self,
        user_id: UUID,
        role: Role | None = None,
        active: bool | None = None,
        store_id: int | None = None,
    ) -> UserAccount | None:
        """Change the user's role and/or store, and/or deactivate (active=False) or reactivate
        them. A worker or manager needs a store (given here, or the one they have); any other
        role clears it. None if there's no user with this ID."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                _UPDATE, {"id": user_id, "role": role, "active": active, "store_id": store_id}
            )
            row = cursor.fetchone()
        return UserAccount.model_validate(row) if row is not None else None

    def find_by_email(self, email: str) -> UserAccount | None:
        """The user with exactly this email (any case), or None."""
        email = email.strip().lower()
        if not email or "\x00" in email:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"SELECT {_COLUMNS} FROM users WHERE lower(email) = %s ORDER BY created_at LIMIT 1",
                (email,),
            )
            row = cursor.fetchone()
        return UserAccount.model_validate(row) if row is not None else None

    def list_staff(self, store_id: int) -> list[UserAccount]:
        """The store's managers, then its workers, each by email."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"SELECT {_COLUMNS} FROM users WHERE store_id = %s "
                "ORDER BY role = 'manager' DESC, lower(email), id",
                (store_id,),
            )
            return [UserAccount.model_validate(row) for row in cursor.fetchall()]

    def remove_store_staff(self, store_id: int) -> int:
        """Make every worker and manager at this store a regular user again (before the store is
        deleted); returns how many there were."""
        cursor = self._connection.execute(
            "UPDATE users SET role = 'user', store_id = NULL WHERE store_id = %s", (store_id,)
        )
        return cursor.rowcount


def get_user_repository(db: DbConnection) -> UserRepository:
    return UserRepository(db)


# Use as a route parameter: def get_thing(users: Users) -> ...
Users = Annotated[UserRepository, Depends(get_user_repository)]
