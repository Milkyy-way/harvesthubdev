"""Pickup with a code (decided with the user 2026-11-19/20). The rules and
their numbers are in app/pickup/rules.py.

  Farm taps Ready (now, or from a time)  ->  ready_for_pickup, code + window
  Farm enters the customer's code        ->  completed (handed over)
  Window ends                            ->  not_picked (the scheduled job)
  Customer turns up within a day after   ->  completed (a late handover)
"""
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.notifications.service import Notice, notify, notify_many
from app.ops import service as ops
from app.orders import service as orders
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.payments.models import Payment
from app.payouts import service as payouts_service
from app.pickup.rules import (
    CODE_LOCK,
    CODE_TRIES,
    LATE_CONFIRM,
    NOT_READY_LIMIT,
    PICKUP_EXTENSION,
    PICKUP_WINDOW,
    READY_FROM_MAX_AHEAD,
)
from app.products.models import Product
from app.promotions import service as promotions_service

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def _new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def _first_name(profile: Profile | None) -> str | None:
    name = ((profile.full_name if profile else None) or "").strip()
    return name.split(" ")[0] if name else None


def _payment(db: Session, store_order: StoreOrder) -> Payment | None:
    return db.query(Payment).filter(Payment.order_id == store_order.order_id).first()


def _customer_id(db: Session, store_order: StoreOrder):
    return db.query(Order.customer_id).filter(Order.id == store_order.order_id).scalar()


# --- The farm: Ready, and the handover -------------------------------------------------------


def mark_ready(db: Session, farmer_id, store_order_id: str, ready_from: datetime | None = None) -> StoreOrder:
    """The farm has the order packed: card orders go paid -> ready_for_pickup,
    cash orders pending_payment -> ready_for_pickup (they're paid at pickup).
    The window starts now, or at ready_from (up to READY_FROM_MAX_AHEAD away:
    packed in the evening for the next morning), and the customer gets a code."""
    store_order = orders.get_farmer_store_order(db, farmer_id, store_order_id)
    if store_order.fulfillment_method == "delivery":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Delivery orders go out with their delivery run — see Deliveries.",
        )
    payment = _payment(db, store_order)
    is_cash = orders._is_cash(payment)
    preparable_status = "pending_payment" if is_cash else "paid"
    if store_order.status != preparable_status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This order can't be marked ready (current status: '{store_order.status}')",
        )
    now = _now()
    starts = max(_aware(ready_from), now) if ready_from else now
    if starts > now + READY_FROM_MAX_AHEAD:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick a time within the next 3 days.")

    store_order.status = "ready_for_pickup"
    store_order.ready_at = now
    store_order.pickup_starts_at = starts
    store_order.pickup_ends_at = starts + PICKUP_WINDOW
    store_order.pickup_extended_at = None
    store_order.pickup_code = _new_code()
    store_order.pickup_code_failures = 0
    store_order.pickup_code_locked_until = None
    orders._sync_cash_payment_status(db, store_order.order_id, payment)
    db.commit()

    address = ", ".join(p for p in (store_order.pickup_address_street, store_order.pickup_address_city) if p)
    notify(
        db,
        _customer_id(db, store_order),
        "order_ready",
        {
            "farm_name": store_order.farm_name,
            "order_id": str(store_order.order_id),
            "pickup_address": address or None,
            "cash_total": float(store_order.total) if is_cash else None,
            "code": store_order.pickup_code,
            "starts_at": starts,
            "ends_at": store_order.pickup_ends_at,
            "later": starts > now + timedelta(minutes=5),
        },
        dedupe_key=f"order_ready:{store_order.id}",
    )
    return store_order


def _take_stock_again(db: Session, store_order: StoreOrder) -> None:
    """A late handover: the stock went back when the window ended, so it's
    taken off again (never below zero — it may have sold meanwhile)."""
    if store_order.stock_held:
        return
    for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == store_order.id):
        if item.product_id:
            product = db.get(Product, item.product_id)
            if product:
                taken = item.quantity if item.stock_units is None else item.stock_units
                product.quantity_available = max(0, product.quantity_available - taken)
    store_order.stock_held = True


