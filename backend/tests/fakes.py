"""In-memory stand-ins for unit tests that shouldn't need Postgres.

Swap one in with app.dependency_overrides[get_product_repository] = lambda: FakeProducts(...).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from app.schemas import CategoryRead, PriceRead, ProductRead

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
        self, query: str = "", category: str | None = None, limit: int = 20, offset: int = 0
    ) -> list[ProductRead]:
        self.searches.append(Search(query, category, limit, offset))
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
