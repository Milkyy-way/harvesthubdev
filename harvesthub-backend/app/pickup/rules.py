"""The pickup rules (decided with the user 2026-11-19/20), and the one check
checkout needs from them. Kept free of the order service's imports, so
checkout can use it without a circular import.

  * The farm taps Ready, "now" or "from" a time up to READY_FROM_MAX_AHEAD
    away. The window is PICKUP_WINDOW from then; the customer can extend it
    once, by PICKUP_EXTENSION. No scheduling ahead and no rescheduling.
  * The customer gets a 4-digit code; the farm types it in to hand the order
    over. CODE_TRIES wrong codes lock it for CODE_LOCK. Backup check: the
    last 4 digits of the customer's phone, with a reason the farm writes.
  * When the window ends, the app marks the order "not picked" by itself:
    the stock goes back, a card order isn't refunded and the farm is paid.
    The farm can still confirm it for LATE_CONFIRM if the customer turns up.
  * A farm that hasn't tapped Ready within NOT_READY_LIMIT of the order:
    the customer can cancel with everything back, as if the farm cancelled.
  * After CASH_NO_SHOW_LIMIT cash orders not picked up, a customer pays in
    the app.
  * Customers can't cancel once the farm has packed the order (tapped Ready).
"""
from datetime import timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.orders.models import Order, StoreOrder
from app.payments.models import Payment

PICKUP_WINDOW = timedelta(hours=3)
PICKUP_EXTENSION = timedelta(hours=1)
READY_FROM_MAX_AHEAD = timedelta(days=3)
LATE_CONFIRM = timedelta(hours=24)
NOT_READY_LIMIT = timedelta(hours=24)
CODE_TRIES = 5
CODE_LOCK = timedelta(minutes=15)
CASH_NO_SHOW_LIMIT = 2
# "Report a problem" stays open this long after the handover (or "not picked").
REPORT_WINDOW = timedelta(hours=24)

CASH_BLOCKED = (
    "You've missed {n} cash pickups, so please pay in the app for now. "
    "If that's a mistake, contact support."
)


def cash_no_shows(db: Session, customer_id) -> int:
    """Cash orders this customer didn't pick up. One they say they did
    collect (the farm may have skipped the code) doesn't count."""
    return (
        db.query(StoreOrder.id)
        .join(Order, Order.id == StoreOrder.order_id)
        .join(Payment, Payment.order_id == Order.id)
        .filter(
            Order.customer_id == customer_id,
            StoreOrder.status == "not_picked",
            Payment.payment_method == "cash_on_pickup",
            or_(StoreOrder.collected_answer.is_(None), StoreOrder.collected_answer != "yes"),
        )
        .count()
    )


def cash_blocked_reason(db: Session, customer_id) -> str | None:
    n = cash_no_shows(db, customer_id)
    return CASH_BLOCKED.format(n=n) if n >= CASH_NO_SHOW_LIMIT else None
