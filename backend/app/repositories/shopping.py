from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, NamedTuple
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas.shopping import (
    MAX_QUANTITY,
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderStore,
    ProductCard,
    SavedProduct,
)

# A product with its latest price, as card__* columns.
_CARD_COLUMNS = """
p.id AS card__id, p.barcode AS card__barcode, p.name AS card__name, p.size AS card__size,
p.image_url AS card__image_url, pr.amount AS card__price
"""
_LATEST_PRICE = """
LEFT JOIN LATERAL (
    SELECT amount FROM prices WHERE prices.product_id = p.id
    ORDER BY observed_at DESC, id DESC LIMIT 1
) AS pr ON TRUE
"""

# Orders show as "R-1001" and up.
ORDER_NUMBER_OFFSET = 1000


def _card(row: dict[str, Any]) -> ProductCard:
    return ProductCard.model_validate(
        {key.removeprefix("card__"): row.pop(key) for key in list(row) if key.startswith("card__")}
    )


class CartLine(NamedTuple):
    product: ProductCard
    quantity: int


class StockLevel(NamedTuple):
    in_stock: bool
    quantity: int | None


class ShoppingRepository:
    """Saved products, carts, and orders (migration 021), run on one request's connection.
    Every method takes the user it acts for; nothing reads another user's rows."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    # --- Saved ---

    def saved(self, user_id: UUID, product_id: int | None = None) -> list[SavedProduct]:
        """The user's saved products, newest first (or just this one)."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                SELECT s.saved_at,
                    EXISTS (SELECT 1 FROM cart_items AS c
                            WHERE c.user_id = s.user_id AND c.product_id = s.product_id) AS in_cart,
                    {_CARD_COLUMNS}
                FROM saved_products AS s
                JOIN products AS p ON p.id = s.product_id
                {_LATEST_PRICE}
                WHERE s.user_id = %(user_id)s
                  AND (%(product_id)s::integer IS NULL OR s.product_id = %(product_id)s)
                ORDER BY s.saved_at DESC, s.product_id DESC
                """,
                {"user_id": user_id, "product_id": product_id},
            )
            rows = cursor.fetchall()
        saved = []
        for row in rows:
            product = _card(row)  # takes the card__ columns, leaving saved_at and in_cart
            saved.append(SavedProduct(product=product, **row))
        return saved

    def save(self, user_id: UUID, product_id: int) -> None:
        self._connection.execute(
            "INSERT INTO saved_products (user_id, product_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (user_id, product_id),
        )

    def unsave(self, user_id: UUID, product_id: int) -> None:
        self._connection.execute(
            "DELETE FROM saved_products WHERE user_id = %s AND product_id = %s",
            (user_id, product_id),
        )

    # --- Cart ---

    def cart_lines(self, user_id: UUID, *, lock: bool = False) -> list[CartLine]:
        """What's in the cart, in the order it was added. With lock, the cart's rows stay locked
        until the request ends, so placing an order twice at once can't use them twice."""
        if lock:
            self._connection.execute(
                "SELECT 1 FROM cart_items WHERE user_id = %s FOR UPDATE", (user_id,)
            )
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"""
                SELECT c.quantity, {_CARD_COLUMNS}
                FROM cart_items AS c
                JOIN products AS p ON p.id = c.product_id
                {_LATEST_PRICE}
                WHERE c.user_id = %s
                ORDER BY c.added_at, c.product_id
                """,
                (user_id,),
            )
            rows = cursor.fetchall()
        return [CartLine(_card(row), row["quantity"]) for row in rows]

    def cart(self, user_id: UUID) -> Cart:
        lines = self.cart_lines(user_id)
        items = [
            CartItem(
                product=line.product,
                quantity=line.quantity,
                line_total=(
                    line.product.price * line.quantity if line.product.price is not None else None
                ),
            )
            for line in lines
        ]
        priced = [item.line_total for item in items if item.line_total is not None]
        return Cart(
            items=items,
            item_count=sum(item.quantity for item in items),
            subtotal=sum(priced, Decimal("0.00")) if items else None,
            unpriced_items=sum(item.line_total is None for item in items),
        )

    def add_to_cart(self, user_id: UUID, product_id: int, quantity: int) -> None:
        """Add to what's there, up to MAX_QUANTITY."""
        self._connection.execute(
            "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (%s, %s, %s) "
            "ON CONFLICT (user_id, product_id) DO UPDATE "
            f"SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, {MAX_QUANTITY})",
            (user_id, product_id, quantity),
        )

    def set_in_cart(self, user_id: UUID, product_id: int, quantity: int) -> None:
        self._connection.execute(
            "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (%s, %s, %s) "
            "ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity",
            (user_id, product_id, quantity),
        )

    def remove_from_cart(self, user_id: UUID, product_id: int) -> bool:
        cursor = self._connection.execute(
            "DELETE FROM cart_items WHERE user_id = %s AND product_id = %s",
            (user_id, product_id),
        )
        return cursor.rowcount > 0

    def empty_cart(self, user_id: UUID, product_ids: list[int] | None = None) -> None:
        """Empty the cart, or with product_ids take just those out (what an order used, so
        anything added from another device meanwhile stays)."""
        if product_ids is None:
            self._connection.execute("DELETE FROM cart_items WHERE user_id = %s", (user_id,))
        else:
            self._connection.execute(
                "DELETE FROM cart_items WHERE user_id = %s AND product_id = ANY(%s)",
                (user_id, product_ids),
            )

    # --- Stock, for the checkout ---

    def stock_levels(self, product_ids: list[int]) -> dict[tuple[int, int], StockLevel]:
        """Each of these products' stock at every store that has a record, by (store, product)."""
        if not product_ids:
            return {}
        rows = self._connection.execute(
            "SELECT store_id, product_id, in_stock, quantity FROM product_stock "
            "WHERE product_id = ANY(%s)",
            (product_ids,),
        ).fetchall()
        return {
            (store, product): StockLevel(in_stock, qty) for store, product, in_stock, qty in rows
        }

    # --- Orders ---

    def create_order(
        self,
        user_id: UUID,
        store_id: int,
        store_name: str,
        fulfillment: str,
        delivery_address: str | None,
        contact_name: str | None,
        lines: list[CartLine],
    ) -> int:
        (order_id,) = self._connection.execute(
            "INSERT INTO orders (user_id, store_id, store_name, fulfillment, delivery_address, "
            "contact_name) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (user_id, store_id, store_name, fulfillment, delivery_address, contact_name),
        ).fetchone()
        with self._connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO order_items "
                "(order_id, product_id, product_name, quantity, unit_price) "
                "VALUES (%s, %s, %s, %s, %s)",
                [
                    (
                        order_id,
                        line.product.id,
                        line.product.name,
                        line.quantity,
                        line.product.price,
                    )
                    for line in lines
                ],
            )
        return order_id

    def orders(
        self, user_id: UUID, *, order_id: int | None = None, limit: int = 20, offset: int = 0
    ) -> list[Order]:
        """The user's orders, newest first (or just this one, if it's theirs)."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, store_id, store_name, fulfillment, delivery_address, contact_name,
                    status, placed_at
                FROM orders
                WHERE user_id = %(user_id)s AND (%(order_id)s::integer IS NULL OR id = %(order_id)s)
                ORDER BY placed_at DESC, id DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                {"user_id": user_id, "order_id": order_id, "limit": limit, "offset": offset},
            )
            orders = cursor.fetchall()
            cursor.execute(
                "SELECT order_id, product_id, product_name AS name, quantity, unit_price "
                "FROM order_items WHERE order_id = ANY(%s) ORDER BY order_id, id",
                ([order["id"] for order in orders],),
            )
            items: dict[int, list[OrderItem]] = {}
            for row in cursor.fetchall():
                items.setdefault(row.pop("order_id"), []).append(OrderItem.model_validate(row))
        return [_order(order, items.get(order["id"], [])) for order in orders]


def _order(row: dict[str, Any], items: list[OrderItem]) -> Order:
    prices = [item.unit_price * item.quantity for item in items if item.unit_price is not None]
    placed_at: datetime = row["placed_at"]
    return Order(
        id=row["id"],
        number=f"R-{ORDER_NUMBER_OFFSET + row['id']}",
        store=OrderStore(id=row["store_id"], name=row["store_name"]),
        fulfillment=row["fulfillment"],
        delivery_address=row["delivery_address"],
        contact_name=row["contact_name"],
        status=row["status"],
        placed_at=placed_at,
        items=items,
        item_count=sum(item.quantity for item in items),
        total=sum(prices, Decimal("0.00")) if prices else None,
    )


def get_shopping_repository(db: DbConnection) -> ShoppingRepository:
    return ShoppingRepository(db)


# Use as a route parameter: def get_cart(shopping: Shopping) -> ...
Shopping = Annotated[ShoppingRepository, Depends(get_shopping_repository)]
