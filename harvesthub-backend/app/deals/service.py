"""Threshold group deals: a farmer offers a lower price that unlocks only if
enough households join by a deadline (the two "Threshold" spec PDFs at the repo
root; where they disagree, the user chose on 2026-11-01).

This is the farmer's side: creating, publishing and changing a deal, with its
stock set aside so a regular shopper can't buy what the deal needs. Customers
joining, and charging at the deadline, come next. Until then a deal that reaches
its deadline simply expires and gives its stock back.
"""
import math
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.categories.models import Category
from app.core.pricing import FARMER_COMMISSION_RATE
from app.deals.models import OPEN_STATUSES, GroupDeal
from app.deals.schemas import DealChangeIn, DealIn
from app.delivery.models import FarmDeliverySettings, FarmDeliveryWindow
from app.orders.models import Order, StoreOrder
from app.products.models import Product

ET = ZoneInfo("America/New_York")

# Produce only at launch: no eggs, meat or dairy.
PRODUCE_SLUGS = ("vegetables", "fruits", "herbs")
MIN_DISCOUNT, MAX_DISCOUNT = Decimal("0.10"), Decimal("0.40")
SUGGESTED_MIN_DISCOUNT, SUGGESTED_MAX_DISCOUNT = Decimal("0.15"), Decimal("0.25")
MIN_GOAL = 5
MAX_UNITS_PER_HOUSEHOLD = 3
MIN_WINDOW_DAYS, MAX_WINDOW_DAYS = 3, 14
EARLY_ACCESS = timedelta(hours=24)
PUBLIC_OPEN_HOUR, DEADLINE_HOUR = 8, 20  # Eastern, every deal
MIN_FULFILLMENT_DAYS, MAX_FULFILLMENT_DAYS = 1, 10
MIN_SHARE_PRICE = Decimal("0.50")  # Stripe won't charge less

_CENT = Decimal("0.01")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dec(value) -> Decimal:
    return Decimal(str(value))


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _reserved(capacity: int, share_size) -> int:
    """Stock is counted in whole listing units, so a part-unit rounds up."""
    return math.ceil(_dec(capacity) * _dec(share_size))


def _payout(regular_price, deal_price, share_size, goal: int, capacity: int) -> dict:
    size = _dec(share_size)
    regular = _dec(regular_price)
    share = _money(_dec(deal_price) * size)
    regular_share = _money(regular * size)
    keep = Decimal("1") - _dec(FARMER_COMMISSION_RATE)
    return {
        "discount_percent": float(((regular - _dec(deal_price)) / regular * 100).quantize(Decimal("0.1"))) if regular else 0.0,
        "regular_share_price": float(regular_share),
        "share_price": float(share),
        "commission_rate": FARMER_COMMISSION_RATE,
        "net_per_share": float(_money(share * keep)),
        "net_at_goal": float(_money(share * goal * keep)),
        "net_at_capacity": float(_money(share * capacity * keep)),
        "regular_net_at_goal": float(_money(regular_share * goal * keep)),
        "reserved_quantity": _reserved(capacity, share_size),
    }


def _times(public_start_date: date | None, window_days: int, now: datetime) -> tuple[datetime, datetime, datetime]:
    """Members get the first 24 hours, whichever way it starts. The deadline is
    always 8 pm Eastern."""
    if public_start_date is None:
        member, public = now, now + EARLY_ACCESS
    else:
        public = datetime.combine(public_start_date, time(PUBLIC_OPEN_HOUR), ET).astimezone(timezone.utc)
        member = public - EARLY_ACCESS
    last_day = public.astimezone(ET).date() + timedelta(days=window_days)
    return member, public, datetime.combine(last_day, time(DEADLINE_HOUR), ET).astimezone(timezone.utc)


def _delivery_weekdays(db: Session, farmer_id) -> set[int]:
    settings = db.get(FarmDeliverySettings, farmer_id)
    if settings is None or not settings.offers_delivery:
        return set()
    return {w for (w,) in db.query(FarmDeliveryWindow.weekday).filter(FarmDeliveryWindow.farmer_id == farmer_id)}


