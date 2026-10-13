from typing import Any

from pydantic import BaseModel, Field


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
