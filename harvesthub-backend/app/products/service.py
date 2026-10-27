from collections import defaultdict
from datetime import datetime, timedelta, timezone
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.core.geo import haversine_km
from app.categories.models import Category
from app.products.models import Product
from app.cart.models import CartItem
from app.farmers.models import FarmerProfile
from app.farmers.service import get_or_geocode_farmer
from app.orders.models import StoreOrder, StoreOrderItem

# "This week's harvest" is deliberately algorithmic, not farmer-set — no
# farmer-facing product editor exists yet to let a farmer pick these
# themselves. Both constants below are placeholders, easy to retune.
_HARVEST_CANDIDATE_FARMER_COUNT = 12  # nearest N farmers considered at all
_JUST_PICKED_WINDOW_DAYS = 14
# Mirrors the frontend's ProductCard.tsx LOW_STOCK_THRESHOLD — keep these
# two in sync if either changes.
_LOW_STOCK_THRESHOLD = 11
_KEPT_STORE_ORDER_STATUSES = ("paid", "ready_for_pickup", "out_for_delivery", "completed")


def list_products_for_farmer(
    db: Session,
    farmer_id: str,
    category_slug: str | None,
    customer_id: str,
) -> list[dict]:
    """Active products for one farm, alphabetical by name. Joined against
    Profile so a suspended/unapproved farmer's products don't leak through
    a direct farmer_id query — same visibility rule as the feed and the
    farmer detail endpoint (see app/farmers/service.py)."""
    q = (
        db.query(Product, Category)
        .join(Category, Category.id == Product.category_id)
        .join(Profile, Profile.id == Product.farmer_id)
        .filter(
            Product.farmer_id == farmer_id,
            Product.is_active.is_(True),
            Profile.role == "farmer",
            Profile.status == "active",
        )
    )
    if category_slug:
        q = q.filter(Category.slug == category_slug)

    rows = q.order_by(func.lower(Product.name)).all()
    if not rows:
        return []

    product_ids = [p.id for p, _ in rows]
    cart_rows = (
        db.query(CartItem.product_id, CartItem.quantity)
        .filter(CartItem.customer_id == customer_id, CartItem.product_id.in_(product_ids))
        .all()
    )
    cart_by_product = {str(pid): qty for pid, qty in cart_rows}

    return [
        {
            "id": str(p.id),
            "farmer_id": str(p.farmer_id),
            "category_id": str(p.category_id),
            "category_slug": c.slug,
            "category_name": c.name,
            "name": p.name,
            "description": p.description,
            "price": float(p.price),
            "unit": p.unit,
            "quantity_available": p.quantity_available,
            "image_url": p.image_url,
            "cart_quantity": cart_by_product.get(str(p.id), 0),
        }
        for p, c in rows
    ]


def get_harvest_picks(db: Session, customer_lat: float, customer_lon: float, limit: int) -> list[dict]:
    """'This week's harvest' — nearby, in-stock products with an
    algorithmically-derived badge (favorite/limited/just-picked), not a
    farmer-curated list (see the module header comment). Plain Python
    aggregation over a few targeted queries, matching this codebase's
    established lightweight style at this scale (same reasoning as the
    dashboard summary's in-process aggregation)."""
    farmers = (
        db.query(FarmerProfile)
        .join(Profile, Profile.id == FarmerProfile.id)
        .filter(Profile.role == "farmer", Profile.status == "active")
        .all()
    )
    if not farmers:
        return []

    with_distance = []
    for farmer in farmers:
        if farmer.latitude is None or farmer.longitude is None:
            farmer = get_or_geocode_farmer(db, farmer.id)
            if farmer is None or farmer.latitude is None:
                continue
        distance = haversine_km(customer_lat, customer_lon, farmer.latitude, farmer.longitude)
        with_distance.append((farmer, distance))

    with_distance.sort(key=lambda fd: fd[1])
    candidates = with_distance[:_HARVEST_CANDIDATE_FARMER_COUNT]
    if not candidates:
        return []

    farmer_by_id = {f.id: f for f, _ in candidates}
    distance_by_farmer = {f.id: d for f, d in candidates}
    farmer_ids = list(farmer_by_id.keys())

    products = (
        db.query(Product)
        .filter(Product.farmer_id.in_(farmer_ids), Product.is_active.is_(True), Product.quantity_available > 0)
        .all()
    )
    if not products:
        return []

    # "Farmer favorite" — each candidate farmer's single most-ordered
    # product, from real (paid/completed) order history.
    item_rows = (
        db.query(StoreOrder.farmer_id, StoreOrderItem.product_id, func.sum(StoreOrderItem.quantity))
        .join(StoreOrderItem, StoreOrderItem.store_order_id == StoreOrder.id)
        .filter(StoreOrder.farmer_id.in_(farmer_ids), StoreOrder.status.in_(_KEPT_STORE_ORDER_STATUSES))
        .group_by(StoreOrder.farmer_id, StoreOrderItem.product_id)
        .all()
    )
    qty_by_farmer_product: dict = defaultdict(dict)
    for farmer_id, product_id, qty in item_rows:
        if product_id:
            qty_by_farmer_product[farmer_id][product_id] = qty
    favorite_product_by_farmer = {
        farmer_id: max(products_qty.items(), key=lambda kv: kv[1])[0]
        for farmer_id, products_qty in qty_by_farmer_product.items()
        if products_qty
    }

    just_picked_cutoff = datetime.now(timezone.utc) - timedelta(days=_JUST_PICKED_WINDOW_DAYS)

    results = []
    for product in products:
        farmer = farmer_by_id[product.farmer_id]
        created_at = product.created_at
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        # One badge per card, in this priority order — an arbitrary but
        # explicit choice (favorite > limited > just-picked), not hidden.
        if favorite_product_by_farmer.get(product.farmer_id) == product.id:
            tag = "farmer_favorite"
        elif 0 < product.quantity_available < _LOW_STOCK_THRESHOLD:
            tag = "limited"
        elif created_at is not None and created_at >= just_picked_cutoff:
            tag = "just_picked"
        else:
            tag = None

        results.append(
            {
                "id": str(product.id),
                "name": product.name,
                "price": float(product.price),
                "unit": product.unit,
                "image_url": product.image_url,
                "farmer_id": str(product.farmer_id),
                "farm_name": farmer.farm_name,
                "distance_km": round(distance_by_farmer[product.farmer_id], 2),
                "tag": tag,
                "_has_tag": tag is not None,
            }
        )

    # Tagged items surface first (still nearest-first within that group),
    # then untagged nearby items fill any remaining slots.
    results.sort(key=lambda r: (not r["_has_tag"], r["distance_km"]))
    for r in results:
        del r["_has_tag"]
    return results[:limit]