def _suggested_fulfillment(weekdays: set[int], deadline: datetime) -> date:
    """The next delivery day after the deadline, or two days after if the farm
    doesn't deliver."""
    last_day = deadline.astimezone(ET).date()
    for offset in range(MIN_FULFILLMENT_DAYS, MAX_FULFILLMENT_DAYS + 1):
        day = last_day + timedelta(days=offset)
        if day.weekday() in weekdays:
            return day
    return last_day + timedelta(days=2)


def _avg_weekly_households(db: Session, farmer_id) -> int:
    """Customers a week over the last four weeks, to judge a goal against."""
    since = datetime.utcnow() - timedelta(days=28)
    customer_weeks = (
        db.query(Order.customer_id, func.date_trunc("week", StoreOrder.created_at))
        .join(StoreOrder, StoreOrder.order_id == Order.id)
        .filter(
            StoreOrder.farmer_id == farmer_id,
            StoreOrder.created_at >= since,
            StoreOrder.status.notin_(("pending_payment", "cancelled")),
        )
        .distinct()
        .count()
    )
    return round(customer_weeks / 4)


def evaluate(db: Session, farmer_id, product: Product, payload: DealIn, now: datetime) -> dict:
    """The rules, in one place. Errors block publishing; warnings don't."""
    errors: list[str] = []
    warnings: list[str] = []

    category = db.get(Category, product.category_id)
    if category is None or category.slug not in PRODUCE_SLUGS:
        errors.append("Group deals are for vegetables, fruits and herbs for now.")
    if not product.is_active:
        errors.append("This product is hidden. Show it again to run a deal on it.")

    regular, deal_price = _dec(product.price), _dec(payload.deal_price)
    discount = (regular - deal_price) / regular if regular else Decimal("0")
    in_band = MIN_DISCOUNT <= discount <= MAX_DISCOUNT
    if not in_band:
        errors.append("The deal price must be 10–40% below the regular price.")
    elif not SUGGESTED_MIN_DISCOUNT <= discount <= SUGGESTED_MAX_DISCOUNT:
        warnings.append("Most deals work best at 15–25% off.")
    payout = _payout(product.price, payload.deal_price, payload.share_size, payload.goal, payload.capacity)
    if _dec(payout["share_price"]) < MIN_SHARE_PRICE:
        errors.append(f"A share must cost at least ${MIN_SHARE_PRICE}.")

    if payload.goal < MIN_GOAL:
        errors.append(f"The goal must be at least {MIN_GOAL} households.")
    if payload.capacity < payload.goal:
        errors.append("You need enough shares for every household in the goal.")
    elif payload.capacity == payload.goal:
        warnings.append("The deal will fill exactly at its goal and close to everyone else.")
    if not 1 <= payload.max_units <= MAX_UNITS_PER_HOUSEHOLD:
        errors.append(f"A household can claim 1 to {MAX_UNITS_PER_HOUSEHOLD} shares.")
    if payout["reserved_quantity"] > product.quantity_available:
        errors.append(
            f"This deal needs {payout['reserved_quantity']} {product.unit} set aside, "
            f"and you have {product.quantity_available} in stock."
        )

    member, public, deadline = _times(payload.public_start_date, payload.window_days, now)
    if not MIN_WINDOW_DAYS <= payload.window_days <= MAX_WINDOW_DAYS:
        errors.append(f"A deal runs for {MIN_WINDOW_DAYS} to {MAX_WINDOW_DAYS} days.")
    if payload.public_start_date is not None and member < now:
        errors.append("Pick a later start: members need a full day first.")

    weekdays = _delivery_weekdays(db, farmer_id)
    fulfillment = payload.fulfillment_date or _suggested_fulfillment(weekdays, deadline)
    days_after = (fulfillment - deadline.astimezone(ET).date()).days
    if not MIN_FULFILLMENT_DAYS <= days_after <= MAX_FULFILLMENT_DAYS:
        errors.append(f"Customers must get their order {MIN_FULFILLMENT_DAYS} to {MAX_FULFILLMENT_DAYS} days after the deadline.")
    elif weekdays and fulfillment.weekday() not in weekdays:
        warnings.append("You don't deliver that day, so customers could only pick up.")

    average = _avg_weekly_households(db, farmer_id)
    if payload.goal > 1.5 * average:
        warnings.append(
            f"That's well above your usual {average} households a week."
            if average
            else "You don't have recent orders to compare with, so a smaller goal is safer."
        )

    return {
        "errors": errors,
        "warnings": warnings,
        "payout": payout,
        "member_opens_at": member,
        "public_opens_at": public,
        "deadline_at": deadline,
        "fulfillment_date": fulfillment,
    }