def hand_over(
    db: Session, farmer_id, store_order_id: str, code: str | None, phone_last4: str | None = None, reason: str | None = None
) -> StoreOrder:
    """The farm hands the order over: with the customer's code, or — when the
    customer can't show it — the last 4 digits of their phone plus a reason
    (kept, and listed in the daily check). CODE_TRIES wrong tries lock it for
    CODE_LOCK. Works while the order waits for pickup, and for LATE_CONFIRM
    after the window ended (the customer turned up late)."""
    store_order = orders.get_farmer_store_order(db, farmer_id, store_order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order.id).with_for_update().one()
    now = _now()
    late = (
        store_order.status == "not_picked"
        and store_order.not_picked_at is not None
        and now <= _aware(store_order.not_picked_at) + LATE_CONFIRM
    )
    if store_order.status != "ready_for_pickup" and not late:
        if store_order.status == "completed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This order was already handed over.")
        if store_order.status == "not_picked":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="It's been more than a day since this pickup ended, so it can't be handed over in the app now.",
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Mark this order ready before handing it over.")
    locked_until = _aware(store_order.pickup_code_locked_until)
    if locked_until and locked_until > now:
        minutes = max(1, int((locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many wrong tries. Please wait {minutes} minute{'s' if minutes != 1 else ''} and try again.",
        )

    order = db.get(Order, store_order.order_id)
    backup_reason = None
    if code is not None and code.strip():
        matches = secrets.compare_digest(code.strip(), store_order.pickup_code or "")
        method, wrong = "code", "That code doesn't match."
    else:
        backup_reason = (reason or "").strip()
        if len(backup_reason) < 3:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please say why the code couldn't be used.")
        digits = re.sub(r"\D", "", (db.get(Profile, order.customer_id).phone if order else None) or "")
        if len(digits) < 4:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This customer has no phone number on file, so only their code works.",
            )
        matches = secrets.compare_digest(re.sub(r"\D", "", phone_last4 or ""), digits[-4:])
        method, wrong = "backup", "Those digits don't match the customer's phone."

    if not matches:
        store_order.pickup_code_failures = (store_order.pickup_code_failures or 0) + 1
        left = CODE_TRIES - store_order.pickup_code_failures
        if left <= 0:
            store_order.pickup_code_failures = 0
            store_order.pickup_code_locked_until = now + CODE_LOCK
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"That's {CODE_TRIES} wrong tries. Please wait {int(CODE_LOCK.total_seconds() // 60)} minutes and try again.",
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"{wrong} {left} {'try' if left == 1 else 'tries'} left."
        )

    payment = _payment(db, store_order)
    is_cash = orders._is_cash(payment)
    if late:
        _take_stock_again(db, store_order)
    store_order.status = "completed"
    store_order.completed_at = now
    store_order.pickup_confirmed_by = method
    store_order.pickup_backup_reason = backup_reason
    store_order.pickup_code_failures = 0
    store_order.pickup_code_locked_until = None
    # A card order not picked up was already put down to be paid; a cash one
    # is the moment the cash changes hands (the farm owes HarvestHub its share).
    payouts_service.create_ledger_entry_for_completion(
        db, store_order, cash_collected=float(store_order.total) if is_cash else 0.0
    )
    orders._sync_cash_payment_status(db, store_order.order_id, payment)
    db.commit()
    notify(
        db,
        order.customer_id,
        "picked_up",
        {"farm_name": store_order.farm_name, "order_id": str(store_order.order_id)},
        dedupe_key=f"picked_up:{store_order.id}",
    )
    return store_order


# --- The customer: one more hour, and "did you collect it?" -------------------------------------


def _owned_store_order(db: Session, customer_id: str, order_id: str, store_order_id: str) -> StoreOrder:
    order = orders.get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    return store_order


