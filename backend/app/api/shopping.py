"""Saved products, the shopping cart, and a demo checkout (migration 021).

Everything here is the signed-in user's own (GET /me/...): 401 without a valid token. The
checkout is a demo: no payment is taken, nothing is delivered, and placing an order doesn't
change stock. What it does check is whether the chosen store has everything in stock
(GET /me/cart/check), again when the order is placed, so a product that sold out meanwhile is
caught (409 items_unavailable).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status

from app.core.auth import CurrentUser
from app.core.errors import ApiError, error_response
from app.repositories import Stores
from app.repositories.shopping import CartLine, Shopping, StockLevel
from app.schemas.shopping import (
    Availability,
    Cart,
    CartAdd,
    CartCheck,
    CartSet,
    CheckItem,
    Order,
    OrderCreate,
    SavedProduct,
    StoreOption,
)
from app.schemas.store import StoreRead

MAX_ORDERS_PER_PAGE = 50

router = APIRouter(
    prefix="/me",
    tags=["shopping"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        422: error_response("Invalid request; details lists each problem"),
    },
)

_NOT_FOUND: dict[int | str, dict[str, Any]] = {404: error_response("No product with this ID")}


def _product(stores: Stores, product_id: int) -> None:
    if not stores.product_exists(product_id):
        raise ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


def _store(stores: Stores, store_id: int) -> StoreRead:
    store = stores.get_store(store_id)
    if store is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "store_not_found", "Store not found")
    return store


def availability(level: StockLevel | None, wanted: int) -> tuple[Availability, int | None]:
    """Whether a store can fill one cart line: its status, and for "limited", how many it has.
    A known quantity smaller than wanted is limited; an unknown one that's in stock is enough."""
    if level is None or not level.in_stock:
        return "unavailable", None
    if level.quantity is not None and level.quantity < wanted:
        return "limited", level.quantity
    return "available", None


def _check(
    lines: list[CartLine], store: StoreRead, all_stores: list[StoreRead], shopping: Shopping
) -> CartCheck:
    levels = shopping.stock_levels([line.product.id for line in lines])
    items = []
    for line in lines:
        state, available = availability(levels.get((store.id, line.product.id)), line.quantity)
        items.append(
            CheckItem(
                product=line.product,
                quantity=line.quantity,
                status=state,
                available_quantity=available,
            )
        )
    options = [
        StoreOption(
            store=option,
            available_items=sum(
                availability(levels.get((option.id, line.product.id)), line.quantity)[0]
                == "available"
                for line in lines
            ),
            total_items=len(lines),
        )
        for option in all_stores
    ]
    options.sort(
        key=lambda o: (o.available_items < o.total_items, -o.available_items, o.store.name)
    )
    return CartCheck(
        store=store,
        all_available=all(item.status == "available" for item in items),
        items=items,
        stores=options,
    )


def _cart_empty() -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, "cart_empty", "Your cart is empty.")


# --- Saved ---


@router.get("/saved")
def list_saved(user: CurrentUser, shopping: Shopping) -> list[SavedProduct]:
    """The products you saved for later, newest first."""
    return shopping.saved(user.id)


@router.get("/saved/{product_id:int}", responses={404: error_response("Not saved")})
def get_saved(product_id: int, user: CurrentUser, shopping: Shopping) -> SavedProduct:
    """This product, if you saved it (404 not_saved otherwise): for the product page's Save
    button."""
    found = shopping.saved(user.id, product_id)
    if not found:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_saved", "You haven't saved this product.")
    return found[0]


@router.put("/saved/{product_id:int}", responses=_NOT_FOUND)
def save_product(
    product_id: int, user: CurrentUser, stores: Stores, shopping: Shopping
) -> SavedProduct:
    """Save a product for later. Saving it again changes nothing."""
    _product(stores, product_id)
    shopping.save(user.id, product_id)
    return shopping.saved(user.id, product_id)[0]