def current_status(deal: GroupDeal, now: datetime) -> str:
    """Where the clock says a published deal is, between job runs."""
    if deal.status not in OPEN_STATUSES:
        return deal.status
    if now >= deal.deadline_at:
        return "expired"
    if now >= deal.public_opens_at:
        return "live"
    if now >= deal.member_opens_at:
        return "early_access"
    return "scheduled"


def _share_label(share_size, unit: str) -> str:
    # A listing sold as "5 lb box" already says what one share is.
    if _dec(share_size) == 1 and unit[:1].isdigit():
        return unit
    return f"{float(share_size):g} {unit}"


def _out(deal: GroupDeal, product: Product, now: datetime) -> dict:
    return {
        "id": str(deal.id),
        "status": current_status(deal, now),
        "product_id": str(deal.product_id),
        "product_name": product.name,
        "image_url": product.image_url,
        "unit": deal.unit,
        "share_size": float(deal.share_size),
        "share_label": _share_label(deal.share_size, deal.unit),
        "regular_price": float(deal.regular_price),
        "deal_price": float(deal.deal_price),
        "goal": deal.goal,
        "capacity": deal.capacity,
        "max_units": deal.max_units,
        "subscriber_fallback": deal.subscriber_fallback,
        "public_start_date": deal.public_start_date,
        "window_days": deal.window_days,
        "fulfillment_date": deal.fulfillment_date,
        "member_opens_at": deal.member_opens_at.isoformat() if deal.member_opens_at else None,
        "public_opens_at": deal.public_opens_at.isoformat() if deal.public_opens_at else None,
        "deadline_at": deal.deadline_at.isoformat() if deal.deadline_at else None,
        "reserved_quantity": deal.reserved_quantity,
        "cancel_reason": deal.cancel_reason,
        "payout": _payout(deal.regular_price, deal.deal_price, deal.share_size, deal.goal, deal.capacity),
    }


def _owned_product(db: Session, farmer_id, product_id, lock: bool = False) -> Product:
    try:
        pid = uuid.UUID(str(product_id))
    except ValueError:
        raise _invalid("Pick one of your products.")
    query = db.query(Product).filter(Product.id == pid, Product.farmer_id == farmer_id)
    product = (query.with_for_update() if lock else query).first()
    if product is None:
        raise _invalid("Pick one of your products.")
    return product


def _owned_deal(db: Session, farmer_id, deal_id: str, lock: bool = False) -> GroupDeal:
    try:
        did = uuid.UUID(deal_id)
    except ValueError:
        raise _not_found()
    query = db.query(GroupDeal).filter(GroupDeal.id == did, GroupDeal.farmer_id == farmer_id)
    deal = (query.with_for_update() if lock else query).first()
    if deal is None:
        raise _not_found()
    return deal


def _give_stock_back(db: Session, deal: GroupDeal) -> None:
    if deal.reserved_quantity:
        product = db.query(Product).filter(Product.id == deal.product_id).with_for_update().first()
        if product is not None:
            product.quantity_available += deal.reserved_quantity
        deal.reserved_quantity = 0


def _advance(db: Session, deal: GroupDeal, now: datetime) -> bool:
    """Bring a locked deal up to date with the clock. True if it changed."""
    target = current_status(deal, now)
    if target == deal.status:
        return False
    deal.status = target
    if target == "expired":
        _give_stock_back(db, deal)
    return True


