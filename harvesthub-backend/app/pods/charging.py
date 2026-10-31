"""Charging pod orders at the farm's cutoff (decided with the user 2026-10-31).

A pod's delivery fee is split evenly among the members that actually order
for a farm's window, with no cost to the farm or HarvestHub. That number isn't
known until orders close, so a pod order works differently from any other:

  * Placing it saves a card (a Stripe SetupIntent). Nothing is charged and
    nothing is held. Stock and the promo code are taken right away, as for a
    cash order. The farmer doesn't see it yet.
  * Before the cutoff the customer can cancel for free: no money has moved.
    After it they can't (app/orders/service.py::_pod_orders_closed).
  * At the cutoff the fee is divided, and each order gets ONE charge for its
    exact total. Then it's an ordinary paid order: released to the farmer, and
    a stop on the run.
  * A declined card: the customer is told and can change it; one automatic
    retry later, the order is cancelled. Shares aren't recalculated, because
    the others have already paid, so the farm receives one share less. This is
    the only case where the farm gets less than its fee.

The scheduled job runs run(), every 15 minutes. It must be running: nothing
else charges these orders, except a farmer opening Deliveries or starting a run.

Payment statuses: requires_payment_method (no card yet: not placed) ->
awaiting_cutoff -> charging -> succeeded | charge_failed. "charging" is written
before Stripe is called, with an idempotency key, so a crash can't charge twice.
"""
import logging
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.delivery import service as delivery_service
from app.delivery.models import FarmDeliverySettings
from app.membership import service as membership_service
from app.notifications.service import Notice, notify, notify_many
from app.orders import service as orders
from app.orders.models import Order, StoreOrder
from app.payments import stripe_client
from app.payments.models import AWAITING_CUTOFF, CHARGE_FAILED, CHARGING, Payment
from app.pods.models import Pod, PodMember

logger = logging.getLogger(__name__)

RETRY_AFTER = timedelta(hours=2)
_MAX_ATTEMPTS = 2
# How long before the cutoff members hear how the split stands.
_REMINDER_BEFORE = timedelta(hours=6)
# An abandoned checkout stops being looked at after this long.
_UNPLACED_LOOKBACK = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _store_order(db: Session, order_id) -> StoreOrder:
    # A pod order is always its own order, with one store order (create_order).
    return db.query(StoreOrder).filter(StoreOrder.order_id == order_id).one()


def _cutoff_of(db: Session, so: StoreOrder) -> datetime:
    s = db.get(FarmDeliverySettings, so.farmer_id)
    return so.delivery_window_starts_at - timedelta(hours=s.cutoff_hours if s else 0)


# --- The card ------------------------------------------------------------------------------


def prepare_new_card(db: Session, customer_id, order_id: str) -> dict:
    """A different card for an order whose card was declined."""
    order = orders.get_owned_order(db, str(customer_id), order_id)
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    if payment is None or payment.status != CHARGE_FAILED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This order doesn't need a new card.")
    stripe_customer = membership_service.get_or_create_stripe_customer(db, customer_id)
    try:
        intent = stripe_client.create_setup_intent(
            stripe_customer, {"purpose": orders.POD_ORDER_PURPOSE, "profile_id": str(customer_id), "order_id": str(order.id)}
        )
    except stripe.error.StripeError as e:
        logger.error("Could not start saving a card: %s", e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="We couldn't reach our payment provider. Please try again.")
    payment.stripe_setup_intent_id = intent.id
    db.commit()
    return {"setup_intent_client_secret": intent.client_secret}


def adopt_saved_card(db: Session, customer_id, order_id: str) -> None:
    """After the app's card sheet closes: if the card was saved, place the order
    or, for a declined one, retry on the new card. Safe to call repeatedly."""
    order = orders.get_owned_order(db, str(customer_id), order_id)
    _adopt(db, order)


def _adopt(db: Session, order: Order) -> None:
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    if payment is None or not payment.stripe_setup_intent_id or payment.status not in ("requires_payment_method", CHARGE_FAILED):
        return
    try:
        intent = stripe_client.retrieve_setup_intent(payment.stripe_setup_intent_id)
    except stripe.error.StripeError as e:
        logger.warning("Could not read SetupIntent for order %s: %s", order.id, e)
        return
    method = intent.get("payment_method")
    if (
        intent.get("status") != "succeeded"
        or not method
        or (intent.get("metadata") or {}).get("order_id") != str(order.id)
    ):
        return
    method_id = method["id"] if isinstance(method, dict) else method
    if payment.status == CHARGE_FAILED:
        if method_id != payment.stripe_payment_method_id:
            payment.stripe_payment_method_id = method_id
            payment.status = CHARGING
            payment.charge_attempts = 0
            db.commit()
            _charge(db, payment.id)
        return
    _place(db, order, payment, method_id)


