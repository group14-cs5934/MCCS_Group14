from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ErrorAction(StrEnum):
    """Something the app should offer the shopper so they aren't stuck after an error."""

    RETRY_SCAN = "retry_scan"  # scan the barcode again (it may have been misread)
    MANUAL_SEARCH = "manual_search"  # look the product up by name instead


class ErrorResponse(BaseModel):
    """Body of every error response (4xx and 5xx), whichever endpoint it comes from."""

    code: str = Field(
        description="Stable, machine-readable error code; check this, not the message",
        examples=["product_not_found"],
    )
    message: str = Field(
        description="Short explanation for developers and logs (not written for shoppers)",
        examples=["Product not found"],
    )
    details: list[dict[str, Any]] | None = Field(
        default=None,
        description="One entry per problem, for validation_error only (loc, msg, type, ...)",
    )
    actions: list[ErrorAction] | None = Field(
        default=None,
        description="What the app should offer next, e.g. for a scanned barcode that isn't found",
        examples=[["retry_scan", "manual_search"]],
    )
