"""Database queries, one repository per resource. Routes use these instead of writing SQL."""

from app.repositories.products import ProductRepository, Products

__all__ = ["ProductRepository", "Products"]
