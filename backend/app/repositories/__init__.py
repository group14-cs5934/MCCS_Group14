"""Database queries, one repository per resource. Routes use these instead of writing SQL."""

from app.repositories.products import ProductRepository, Products
from app.repositories.ratings import RatingRepository, Ratings
from app.repositories.reviews import ReviewRepository, Reviews
from app.repositories.stores import StoreRepository, Stores
from app.repositories.users import UserRepository, Users

__all__ = [
    "ProductRepository",
    "Products",
    "RatingRepository",
    "Ratings",
    "ReviewRepository",
    "Reviews",
    "StoreRepository",
    "Stores",
    "UserRepository",
    "Users",
]