def extend(db: Session, customer_id: str, order_id: str, store_order_id: str) -> dict:
    """One extra hour, once, while the window is still open."""
    store_order = _owned_store_order(db, customer_id, order_id, store_order_id)
    if store_order.status != "ready_for_pickup":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This order isn't waiting for pickup.")
    if store_order.pickup_extended_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You've already added the extra hour to this pickup.")
    now = _now()
    if store_order.pickup_ends_at is None or now >= _aware(store_order.pickup_ends_at):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The pickup time has ended.")
    store_order.pickup_ends_at = _aware(store_order.pickup_ends_at) + PICKUP_EXTENSION
    store_order.pickup_extended_at = now
    db.commit()
    notify(
        db,
        store_order.farmer_id,
        "pickup_extended",
        {"customer_first": _first_name(db.get(Profile, customer_id)), "ends_at": store_order.pickup_ends_at},
        dedupe_key=f"pickup_extended:{store_order.id}",
    )
    return orders.build_order_out(db, store_order.order_id)


def answer_collected(db: Session, customer_id: str, order_id: str, store_order_id: str, collected: bool) -> dict:
    """A cash order the app marked "not picked": did the customer collect it
    anyway? A yes goes to HarvestHub to look into (the farm may have skipped
    the code to keep the cash off its books), and doesn't count as a no-show."""
    store_order = _owned_store_order(db, customer_id, order_id, store_order_id)
    payment = _payment(db, store_order)
    if store_order.status != "not_picked" or not orders._is_cash(payment):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There's nothing to answer for this order.")
    if store_order.collected_answer is not None:
        return orders.build_order_out(db, store_order.order_id)
    store_order.collected_answer = "yes" if collected else "no"
    store_order.collected_answered_at = _now()
    db.commit()
    if collected:
        customer = db.get(Profile, customer_id)
        ops.alert(
            db,
            "cash_collected_claim",
            f"cash_collected:{store_order.id}",
            f"A customer says they collected a cash order: {store_order.farm_name}",
            [
                f"{(customer.full_name if customer else None) or 'A customer'} says they collected their cash order from "
                f"{store_order.farm_name} ({orders._item_count(db, store_order.id)} items, ${float(store_order.total):.2f}), "
                "but the farm never entered their code, so the app marked it not picked up.",
                "If they're right, the farm took the cash without recording it and owes HarvestHub its share.",
                f"Store order: {store_order.id}",
                f"Order: {store_order.order_id}",
            ],
        )
    return orders.build_order_out(db, store_order.order_id)


# --- The scheduled job ------------------------------------------------------------------------


def _ready(db: Session):
    return db.query(StoreOrder).filter(StoreOrder.status == "ready_for_pickup", StoreOrder.fulfillment_method == "pickup")


def _ctx(db: Session, so: StoreOrder) -> dict:
    payment = _payment(db, so)
    return {
        "farm_name": so.farm_name,
        "order_id": str(so.order_id),
        "code": so.pickup_code,
        "ends_at": so.pickup_ends_at,
        "cash_total": float(so.total) if orders._is_cash(payment) else None,
    }


def run(db: Session) -> dict:
    """Every few minutes (POST /internal/jobs/run): windows that open later
    starting, the reminders, windows ending, and pickups the farm hasn't
    packed within a day. Every notice has a dedupe key, so running it again
    sends nothing twice."""
    now = _now()
    return {
        "pickups_opened": _windows_opening(db, now),
        "pickup_reminders": _reminders(db, now),
        "pickups_not_picked": _windows_ending(db, now),
        "pickups_not_ready": _not_ready(db, now),
    }


def _windows_opening(db: Session, now: datetime) -> int:
    rows = (
        _ready(db)
        .filter(
            StoreOrder.pickup_starts_at <= now,
            StoreOrder.pickup_starts_at > now - timedelta(hours=1),
            StoreOrder.pickup_ends_at > now,
            StoreOrder.ready_at < StoreOrder.pickup_starts_at - timedelta(minutes=5),
        )
        .all()
    )
    notify_many(db, [Notice(_customer_id(db, so), "pickup_open", _ctx(db, so), f"pickup_open:{so.id}") for so in rows])
    return len(rows)


