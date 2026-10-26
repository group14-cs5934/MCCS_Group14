"""The admin audit log (T083): every admin change, with who made it, what changed, and when.

Entries are added by the admin endpoints themselves, in the same transaction as each change; this
router only reads them. Needs a signed-in admin: 401 without a valid token, 403 for anyone else.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.auth import AdminUser
from app.core.errors import error_response
from app.repositories import AuditLog
from app.schemas import AuditLogEntry

MAX_ENTRIES_PER_PAGE = 100

router = APIRouter(
    prefix="/admin/audit-log",
    tags=["admin"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        403: error_response("Not an admin, or the admin's account is deactivated"),
        422: error_response("Invalid request; details lists each problem"),
    },
)


@router.get("")
def list_audit_log(
    admin: AdminUser,
    audit: AuditLog,
    admin_id: Annotated[UUID | None, Query(description="Only this admin's changes")] = None,
    action: Annotated[
        str | None, Query(max_length=50, description="Only this action, e.g. product.update")
    ] = None,
    target_type: Annotated[
        str | None, Query(max_length=50, description="Only changes to this kind, e.g. product")
    ] = None,
    target_id: Annotated[
        str | None, Query(max_length=100, description="Only changes to this one, e.g. 7")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_ENTRIES_PER_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000, description="Entries to skip, for paging")] = 0,
) -> list[AuditLogEntry]:
    """Admin changes, newest first. For everything that happened to one product, use
    ?target_type=product&target_id=7."""
    return audit.list_entries(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        limit=limit,
        offset=offset,
    )