def setup(db: Session, farmer_id) -> dict:
    rows = (
        db.query(Product, Category)
        .join(Category, Category.id == Product.category_id)
        .filter(Product.farmer_id == farmer_id, Product.is_active.is_(True))
        .order_by(func.lower(Product.name))
        .all()
    )
    listings = [p for p, c in rows if c.slug in PRODUCE_SLUGS]
    average = _avg_weekly_households(db, farmer_id)
    return {
        "listings": [
            {
                "id": str(p.id),
                "name": p.name,
                "price": float(p.price),
                "unit": p.unit,
                "quantity_available": p.quantity_available,
                "image_url": p.image_url,
            }
            for p in listings
        ],
        "avg_weekly_households": average,
        "suggested_goal": max(MIN_GOAL, math.ceil(average * 1.1)),
        "has_other_products": len(rows) > len(listings),
    }


def preview(db: Session, farmer_id, payload: DealIn) -> dict:
    product = _owned_product(db, farmer_id, payload.product_id)
    result = evaluate(db, farmer_id, product, payload, _now())
    return {
        **result,
        "member_opens_at": result["member_opens_at"].isoformat(),
        "public_opens_at": result["public_opens_at"].isoformat(),
        "deadline_at": result["deadline_at"].isoformat(),
    }


def _apply_draft(deal: GroupDeal, product: Product, payload: DealIn) -> None:
    deal.product_id = product.id
    deal.unit = product.unit
    deal.regular_price = product.price
    deal.share_size = round(payload.share_size, 2)
    deal.deal_price = round(payload.deal_price, 2)
    deal.goal = payload.goal
    deal.capacity = payload.capacity
    deal.max_units = payload.max_units
    deal.public_start_date = payload.public_start_date
    deal.window_days = payload.window_days
    deal.fulfillment_date = payload.fulfillment_date
    deal.subscriber_fallback = payload.subscriber_fallback


def create_draft(db: Session, farmer_id, payload: DealIn) -> dict:
    product = _owned_product(db, farmer_id, payload.product_id)
    deal = GroupDeal(id=uuid.uuid4(), farmer_id=farmer_id, status="draft")
    _apply_draft(deal, product, payload)
    db.add(deal)
    db.commit()
    return _out(deal, product, _now())


def _draft_or_409(deal: GroupDeal) -> None:
    if deal.status != "draft":
        raise _conflict("This deal is already published.")


def update_draft(db: Session, farmer_id, deal_id: str, payload: DealIn) -> dict:
    deal = _owned_deal(db, farmer_id, deal_id, lock=True)
    _draft_or_409(deal)
    product = _owned_product(db, farmer_id, payload.product_id)
    _apply_draft(deal, product, payload)
    db.commit()
    return _out(deal, product, _now())


def delete_draft(db: Session, farmer_id, deal_id: str) -> None:
    deal = _owned_deal(db, farmer_id, deal_id, lock=True)
    _draft_or_409(deal)
    db.delete(deal)
    db.commit()


def list_deals(db: Session, farmer_id) -> list[dict]:
    now = _now()
    rows = (
        db.query(GroupDeal, Product)
        .join(Product, Product.id == GroupDeal.product_id)
        .filter(GroupDeal.farmer_id == farmer_id)
        .order_by(GroupDeal.created_at.desc())
        .all()
    )
    return [_out(deal, product, now) for deal, product in rows]


def get_deal(db: Session, farmer_id, deal_id: str) -> dict:
    deal = _owned_deal(db, farmer_id, deal_id)
    return _out(deal, db.get(Product, deal.product_id), _now())