def _reminders(db: Session, now: datetime) -> int:
    notices = []
    # An hour left (only in the first window).
    for so in (
        _ready(db)
        .filter(
            StoreOrder.pickup_extended_at.is_(None),
            StoreOrder.pickup_starts_at <= now,
            StoreOrder.pickup_ends_at <= now + timedelta(hours=1),
            StoreOrder.pickup_ends_at > now + timedelta(minutes=15),
        )
        .all()
    ):
        notices.append(Notice(_customer_id(db, so), "pickup_reminder", _ctx(db, so), f"pickup_1h:{so.id}"))
    # 15 minutes left: the extra hour is offered, or it's the last reminder.
    for so in _ready(db).filter(StoreOrder.pickup_ends_at <= now + timedelta(minutes=15), StoreOrder.pickup_ends_at > now).all():
        if so.pickup_extended_at is None:
            notices.append(Notice(_customer_id(db, so), "pickup_last_call", _ctx(db, so), f"pickup_15m:{so.id}"))
        else:
            notices.append(Notice(_customer_id(db, so), "pickup_final", _ctx(db, so), f"pickup_final:{so.id}"))
    notify_many(db, notices)
    return len(notices)


def _windows_ending(db: Session, now: datetime, limit: int = 50) -> int:
    """The window ended without a handover: "not picked". The stock goes
    back on sale. A card order isn't refunded and the farm is paid for it; a
    cash order wasn't paid, and counts towards paying in the app."""
    ids = [i for (i,) in _ready(db).with_entities(StoreOrder.id).filter(StoreOrder.pickup_ends_at <= now).order_by(StoreOrder.pickup_ends_at).limit(limit)]
    done = 0
    for store_order_id in ids:
        # One at a time, locked: a handover at the last moment wins, and two
        # job runs can't both do it.
        so = (
            _ready(db)
            .filter(StoreOrder.id == store_order_id, StoreOrder.pickup_ends_at <= now)
            .with_for_update(skip_locked=True)
            .first()
        )
        if so is None:
            db.rollback()
            continue
        try:
            payment = _payment(db, so)
            is_cash = orders._is_cash(payment)
            so.status = "not_picked"
            so.not_picked_at = now
            if is_cash:
                promotions_service.release_promo_use(db, so.farmer_id, so.promo_code, so.order_id)
            orders._restore_stock(db, so)
            if not is_cash:
                payouts_service.create_ledger_entry_for_completion(db, so, cash_collected=0.0)
            orders._sync_cash_payment_status(db, so.order_id, payment)
            db.commit()
        except Exception:
            logger.exception("Could not mark store order %s not picked up", so.id)
            db.rollback()
            continue
        done += 1
        notify_many(
            db,
            [
                Notice(
                    _customer_id(db, so),
                    "pickup_missed",
                    {"farm_name": so.farm_name, "order_id": str(so.order_id), "cash": is_cash},
                    f"pickup_missed:{so.id}",
                ),
                Notice(
                    so.farmer_id,
                    "pickup_missed_farmer",
                    {"item_count": orders._item_count(db, so.id), "total": float(so.subtotal), "cash": is_cash},
                    f"pickup_missed_farmer:{so.id}",
                ),
            ],
        )
    return done


def _not_ready(db: Session, now: datetime) -> int:
    """A day on and the farm hasn't packed it: the customer is told they can
    cancel with everything back (orders.cancel_terms)."""
    rows = (
        db.query(StoreOrder)
        .filter(
            StoreOrder.fulfillment_method == "pickup",
            StoreOrder.status.in_(("paid", "pending_payment")),
            StoreOrder.group_deal_id.is_(None),
            StoreOrder.released_to_farmer_at.isnot(None),
            StoreOrder.released_to_farmer_at <= now - NOT_READY_LIMIT,
            StoreOrder.released_to_farmer_at > now - NOT_READY_LIMIT - timedelta(days=1),
        )
        .all()
    )
    notices = []
    for so in rows:
        payment = _payment(db, so)
        refund = orders.farm_cancel_amounts(db, so)[0] if so.status == "paid" and not orders._is_cash(payment) else 0.0
        notices.append(
            Notice(
                _customer_id(db, so),
                "order_not_ready",
                {"farm_name": so.farm_name, "order_id": str(so.order_id), "refund": refund},
                f"order_not_ready:{so.id}",
            )
        )
    notify_many(db, notices)
    return len(notices)