def _place(db: Session, order: Order, payment: Payment, method_id: str) -> None:
    so = _store_order(db, order.id)
    if _now() >= _cutoff_of(db, so):
        # Orders closed while they were entering their card. Nothing charged.
        orders._cancel_one_store_order(db, order, so, order.customer_id, "admin", "Orders for this delivery closed.")
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Orders for that delivery have just closed, so this one wasn't placed.")
    orders._commit_inventory_and_clear_cart(db, str(order.customer_id), order.id)
    payment.stripe_payment_method_id = method_id
    payment.status = AWAITING_CUTOFF
    db.commit()
    notify(
        db,
        order.customer_id,
        "pod_order_scheduled",
        {"farm_name": so.farm_name, "order_id": str(order.id), "charge_at": _cutoff_of(db, so)},
        dedupe_key=f"pod_order_scheduled:{order.id}",
    )


# --- Dividing the fee ----------------------------------------------------------------------


def _close_group(db: Session, payment_ids: list) -> None:
    """Orders have closed for this farm's window: divide the fee among the
    customers on it. One share per customer, however many orders they placed.
    Two people at the same address with their own accounts are two customers.
    Written in one go, before any card is touched."""
    rows = (
        db.query(Payment, StoreOrder, Order)
        .join(Order, Order.id == Payment.order_id)
        .join(StoreOrder, StoreOrder.order_id == Order.id)
        .filter(Payment.id.in_(payment_ids), Payment.status == AWAITING_CUTOFF)
        .order_by(Order.placed_at)
        .with_for_update(of=Payment)
        .all()
    )
    if not rows:
        db.commit()
        return
    # Never above what anyone was shown, if the farm changed its fee meanwhile.
    fee = min(float(so.pod_full_fee) for _, so, _ in rows)
    households = {order.customer_id for _, _, order in rows}
    share = delivery_service.pod_share(fee, len(households))
    paying: set = set()
    for payment, so, order in rows:
        this_fee = 0.0 if order.customer_id in paying else share
        paying.add(order.customer_id)
        so.total = round(float(so.total) - float(so.delivery_fee) + this_fee, 2)
        so.delivery_fee = this_fee
        payment.amount = so.total
        payment.status = CHARGING
    db.commit()


def _charge(db: Session, payment_id) -> None:
    payment = db.query(Payment).filter(Payment.id == payment_id, Payment.status == CHARGING).with_for_update().first()
    if payment is None:
        db.commit()
        return
    order = db.get(Order, payment.order_id)
    so = _store_order(db, order.id)
    stripe_customer = membership_service._stored_stripe_customer(db, order.customer_id)
    try:
        intent = stripe_client.charge_saved_card(
            float(payment.amount),
            "usd",
            stripe_customer,
            payment.stripe_payment_method_id,
            str(order.id),
            str(order.customer_id),
            idempotency_key=f"pod-order-{order.id}-{payment.stripe_payment_method_id}-{payment.charge_attempts}",
        )
    except stripe.error.CardError as e:
        _charge_failed(db, order, payment, so, getattr(e, "user_message", None) or "Your card was declined.")
        return
    except stripe.error.StripeError as e:
        # Our side or Stripe's, not the card: still "charging", so the next
        # run tries again with the same key.
        logger.error("Could not charge pod order %s: %s", order.id, e)
        db.rollback()
        return
    if intent.status != "succeeded":
        _charge_failed(db, order, payment, so, "Your bank needs you to confirm this payment.")
        return
    payment.stripe_payment_intent_id = intent.id
    payment.stripe_charge_id = getattr(intent, "latest_charge", None)
    payment.status = "succeeded"
    payment.failure_reason = None
    db.commit()
    orders._finalize_successful_payment(db, order.id, stock_taken=True)


def _charge_failed(db: Session, order: Order, payment: Payment, so: StoreOrder, reason: str) -> None:
    payment.charge_attempts = (payment.charge_attempts or 0) + 1
    payment.last_charge_attempt_at = _now()
    payment.failure_reason = reason
    payment.status = CHARGE_FAILED
    attempts = payment.charge_attempts
    db.commit()
    notify(
        db,
        order.customer_id,
        "pod_charge_failed",
        {"farm_name": so.farm_name, "order_id": str(order.id), "amount": float(payment.amount)},
        dedupe_key=f"pod_charge_failed:{order.id}:{attempts}:{payment.stripe_payment_method_id}",
    )


def _give_up(db: Session, order: Order, payment: Payment, so: StoreOrder) -> None:
    orders._cancel_one_store_order(db, order, so, order.customer_id, "admin", "The card was declined.")
    db.commit()
    notify(
        db,
        order.customer_id,
        "pod_charge_cancelled",
        {"farm_name": so.farm_name, "order_id": str(order.id)},
        dedupe_key=f"pod_charge_cancelled:{order.id}",
    )


# --- The scheduled job ---------------------------------------------------------------------


