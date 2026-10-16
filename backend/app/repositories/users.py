from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import UserRead

# Adds a new user with the default role, or updates the email if it changed in Supabase. The
# role of an existing user is never touched, and two first requests at once can't both insert.
_UPSERT = """
INSERT INTO users (id, email) VALUES (%s, %s)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
WHERE users.email IS DISTINCT FROM EXCLUDED.email
"""


class UserRepository:
    """User queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def get_or_create(self, user_id: UUID, email: str | None) -> UserRead:
        """The user's row, added with the "user" role the first time they're seen."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_UPSERT, (user_id, email))
            cursor.execute("SELECT id, email, role FROM users WHERE id = %s", (user_id,))
            row = cursor.fetchone()
        return UserRead.model_validate(row)


def get_user_repository(db: DbConnection) -> UserRepository:
    return UserRepository(db)


# Use as a route parameter: def get_thing(users: Users) -> ...
Users = Annotated[UserRepository, Depends(get_user_repository)]
