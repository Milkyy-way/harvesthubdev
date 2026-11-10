import re
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.localtime import LOCAL_TZ, to_local
from app.promotions.models import PromoCode, PromoCodeUse

# What a farmer can choose in the app (decided 2026-11-09).
CODE_PATTERN = re.compile(r"^[A-Z0-9]{3,20}$")
PERCENT_MIN, PERCENT_MAX = 1, 90
FIXED_MIN, FIXED_MAX = 0.50, 100.00
DURATION_DAYS = (7, 14, 30, 90)


def normalize_code(code: str | None) -> str:
    return (code or "").strip().upper()


def _scoped(db: Session, farmer_id):
    return db.query(PromoCode).filter(PromoCode.farmer_id == farmer_id)


def _find_promo(db: Session, farmer_id, code: str) -> PromoCode | None:
    return _scoped(db, farmer_id).filter(PromoCode.code == normalize_code(code), PromoCode.is_active.is_(True)).first()


def _problem(db: Session, promo: PromoCode, customer_id, order_amount: float) -> str | None:
    """Why this code can't be used right now, or None. The minimum is checked
    against order_amount."""
    # starts_at/expires_at read back timezone-aware (the real column is
    # timestamptz) — now must be tz-aware too, or this comparison throws.
    now = datetime.now(timezone.utc)
    if promo.starts_at and now < promo.starts_at:
        return "This promo code isn't active yet"
    if promo.expires_at and now > promo.expires_at:
        return "This promo code has expired"
    if promo.usage_limit is not None and promo.times_used >= promo.usage_limit:
        return "This promo code has reached its usage limit"
    if promo.once_per_customer and customer_id is not None:
        used = (
            db.query(PromoCodeUse.id)
            .filter(PromoCodeUse.promo_code_id == promo.id, PromoCodeUse.customer_id == customer_id)
            .first()
        )
        if used:
            return "You've already used this promo code"
    if promo.min_order_amount is not None and order_amount < float(promo.min_order_amount):
        return f"Minimum order of ${float(promo.min_order_amount):.2f} required for this code"
    return None


def _amount_off(promo: PromoCode, base: float) -> float:
    if promo.discount_type == "percentage":
        discount = base * float(promo.discount_value) / 100
    else:
        discount = float(promo.discount_value)
    if promo.max_discount_amount is not None:
        discount = min(discount, float(promo.max_discount_amount))
    return round(min(discount, base), 2)  # never discount past $0


def apply_promo(
    db: Session, farmer_id: str, code: str | None, subtotal: float, customer_id=None
) -> tuple[float, str | None, str | None]:
    """A farm's code, on that farm's subtotal. Returns (discount_amount,
    applied_code_or_none, error_message_or_none). Never raises — an invalid/
    expired/inapplicable code just means no discount for that farm's
    subsection, not a failed checkout preview."""
    if not code or not code.strip():
        return 0.0, None, None
    promo = _find_promo(db, farmer_id, code)
    if not promo:
        return 0.0, None, "Invalid promo code for this farm"
    problem = _problem(db, promo, customer_id, subtotal)
    if problem:
        return 0.0, None, problem
    return _amount_off(promo, subtotal), promo.code, None


def record_promo_use(db: Session, farmer_id, code: str | None, customer_id, order_id) -> None:
    """Counts one use of a code, once its order is really placed (a second call
    for the same order is a no-op). The count is a single UPDATE, so two orders
    finishing together can't lose one. Does NOT commit."""
    if not code:
        return
    promo = _scoped(db, farmer_id).filter(PromoCode.code == code).first()
    if promo is None:
        return
    inserted = db.execute(
        insert(PromoCodeUse)
        .values(id=uuid.uuid4(), promo_code_id=promo.id, customer_id=customer_id, order_id=order_id)
        .on_conflict_do_nothing(index_elements=["promo_code_id", "order_id"])
    ).rowcount
    if inserted:
        db.query(PromoCode).filter(PromoCode.id == promo.id).update(
            {PromoCode.times_used: PromoCode.times_used + 1}, synchronize_session=False
        )


def release_promo_use(db: Session, farmer_id, code: str | None, order_id) -> None:
    """Gives a use back when its order is cancelled. Does NOT commit."""
    if not code:
        return
    promo = _scoped(db, farmer_id).filter(PromoCode.code == code).first()
    if promo is None:
        return
    deleted = (
        db.query(PromoCodeUse)
        .filter(PromoCodeUse.promo_code_id == promo.id, PromoCodeUse.order_id == order_id)
        .delete(synchronize_session=False)
    )
    if deleted:
        db.query(PromoCode).filter(PromoCode.id == promo.id).update(
            {PromoCode.times_used: func.greatest(PromoCode.times_used - 1, 0)}, synchronize_session=False
        )


# --- How a code reads: the farm page and the farmer's list ---------------------------


def _money(value) -> str:
    return f"${float(value):,.2f}".replace(".00", "")


def describe(promo: PromoCode) -> tuple[str, list[str]]:
    """('10% off, up to $8', ['On orders of $20 or more', 'Ends Nov 30'])."""
    value = float(promo.discount_value)
    if promo.discount_type == "percentage":
        headline = f"{value:g}% off"
        if promo.max_discount_amount is not None:
            headline += f", up to {_money(promo.max_discount_amount)}"
    else:
        headline = f"{_money(value)} off"
    details = []
    if promo.min_order_amount is not None:
        details.append(f"On orders of {_money(promo.min_order_amount)} or more")
    if promo.once_per_customer:
        details.append("One use per customer")
    if promo.expires_at is not None:
        end = to_local(promo.expires_at)
        details.append(f"Ends {end:%b} {end.day}")
    return headline, details


