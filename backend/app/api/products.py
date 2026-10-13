from fastapi import APIRouter, HTTPException

from app.repositories import Products
from app.schemas import ProductCreate, ProductRead

router = APIRouter(prefix="/products", tags=["products"])


@router.post("/validate")
def validate_product(product: ProductCreate) -> ProductCreate:
    """Dry run: check a product payload without saving it.

    Returns the cleaned-up product (whitespace trimmed) if it's valid, or 422 with every problem
    if not. Nothing is stored; creating products is added with the database (T017/T087).
    """
    return product


# ":int" makes this route match digits only, so /products/abc is a 404 (not a 422) and named
# routes like /products/search or /products/barcode/... never get mistaken for an ID.
@router.get("/{product_id:int}", responses={404: {"description": "No product with this ID"}})
def get_product(product_id: int, products: Products) -> ProductRead:
    """A product with its name, photo URL, category, and current price."""
    product = products.get_by_id(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/barcode/{code}", responses={404: {"description": "No product with this barcode"}})
def get_product_by_barcode(code: str, products: Products) -> ProductRead:
    """The product with this UPC/EAN barcode (e.g. 036000291452), as returned by GET /{id}.

    The code must match the stored barcode exactly. The app sends what the scanner read, already
    normalized (UPC-E expanded to UPC-A, iOS's leading 0 removed). Anything that isn't a stored
    barcode, including codes that aren't 8, 12, 13, or 14 digits, is a 404.
    """
    product = products.get_by_barcode(code)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product
