"""In-memory stand-ins for unit tests that shouldn't need Postgres.

Swap one in with app.dependency_overrides[get_product_repository] = lambda: FakeProducts(...).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from app.schemas import (
    CategoryRead,
    PriceRead,
    ProductRead,
    RatingRead,
    RatingSummary,
    ReviewPage,
    ReviewRead,
    Role,
    UserAccount,
)

CREATED = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
CHIPS = CategoryRead(id=3, name="Chips & Snacks", slug="chips-snacks")

LAYS = ProductRead(
    id=7,
    barcode="036000291452",
    name="Lay's Sour Cream & Onion",
    size="184g",
    image_url="https://example.com/lays.jpg",
    category_id=3,
    category=CHIPS,
    price=PriceRead(
        id=11,
        product_id=7,
        amount=Decimal("3.49"),
        source="MCCS",
        observed_at=datetime(2026, 10, 1, 9, 30, tzinfo=UTC),
    ),
    created_at=CREATED,
    updated_at=CREATED,
)

# A product with no category and no price yet.
OATLY = ProductRead(
    id=8, barcode="7394376616501", name="Oatly Oat Milk", created_at=CREATED, updated_at=CREATED
)

DORITOS = ProductRead(
    id=9,
    barcode="028400064057",
    name="Doritos Nacho Cheese",
    category_id=3,
    category=CHIPS,
    created_at=CREATED,
    updated_at=CREATED,
)


@dataclass(frozen=True)
class Search:
    """The arguments of one FakeProducts.search call."""

    query: str
    category: str | None
    limit: int
    offset: int
    store: str | None = None
    in_stock: bool = False


class FakeProducts:
    """Stands in for ProductRepository: serves products from memory and records each call.

    search() matches a plain substring of the name, not the real typo-tolerant search; tests of
    matching itself run against Postgres (test_product_search.py, test_product_repository.py).
    """

    def __init__(self, *products: ProductRead) -> None:
        self._products = list(products)
        self._by_id = {product.id: product for product in products}
        self._by_barcode = {product.barcode: product for product in products}
        self.requested_ids: list[int] = []
        self.requested_barcodes: list[str] = []
        self.searches: list[Search] = []

    def get_by_id(self, product_id: int) -> ProductRead | None:
        self.requested_ids.append(product_id)
        return self._by_id.get(product_id)

    def get_by_barcode(self, barcode: str) -> ProductRead | None:
        self.requested_barcodes.append(barcode)
        return self._by_barcode.get(barcode)

    def search(
        self,
        query: str = "",
        category: str | None = None,
        limit: int = 20,
        offset: int = 0,
        store: str | None = None,
        in_stock: bool = False,
    ) -> list[ProductRead]:
        """Ignores store and in_stock (FakeProducts has no stock); those are tested against
        Postgres in test_product_search_by_store.py."""
        self.searches.append(Search(query, category, limit, offset, store, in_stock))
        query, category = query.strip().lower(), (category or "").strip().lower()
        if not query and not category:
            return []
        found = [
            product
            for product in self._products
            if query in product.name.lower()
            and (not category or (product.category and product.category.slug == category))
        ]
        return found[offset : offset + limit]


class FakeRatings:
    """Stands in for RatingRepository: ratings are kept in a dict, one per (product, user).

    Only the product IDs given exist, like the products in a database.
    """

    def __init__(self, *product_ids: int) -> None:
        self._product_ids = set(product_ids)
        self.ratings: dict[tuple[int, UUID], RatingRead] = {}

    def save(self, product_id: int, user_id: UUID, stars: int) -> RatingRead | None:
        if product_id not in self._product_ids:
            return None
        key = (product_id, user_id)
        created = self.ratings[key].created_at if key in self.ratings else CREATED
        self.ratings[key] = RatingRead(
            product_id=product_id, stars=stars, created_at=created, updated_at=CREATED
        )
        return self.ratings[key]

    def get(self, product_id: int, user_id: UUID) -> RatingRead | None:
        return self.ratings.get((product_id, user_id))

    def delete(self, product_id: int, user_id: UUID) -> bool:
        return self.ratings.pop((product_id, user_id), None) is not None

    def summary(self, product_id: int) -> RatingSummary | None:
        if product_id not in self._product_ids:
            return None
        stars = [r.stars for (pid, _), r in self.ratings.items() if pid == product_id]
        average = round(sum(stars) / len(stars), 2) if stars else None
        return RatingSummary(product_id=product_id, average=average, count=len(stars))


class FakeReviews:
    """Stands in for ReviewRepository: one review per (product, user), kept in the order written.

    Only the product IDs given exist, like the products in a database. Authors are shown as
    "u***" (the real repository shortens the author's email).
    """

    def __init__(self, *product_ids: int) -> None:
        self._product_ids = set(product_ids)
        self.reviews: dict[tuple[int, UUID], ReviewRead] = {}

    def save(
        self, product_id: int, user_id: UUID, title: str | None, body: str
    ) -> ReviewRead | None:
        if product_id not in self._product_ids:
            return None
        key = (product_id, user_id)
        earlier = self.reviews.pop(key, None)
        self.reviews[key] = ReviewRead(
            id=earlier.id if earlier else len(self.reviews) + 1,
            product_id=product_id,
            title=title,
            body=body,
            author="u***",
            created_at=earlier.created_at if earlier else CREATED,
            updated_at=CREATED,
        )
        return self.reviews[key]

    def get_mine(self, product_id: int, user_id: UUID) -> ReviewRead | None:
        return self.reviews.get((product_id, user_id))

    def delete_mine(self, product_id: int, user_id: UUID) -> bool:
        return self.reviews.pop((product_id, user_id), None) is not None

    def list_for_product(self, product_id: int, limit: int, offset: int) -> ReviewPage | None:
        if product_id not in self._product_ids:
            return None
        newest_first = [r for (pid, _), r in reversed(self.reviews.items()) if pid == product_id]
        return ReviewPage(
            items=newest_first[offset : offset + limit],
            total=len(newest_first),
            limit=limit,
            offset=offset,
        )


class FakeUsers:
    """Stands in for UserRepository: accounts are kept in a dict, in the order they were added.

    `searches` records each list_users call as (email, limit, offset).
    """

    def __init__(self) -> None:
        self.accounts: dict[UUID, UserAccount] = {}
        self.searches: list[tuple[str, int, int]] = []

    def lock(self, user_id: UUID) -> bool:
        return user_id in self.accounts

    def get(self, user_id: UUID) -> UserAccount | None:
        return self.accounts.get(user_id)

    def get_or_create(self, user_id: UUID, email: str | None) -> UserAccount:
        if user_id not in self.accounts:
            self.accounts[user_id] = UserAccount(
                id=user_id, email=email, role="user", active=True, created_at=CREATED
            )
        return self.accounts[user_id]

    def list_users(self, email: str = "", limit: int = 50, offset: int = 0) -> list[UserAccount]:
        self.searches.append((email, limit, offset))
        needle = email.strip().lower()
        found = [a for a in self.accounts.values() if needle in (a.email or "").lower()]
        return found[offset : offset + limit]

    def update(
        self,
        user_id: UUID,
        role: Role | None = None,
        active: bool | None = None,
        store_id: int | None = None,
    ) -> UserAccount | None:
        account = self.accounts.get(user_id)
        if account is None:
            return None
        changes = {"role": role, "active": active}
        account = account.model_copy(update={k: v for k, v in changes.items() if v is not None})
        # Like the real query: only workers and managers keep (or get) a store.
        staff = account.role in ("worker", "manager")
        account = account.model_copy(
            update={"store_id": (store_id or account.store_id) if staff else None}
        )
        self.accounts[user_id] = account
        return account

    def find_by_email(self, email: str) -> UserAccount | None:
        needle = email.strip().lower()
        return next((a for a in self.accounts.values() if (a.email or "").lower() == needle), None)

    def list_staff(self, store_id: int) -> list[UserAccount]:
        staff = [a for a in self.accounts.values() if a.store_id == store_id]
        return sorted(staff, key=lambda a: (a.role != "manager", (a.email or "").lower()))

    def remove_store_staff(self, store_id: int) -> int:
        staff = self.list_staff(store_id)
        for account in staff:
            self.update(account.id, role="user")
        return len(staff)


class FakeAuditLog:
    """Stands in for AuditLogRepository: each recorded change is kept in `entries`, as the
    keyword arguments record() was called with."""

    def __init__(self) -> None:
        self.entries: list[dict] = []

    def record(self, **entry) -> None:
        self.entries.append(entry)