def _awaiting(db: Session, farmer_id=None) -> list:
    q = (
        db.query(Payment, StoreOrder, Order)
        .join(Order, Order.id == Payment.order_id)
        .join(StoreOrder, StoreOrder.order_id == Order.id)
        .filter(Payment.status == AWAITING_CUTOFF, StoreOrder.status == "pending_payment")
    )
    if farmer_id is not None:
        q = q.filter(StoreOrder.farmer_id == farmer_id)
    return q.all()


def _groups(rows: list) -> dict:
    """One group per pod + farm + window: who shares a delivery fee."""
    groups: dict = {}
    for payment, so, order in rows:
        groups.setdefault((so.pod_id or so.id, so.farmer_id, so.delivery_window_starts_at), []).append((payment, so, order))
    return groups


def settle_due(db: Session, now: datetime | None = None, farmer_id=None, starting_window: datetime | None = None) -> int:
    """Divides and charges whatever has reached its cutoff. starting_window: the
    farmer is setting off for this window now, so it's closed whatever the clock says."""
    now = now or _now()
    charged = 0
    for (_, _, window), members in _groups(_awaiting(db, farmer_id)).items():
        if now >= _cutoff_of(db, members[0][1]) or window == starting_window:
            _close_group(db, [payment.id for payment, _, _ in members])

    q = db.query(Payment.id).filter(Payment.status == CHARGING)
    if farmer_id is not None:
        q = (
            q.join(StoreOrder, StoreOrder.order_id == Payment.order_id).filter(StoreOrder.farmer_id == farmer_id)
        )
    for (payment_id,) in q.all():
        _charge(db, payment_id)
        charged += 1
    return charged


def settle_run(db: Session, farmer_id, run_id: str) -> None:
    """Before a farmer starts a run early: its pod orders go on it."""
    run = delivery_service._owned_run(db, farmer_id, run_id)
    settle_due(db, farmer_id=farmer_id, starting_window=run.window_starts_at)


def _retry_failed(db: Session, now: datetime) -> int:
    done = 0
    for payment in db.query(Payment).filter(Payment.status == CHARGE_FAILED).all():
        order = db.get(Order, payment.order_id)
        so = _store_order(db, order.id)
        tried = payment.charge_attempts or 0
        if tried >= _MAX_ATTEMPTS or now >= so.delivery_window_starts_at:
            _give_up(db, order, payment, so)
            done += 1
        elif payment.last_charge_attempt_at and now >= payment.last_charge_attempt_at + RETRY_AFTER:
            payment.status = CHARGING
            db.commit()
            _charge(db, payment.id)
            done += 1
    return done


def _adopt_unplaced(db: Session, now: datetime) -> None:
    """The app closed between saving a card and telling us."""
    rows = (
        db.query(Order)
        .join(Payment, Payment.order_id == Order.id)
        .filter(
            Payment.status == "requires_payment_method",
            Payment.stripe_setup_intent_id.isnot(None),
            Order.placed_at > (now - _UNPLACED_LOOKBACK).replace(tzinfo=None),
        )
        .limit(50)
        .all()
    )
    for order in rows:
        try:
            _adopt(db, order)
        except HTTPException:
            pass  # orders closed: it was cancelled, and they never saw a charge


def _send_reminders(db: Session, now: datetime) -> int:
    """Before the cutoff, how the split stands: it nudges neighbors to order,
    and it's the last chance to cancel."""
    notices = []
    for (pod_id, farmer_id, window), members in _groups(_awaiting(db)).items():
        so = members[0][1]
        if not so.pod_id:
            continue
        cutoff = _cutoff_of(db, so)
        if not (cutoff - _REMINDER_BEFORE <= now < cutoff):
            continue
        pod = db.get(Pod, so.pod_id)
        ordered = {order.customer_id for _, _, order in members}
        share = delivery_service.pod_share(float(so.pod_full_fee), len(ordered))
        everyone = db.query(PodMember.customer_id).filter(PodMember.pod_id == so.pod_id, PodMember.status == "active").all()
        for (customer_id,) in everyone:
            notices.append(
                Notice(
                    customer_id,
                    "pod_order_reminder",
                    {
                        "pod_id": str(pod.id),
                        "pod_name": pod.name,
                        "farm_name": so.farm_name,
                        "ordered": len(ordered),
                        "total": len(everyone),
                        "share": share,
                        "cutoff": cutoff,
                        "has_ordered": customer_id in ordered,
                    },
                    f"pod_order_reminder:{pod.id}:{farmer_id}:{window.isoformat()}:{customer_id}",
                )
            )
    notify_many(db, notices)
    return len(notices)


def run(db: Session, now: datetime | None = None) -> dict:
    now = now or _now()
    _adopt_unplaced(db, now)
    reminders = _send_reminders(db, now)
    charged = settle_due(db, now)
    retried = _retry_failed(db, now)
    return {"pod_reminders": reminders, "pod_orders_charged": charged, "pod_charges_retried": retried}