@router.delete("/saved/{product_id:int}", status_code=status.HTTP_204_NO_CONTENT)
def unsave_product(product_id: int, user: CurrentUser, shopping: Shopping) -> Response:
    """Stop saving a product. 204 whether or not it was saved."""
    shopping.unsave(user.id, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Cart ---


@router.get("/cart")
def get_cart(user: CurrentUser, shopping: Shopping) -> Cart:
    """What's in your cart, with prices and a subtotal."""
    return shopping.cart(user.id)


@router.post("/cart/{product_id:int}", responses=_NOT_FOUND)
def add_to_cart(
    product_id: int,
    user: CurrentUser,
    stores: Stores,
    shopping: Shopping,
    add: CartAdd | None = None,
) -> Cart:
    """Add a product (one, or {"quantity": n}) to what's in the cart, up to 99."""
    _product(stores, product_id)
    shopping.add_to_cart(user.id, product_id, (add or CartAdd()).quantity)
    return shopping.cart(user.id)


@router.put("/cart/{product_id:int}", responses=_NOT_FOUND)
def set_in_cart(
    product_id: int, change: CartSet, user: CurrentUser, stores: Stores, shopping: Shopping
) -> Cart:
    """Set how many of a product are in the cart (adding it if it isn't)."""
    _product(stores, product_id)
    shopping.set_in_cart(user.id, product_id, change.quantity)
    return shopping.cart(user.id)


@router.delete("/cart/{product_id:int}")
def remove_from_cart(product_id: int, user: CurrentUser, shopping: Shopping) -> Cart:
    """Take a product out of the cart. Fine if it wasn't there."""
    shopping.remove_from_cart(user.id, product_id)
    return shopping.cart(user.id)


@router.delete("/cart", status_code=status.HTTP_204_NO_CONTENT)
def empty_cart(user: CurrentUser, shopping: Shopping) -> Response:
    shopping.empty_cart(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/cart/{product_id:int}/save-for-later",
    responses={404: error_response("Not in the cart")},
)
def save_for_later(product_id: int, user: CurrentUser, shopping: Shopping) -> Cart:
    """Move a product from the cart to your saved products."""
    if not shopping.remove_from_cart(user.id, product_id):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_in_cart", "This product isn't in your cart.")
    shopping.save(user.id, product_id)
    return shopping.cart(user.id)


# --- Checkout (demo) ---


@router.get(
    "/cart/check",
    responses={404: error_response("No such store"), 409: error_response("The cart is empty")},
)
def check_cart(
    user: CurrentUser,
    stores: Stores,
    shopping: Shopping,
    store_id: Annotated[int, Query(ge=1, le=2**31 - 1)],
) -> CartCheck:
    """Whether this store has everything in your cart, line by line, and how every store
    compares, so the app can offer one that has it all."""
    store = _store(stores, store_id)
    lines = shopping.cart_lines(user.id)
    if not lines:
        raise _cart_empty()
    return _check(lines, store, stores.list_locations(), shopping)


@router.post(
    "/orders",
    status_code=status.HTTP_201_CREATED,
    responses={
        404: error_response("No such store"),
        409: error_response("The cart is empty, or the store no longer has everything"),
    },
)
def place_order(order: OrderCreate, user: CurrentUser, stores: Stores, shopping: Shopping) -> Order:
    """Place a demo order for everything in the cart, for pickup at the store or delivery from
    it. No payment is taken and stock isn't changed. The store must have everything in stock
    (409 items_unavailable: check again); the cart is emptied."""
    if order.fulfillment == "delivery" and order.delivery_address is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "delivery_address_required",
            "Add an address for delivery.",
        )
    if order.fulfillment == "pickup" and order.delivery_address is not None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "delivery_address_not_allowed",
            "Pickup orders don't take an address.",
        )
    store = _store(stores, order.store_id)
    lines = shopping.cart_lines(user.id, lock=True)
    if not lines:
        raise _cart_empty()
    if not _check(lines, store, [], shopping).all_available:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "items_unavailable",
            f"{store.name} no longer has everything in your cart. Check your cart again.",
        )
    order_id = shopping.create_order(
        user.id,
        store.id,
        store.name,
        order.fulfillment,
        order.delivery_address,
        order.contact_name,
        lines,
    )
    shopping.empty_cart(user.id, [line.product.id for line in lines])
    return shopping.orders(user.id, order_id=order_id)[0]


@router.get("/orders")
def list_orders(
    user: CurrentUser,
    shopping: Shopping,
    limit: Annotated[int, Query(ge=1, le=MAX_ORDERS_PER_PAGE)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> list[Order]:
    """Your orders, newest first."""
    return shopping.orders(user.id, limit=limit, offset=offset)


@router.get("/orders/{order_id:int}", responses={404: error_response("No such order of yours")})
def get_order(order_id: int, user: CurrentUser, shopping: Shopping) -> Order:
    """One of your orders (404 order_not_found for anyone else's)."""
    found = shopping.orders(user.id, order_id=order_id, limit=1)
    if not found:
        raise ApiError(status.HTTP_404_NOT_FOUND, "order_not_found", "Order not found")
    return found[0]
