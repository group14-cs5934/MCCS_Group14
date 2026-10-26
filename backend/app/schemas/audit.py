"""Audit log of admin changes (T083)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class AuditLogEntry(BaseModel):
    """One admin change: who made it, what changed, and when."""

    id: int
    admin_id: UUID | None = Field(description="The admin's account; null if it was deleted since")
    admin_email: str | None = Field(description="The admin's email when they made the change")
    action: str = Field(examples=["product.update"])
    target_type: str = Field(examples=["product"])
    target_id: str = Field(examples=["7"])
    changes: dict[str, Any] = Field(
        description='Each changed field as {"from": old, "to": new}. For something created, '
        '"from" is null; for something deleted, "to" is null.',
        examples=[{"price": {"from": "2.49", "to": "2.99"}}],
    )
    created_at: datetime = Field(description="When the change was made")
