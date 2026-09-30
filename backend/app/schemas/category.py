from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Slug = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=100, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$"),
]


class CategoryBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100, examples=["Chips & Snacks"])
    slug: Slug = Field(description="URL-safe name, e.g. chips-snacks", examples=["chips-snacks"])
    description: str | None = Field(default=None, max_length=500)


class CategoryCreate(CategoryBase):
    """Payload to create a category."""

    model_config = ConfigDict(extra="forbid")


class CategoryRead(CategoryBase):
    """Category as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
