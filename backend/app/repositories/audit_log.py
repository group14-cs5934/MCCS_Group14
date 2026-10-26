from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import Depends
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.core.database import DbConnection
from app.schemas.audit import AuditLogEntry


def changed_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """The fields whose value differs, as {"field": {"from": old, "to": new}}, ready to store.

    Pass {} as `before` for something created, or as `after` for something deleted, to record all
    of its (non-null) fields. Prices stay exact strings like "2.99", never floats.
    """
    changes = {}
    for field in [*before, *(key for key in after if key not in before)]:
        old, new = before.get(field), after.get(field)
        if old != new:
            changes[field] = {"from": old, "to": new}
    return jsonable_encoder(changes, custom_encoder={Decimal: str})


class AuditLogRepository:
    """Audit log queries, run on the request's connection, so an entry is saved in the same
    transaction as the change it describes: both are saved, or neither is."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def record(
        self,
        *,
        admin_id: UUID,
        admin_email: str | None,
        action: str,
        target_type: str,
        target_id: str | int | UUID,
        changes: dict[str, Any],
    ) -> None:
        """Log one admin change. `changes` should come from changed_fields()."""
        self._connection.execute(
            """
            INSERT INTO admin_audit_log
                (admin_id, admin_email, action, target_type, target_id, changes)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (admin_id, admin_email, action, target_type, str(target_id), Jsonb(changes)),
        )

    def list_entries(
        self,
        *,
        admin_id: UUID | None = None,
        action: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AuditLogEntry]:
        """Logged changes, newest first, optionally only one admin's, one action's, or one
        target's (e.g. target_type="product", target_id="7")."""
        filters = {
            "admin_id": admin_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
        }
        if any("\x00" in value for value in filters.values() if isinstance(value, str)):
            return []  # Postgres rejects text containing NUL, and no logged value contains one
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, admin_id, admin_email, action, target_type, target_id, changes,
                    created_at
                FROM admin_audit_log
                WHERE (%(admin_id)s::uuid IS NULL OR admin_id = %(admin_id)s)
                    AND (%(action)s::text IS NULL OR action = %(action)s)
                    AND (%(target_type)s::text IS NULL OR target_type = %(target_type)s)
                    AND (%(target_id)s::text IS NULL OR target_id = %(target_id)s)
                ORDER BY created_at DESC, id DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                {**filters, "limit": limit, "offset": offset},
            )
            return [AuditLogEntry.model_validate(row) for row in cursor.fetchall()]


def get_audit_log_repository(db: DbConnection) -> AuditLogRepository:
    return AuditLogRepository(db)


# Use as a route parameter: def update_thing(audit: AuditLog) -> ...
AuditLog = Annotated[AuditLogRepository, Depends(get_audit_log_repository)]
