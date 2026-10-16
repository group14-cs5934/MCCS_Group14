"""Database queries, one repository per resource. Routes use these instead of writing SQL."""

from app.repositories.products import ProductRepository, Products
from app.repositories.users import UserRepository, Users

__all__ = ["ProductRepository", "Products", "UserRepository", "Users"]
