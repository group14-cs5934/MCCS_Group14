from pydantic import BaseModel, ConfigDict, Field


class BrandBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100, examples=["Lay's"])


class BrandCreate(BrandBase):
    """Payload to create a brand."""

    model_config = ConfigDict(extra="forbid")


class BrandRead(BrandBase):
    """Brand as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