def publish(db: Session, farmer_id, deal_id: str) -> dict:
    now = _now()
    deal = _owned_deal(db, farmer_id, deal_id, lock=True)
    _draft_or_409(deal)
    product = _owned_product(db, farmer_id, deal.product_id, lock=True)
    payload = DealIn(
        product_id=str(deal.product_id),
        share_size=float(deal.share_size),
        deal_price=float(deal.deal_price),
        goal=deal.goal,
        capacity=deal.capacity,
        max_units=deal.max_units,
        public_start_date=deal.public_start_date,
        window_days=deal.window_days,
        fulfillment_date=deal.fulfillment_date,
        subscriber_fallback=deal.subscriber_fallback,
    )
    result = evaluate(db, farmer_id, product, payload, now)
    if result["errors"]:
        raise _invalid(" ".join(result["errors"]))

    # Price and unit freeze here, so every household sees the same terms.
    deal.unit = product.unit
    deal.regular_price = product.price
    deal.member_opens_at = result["member_opens_at"]
    deal.public_opens_at = result["public_opens_at"]
    deal.deadline_at = result["deadline_at"]
    deal.fulfillment_date = result["fulfillment_date"]
    deal.reserved_quantity = result["payout"]["reserved_quantity"]
    product.quantity_available -= deal.reserved_quantity
    deal.published_at = now
    deal.status = "scheduled"
    deal.status = current_status(deal, now)
    db.commit()
    return _out(deal, product, now)


def change_published(db: Session, farmer_id, deal_id: str, payload: DealChangeIn) -> dict:
    """Only in shoppers' favor: a lower price, a lower goal, or more shares."""
    now = _now()
    deal = _owned_deal(db, farmer_id, deal_id, lock=True)
    _advance(db, deal, now)
    if deal.status not in OPEN_STATUSES:
        db.commit()
        raise _conflict("This deal has ended.")
    product = _owned_product(db, farmer_id, deal.product_id, lock=True)

    if payload.deal_price is not None:
        new_price = _dec(round(payload.deal_price, 2))
        if new_price > deal.deal_price:
            raise _invalid("You can lower the deal price, but not raise it.")
        if (deal.regular_price - new_price) / deal.regular_price > MAX_DISCOUNT:
            raise _invalid("The deal price can't be more than 40% below the regular price.")
        if _money(new_price * deal.share_size) < MIN_SHARE_PRICE:
            raise _invalid(f"A share must cost at least ${MIN_SHARE_PRICE}.")
        deal.deal_price = new_price
    if payload.goal is not None:
        if payload.goal > deal.goal:
            raise _invalid("You can lower the goal, but not raise it.")
        if payload.goal < MIN_GOAL:
            raise _invalid(f"The goal must be at least {MIN_GOAL} households.")
        deal.goal = payload.goal
    if payload.capacity is not None:
        if payload.capacity < deal.capacity:
            raise _invalid("You can add shares, but not take them away.")
        needed = _reserved(payload.capacity, deal.share_size) - deal.reserved_quantity
        if needed > product.quantity_available:
            raise _invalid(f"That needs {needed} more {deal.unit}, and you have {product.quantity_available} in stock.")
        product.quantity_available -= needed
        deal.reserved_quantity += needed
        deal.capacity = payload.capacity
    db.commit()
    return _out(deal, product, now)


def cancel(db: Session, farmer_id, deal_id: str, reason: str | None) -> dict:
    now = _now()
    deal = _owned_deal(db, farmer_id, deal_id, lock=True)
    _advance(db, deal, now)
    if deal.status not in OPEN_STATUSES:
        db.commit()
        raise _conflict("Only a published deal that's still running can be cancelled.")
    _give_stock_back(db, deal)
    deal.status = "cancelled"
    deal.cancelled_at = now
    deal.cancel_reason = (reason or "").strip() or None
    db.commit()
    return _out(deal, db.get(Product, deal.product_id), now)


def has_open_deal(db: Session, product_id) -> bool:
    return (
        db.query(GroupDeal.id).filter(GroupDeal.product_id == product_id, GroupDeal.status.in_(OPEN_STATUSES)).first()
        is not None
    )


def run_jobs(db: Session) -> dict:
    now = _now()
    ids = [deal_id for (deal_id,) in db.query(GroupDeal.id).filter(GroupDeal.status.in_(OPEN_STATUSES))]
    updated = 0
    for deal_id in ids:
        deal = db.query(GroupDeal).filter(GroupDeal.id == deal_id).with_for_update().first()
        if deal is not None and _advance(db, deal, now):
            updated += 1
        db.commit()
    return {"deals_updated": updated}
