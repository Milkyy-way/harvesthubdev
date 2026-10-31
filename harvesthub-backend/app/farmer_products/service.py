import uuid
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.categories.models import Category
from app.products.models import Product
from app.cart.models import CartItem
from app.farmer_products.schemas import FarmerProductCreate, FarmerProductUpdate


def _out(product: Product, category: Category) -> dict:
    return {
        "id": str(product.id),
        "name": product.name,
        "description": product.description,
        "category_slug": category.slug,
        "category_name": category.name,
        "price": float(product.price),
        "unit": product.unit,
        "quantity_available": product.quantity_available,
        "image_url": product.image_url,
        "tax_category": product.tax_category,
        "keep_cold": bool(product.keep_cold),
        "is_active": product.is_active,
    }


def _category_or_422(db: Session, slug: str) -> Category:
    category = db.query(Category).filter(Category.slug == slug).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown category")
    return category


def _owned_product_or_404(db: Session, farmer_id, product_id: str) -> Product:
    try:
        pid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    product = db.query(Product).filter(Product.id == pid, Product.farmer_id == farmer_id).first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def _validate_image_url(url: str, farmer_id) -> None:
    """Only a photo the farmer uploaded into their OWN products folder of the
    public farmer-photos bucket (see 0024) — never an arbitrary URL, which
    every customer's app would otherwise load."""
    prefix = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/public/farmer-photos/{farmer_id}/products/"
    if not url.startswith(prefix):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid product photo")


def list_products(db: Session, farmer_id) -> list[dict]:
    """Every product the farmer owns, hidden ones included — visible first,
    then alphabetical (same case-insensitive ordering as the customer-facing
    product list)."""
    rows = (
        db.query(Product, Category)
        .join(Category, Category.id == Product.category_id)
        .filter(Product.farmer_id == farmer_id)
        .order_by(Product.is_active.desc(), func.lower(Product.name))
        .all()
    )
    return [_out(p, c) for p, c in rows]


def get_product(db: Session, farmer_id, product_id: str) -> dict:
    product = _owned_product_or_404(db, farmer_id, product_id)
    category = db.query(Category).filter(Category.id == product.category_id).one()
    return _out(product, category)


def create_product(db: Session, farmer_id, payload: FarmerProductCreate) -> dict:
    category = _category_or_422(db, payload.category_slug)
    product = Product(
        id=uuid.uuid4(),
        farmer_id=farmer_id,
        category_id=category.id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        price=round(payload.price, 2),
        unit=payload.unit.strip(),
        quantity_available=payload.quantity_available,
        tax_category=payload.tax_category,
        keep_cold=payload.keep_cold,
        is_active=payload.is_active,
    )
    db.add(product)
    db.commit()
    return _out(product, category)


def update_product(db: Session, farmer_id, product_id: str, payload: FarmerProductUpdate) -> dict:
    """Price and stock changes go live immediately (no draft state, per the
    plan) — the customer app always reads products fresh, and checkout
    re-prices from the products table, so nobody is charged a stale price."""
    product = _owned_product_or_404(db, farmer_id, product_id)
    data = payload.model_dump(exclude_unset=True)

    # A null sent for a required field means "no change", not "erase it".
    if data.get("category_slug") is not None:
        product.category_id = _category_or_422(db, data["category_slug"]).id
    if data.get("name") is not None:
        product.name = data["name"].strip()
    if "description" in data:
        product.description = (data["description"] or "").strip() or None
    if data.get("price") is not None:
        product.price = round(data["price"], 2)
    if data.get("unit") is not None:
        product.unit = data["unit"].strip()
    if data.get("quantity_available") is not None:
        product.quantity_available = data["quantity_available"]
    if data.get("tax_category") is not None:
        product.tax_category = data["tax_category"]
    if data.get("keep_cold") is not None:
        product.keep_cold = data["keep_cold"]
    if "image_url" in data:
        if data["image_url"] is not None:
            _validate_image_url(data["image_url"], farmer_id)
        product.image_url = data["image_url"]
    if data.get("is_active") is not None:
        if product.is_active and not data["is_active"]:
            # A hidden product can't be bought — take it out of every
            # customer's cart now rather than leaving it to fail at checkout.
            db.query(CartItem).filter(CartItem.product_id == product.id).delete()
        product.is_active = data["is_active"]

    db.commit()
    category = db.query(Category).filter(Category.id == product.category_id).one()
    return _out(product, category)
