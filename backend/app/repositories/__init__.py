"""Database queries, one repository per resource. Routes use these instead of writing SQL."""

from app.repositories.audit_log import AuditLog, AuditLogRepository
from app.repositories.overall_reviews import OverallReviewRepository, OverallReviews
from app.repositories.products import ProductRepository, Products
from app.repositories.ratings import RatingRepository, Ratings
from app.repositories.restock import Restock, RestockRepository
from app.repositories.reviews import ReviewRepository, Reviews
from app.repositories.store_roles import StoreRoleRepository, StoreRoles
from app.repositories.stores import StoreRepository, Stores
from app.repositories.users import UserRepository, Users

__all__ = [
    "AuditLog",
    "AuditLogRepository",
    "OverallReviewRepository",
    "OverallReviews",
    "ProductRepository",
    "Products",
    "RatingRepository",
    "Ratings",
    "Restock",
    "RestockRepository",
    "ReviewRepository",
    "Reviews",
    "StoreRepository",
    "StoreRoleRepository",
    "StoreRoles",
    "Stores",
    "UserRepository",
    "Users",
]