def visible_on_farm_page(db: Session, farmer_id) -> list[dict]:
    """The farm's codes it chose to show, that a customer could use now."""
    now = datetime.now(timezone.utc)
    promos = (
        db.query(PromoCode)
        .filter(
            PromoCode.farmer_id == farmer_id,
            PromoCode.is_active.is_(True),
            PromoCode.show_on_farm_page.is_(True),
            or_(PromoCode.starts_at.is_(None), PromoCode.starts_at <= now),
            or_(PromoCode.expires_at.is_(None), PromoCode.expires_at > now),
            or_(PromoCode.usage_limit.is_(None), PromoCode.times_used < PromoCode.usage_limit),
        )
        .order_by(PromoCode.created_at)
        .all()
    )
    out = []
    for promo in promos:
        headline, details = describe(promo)
        out.append({"code": promo.code, "headline": headline, "details": details})
    return out


# --- The farmer's Promo codes screen ----------------------------------------------


def _status(promo: PromoCode, now: datetime) -> str:
    if not promo.is_active:
        return "paused"
    if promo.expires_at and now > promo.expires_at:
        return "ended"
    if promo.usage_limit is not None and promo.times_used >= promo.usage_limit:
        return "used_up"
    if promo.starts_at and now < promo.starts_at:
        return "scheduled"
    return "active"


def _farmer_code_out(promo: PromoCode, now: datetime) -> dict:
    headline, details = describe(promo)
    return {
        "id": str(promo.id),
        "code": promo.code,
        "headline": headline,
        "details": details,
        "usage_limit": promo.usage_limit,
        "times_used": promo.times_used,
        "show_on_farm_page": promo.show_on_farm_page,
        "status": _status(promo, now),
    }


def list_farmer_codes(db: Session, farmer_id) -> list[dict]:
    now = datetime.now(timezone.utc)
    promos = db.query(PromoCode).filter(PromoCode.farmer_id == farmer_id).order_by(PromoCode.created_at.desc()).all()
    return [_farmer_code_out(p, now) for p in promos]


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def create_farmer_code(db: Session, farmer_id, payload) -> dict:
    code = normalize_code(payload.code)
    if not CODE_PATTERN.match(code):
        raise _bad("Use 3 to 20 letters and numbers for the code, with no spaces.")
    value = round(payload.discount_value, 2)
    if payload.discount_type == "percentage" and not PERCENT_MIN <= value <= PERCENT_MAX:
        raise _bad(f"A percentage off must be from {PERCENT_MIN}% to {PERCENT_MAX}%.")
    if payload.discount_type == "fixed" and not FIXED_MIN <= value <= FIXED_MAX:
        raise _bad(f"A dollar amount off must be from {_money(FIXED_MIN)} to {_money(FIXED_MAX)}.")
    min_order = round(payload.min_order_amount, 2) if payload.min_order_amount else None
    if min_order is not None and not 0 < min_order <= 1000:
        raise _bad("The minimum order must be from $0.01 to $1,000.")
    max_off = round(payload.max_discount_amount, 2) if payload.max_discount_amount else None
    if payload.discount_type != "percentage":
        max_off = None
    if max_off is not None and not FIXED_MIN <= max_off <= 500:
        raise _bad("The most a customer can save must be from $0.50 to $500.")
    if payload.usage_limit is not None and not 1 <= payload.usage_limit <= 10000:
        raise _bad("The number of uses must be from 1 to 10,000.")
    if payload.duration_days is not None and payload.duration_days not in DURATION_DAYS:
        raise _bad("Choose how long the code lasts.")
    if _scoped(db, farmer_id).filter(PromoCode.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"You already have a code called {code}. Pick another name.")

    expires_at = None
    if payload.duration_days:
        # The end of that day, Eastern.
        last_day = datetime.now(LOCAL_TZ).date() + timedelta(days=payload.duration_days)
        expires_at = datetime.combine(last_day, time(23, 59, 59), tzinfo=LOCAL_TZ).astimezone(timezone.utc)

    promo = PromoCode(
        id=uuid.uuid4(),
        farmer_id=farmer_id,
        code=code,
        discount_type=payload.discount_type,
        discount_value=value,
        min_order_amount=min_order,
        max_discount_amount=max_off,
        usage_limit=payload.usage_limit,
        times_used=0,
        is_active=True,
        expires_at=expires_at,
        show_on_farm_page=payload.show_on_farm_page,
        once_per_customer=payload.once_per_customer,
    )
    db.add(promo)
    db.commit()
    return _farmer_code_out(promo, datetime.now(timezone.utc))


def _owned_code(db: Session, farmer_id, code_id: str) -> PromoCode:
    try:
        cid = uuid.UUID(code_id)
    except ValueError:
        cid = None
    promo = _scoped(db, farmer_id).filter(PromoCode.id == cid).first() if cid else None
    if promo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promo code not found")
    return promo


def update_farmer_code(db: Session, farmer_id, code_id: str, payload) -> dict:
    """Pause or resume it, or show or hide it on the farm page. The discount
    itself can't change: a farmer deletes the code and makes a new one."""
    promo = _owned_code(db, farmer_id, code_id)
    if payload.is_active is not None:
        promo.is_active = payload.is_active
    if payload.show_on_farm_page is not None:
        promo.show_on_farm_page = payload.show_on_farm_page
    db.commit()
    return _farmer_code_out(promo, datetime.now(timezone.utc))


def delete_farmer_code(db: Session, farmer_id, code_id: str) -> None:
    """Orders that used it keep the code and the discount they got."""
    db.delete(_owned_code(db, farmer_id, code_id))
    db.commit()
