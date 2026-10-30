from datetime import datetime, timezone
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.promotions.models import PromoCode


def _find_promo(db: Session, farmer_id: str, code: str) -> PromoCode | None:
    return (
        db.query(PromoCode)
        .filter(
            PromoCode.farmer_id == farmer_id,
            PromoCode.code == code.strip().upper(),
            PromoCode.is_active.is_(True),
        )
        .first()
    )


def apply_promo(db: Session, farmer_id: str, code: str | None, subtotal: float) -> tuple[float, str | None, str | None]:
    """Returns (discount_amount, applied_code_or_none, error_message_or_none).
    Never raises — an invalid/expired/inapplicable code just means no
    discount for that farm's subsection, not a failed checkout preview."""
    if not code or not code.strip():
        return 0.0, None, None

    promo = _find_promo(db, farmer_id, code)
    if not promo:
        return 0.0, None, "Invalid promo code for this farm"

    # starts_at/expires_at read back timezone-aware (the real column is
    # timestamptz) — now must be tz-aware too, or this comparison throws
    # (same bug class fixed in app/orders/service.py's dashboard summary).
    now = datetime.now(timezone.utc)
    if promo.starts_at and now < promo.starts_at:
        return 0.0, None, "This promo code isn't active yet"
    if promo.expires_at and now > promo.expires_at:
        return 0.0, None, "This promo code has expired"
    if promo.usage_limit is not None and promo.times_used >= promo.usage_limit:
        return 0.0, None, "This promo code has reached its usage limit"
    if promo.min_order_amount is not None and subtotal < float(promo.min_order_amount):
        return 0.0, None, f"Minimum order of ${float(promo.min_order_amount):.2f} required for this code"

    if promo.discount_type == "percentage":
        discount = subtotal * float(promo.discount_value) / 100
    else:
        discount = float(promo.discount_value)

    if promo.max_discount_amount is not None:
        discount = min(discount, float(promo.max_discount_amount))
    discount = min(discount, subtotal)  # never discount past $0

    return round(discount, 2), promo.code, None


def record_promo_use(db: Session, farmer_id, code: str | None) -> None:
    """Counts one use of a code, once its order is really placed. A single
    UPDATE, so two orders finishing together can't lose a count. Does NOT
    commit."""
    if code:
        db.query(PromoCode).filter(PromoCode.farmer_id == farmer_id, PromoCode.code == code).update(
            {PromoCode.times_used: PromoCode.times_used + 1}, synchronize_session=False
        )


def release_promo_use(db: Session, farmer_id, code: str | None) -> None:
    """Gives a use back when a placed order is cancelled. Does NOT commit."""
    if code:
        db.query(PromoCode).filter(PromoCode.farmer_id == farmer_id, PromoCode.code == code).update(
            {PromoCode.times_used: func.greatest(PromoCode.times_used - 1, 0)}, synchronize_session=False
        )
