"""Report a problem (decided with the user 2026-11-19/20).

A customer can report one problem per farm's part of an order, for 24 hours
after the handover (picked up, or delivered) — or after "not picked", e.g.
"the farm was closed when I came". HarvestHub decides; it doesn't wait on the
farm. The decision is made with scripts/problems.py:

  * refund: the chosen items' price after the promo, plus their tax (or, with
    "everything", whatever is left of the part). The farm gives back its share
    of the goods and HarvestHub its commission, as today
    (payouts_service.create_problem_adjustment). Card orders only;
  * decline, with a note to the customer;
  * handled: settled by hand (a cash order: there's no card to refund).
"""
import uuid
from datetime import datetime, timezone

import stripe
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.core.pricing import FARMER_COMMISSION_RATE
from app.notifications.service import notify
from app.ops import service as ops
from app.orders import service as orders
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.payments import stripe_client
from app.payments.models import Payment, Refund
from app.payouts import service as payouts_service
from app.pickup.rules import REPORT_WINDOW
from app.problems.models import ProblemReport

REASONS = {
    "missing_item": "Something was missing",
    "damaged": "Something was damaged",
    "wrong_item": "I got the wrong item",
    "quality": "Poor quality",
    "farm_closed": "I came, but couldn't collect it",
    "other": "Something else",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def create_report(
    db: Session, customer_id: str, order_id: str, store_order_id: str, reason: str, details: str | None, items: list[dict]
) -> dict:
    order = orders.get_owned_order(db, customer_id, order_id)
    so = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not so:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    finished_at = so.completed_at if so.status == "completed" else so.not_picked_at if so.status == "not_picked" else None
    if finished_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You can report a problem once you've had the order, or once its pickup time has ended.",
        )
    if _now() > _aware(finished_at) + REPORT_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Problems can be reported for 24 hours after pickup or delivery. Please contact support.",
        )
    if db.query(ProblemReport.id).filter(ProblemReport.store_order_id == so.id).first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You've already reported a problem with this order. We'll be in touch.")
    if reason not in REASONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please choose what went wrong.")
    if reason == "farm_closed" and so.status != "not_picked":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This order was handed over, so please choose another reason.")
    details = (details or "").strip()[:1000] or None
    if reason == "other" and not details:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please tell us what went wrong.")

    lines = {str(i.id): i for i in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id)}
    chosen = []
    for entry in items or []:
        item = lines.get(str(entry.get("item_id")))
        quantity = int(entry.get("quantity") or 0)
        if item is None or quantity < 1 or quantity > item.quantity:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please check the items you chose.")
        chosen.append({"item_id": str(item.id), "product_name": item.product_name, "quantity": quantity})

    report = ProblemReport(
        id=uuid.uuid4(),
        store_order_id=so.id,
        customer_id=order.customer_id,
        reason=reason,
        details=details,
        items=chosen,
        status="open",
    )
    db.add(report)
    db.commit()

    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    customer = db.get(Profile, order.customer_id)
    ops.alert(
        db,
        "problem_report",
        f"problem:{report.id}",
        f"Problem reported: {so.farm_name}",
        [
            f"{(customer.full_name if customer else None) or 'A customer'} reported a problem with their order from {so.farm_name}.",
            f"What went wrong: {REASONS[reason]}",
            *(["Items: " + ", ".join(f"{c['quantity']} × {c['product_name']}" for c in chosen)] if chosen else []),
            *([f"They wrote: {details}"] if details else []),
            "",
            f"Order part: {'picked up/delivered' if so.status == 'completed' else 'not picked up'}, "
            f"{float(so.total):.2f} USD, paid {'in cash' if orders._is_cash(payment) else 'by card'}.",
            "",
            "Decide with (from harvesthub-backend):",
            f"  venv/Scripts/python scripts/problems.py show {report.id}",
        ],
    )
    notify(
        db,
        order.customer_id,
        "problem_received",
        {"farm_name": so.farm_name, "order_id": str(order.id)},
        dedupe_key=f"problem_received:{report.id}",
    )
    return orders.build_order_out(db, order.id)


# --- Deciding (scripts/problems.py) ---------------------------------------------------------


def _refunded_so_far(db: Session, so: StoreOrder) -> float:
    total = (
        db.query(func.coalesce(func.sum(Refund.amount), 0))
        .filter(Refund.store_order_id == so.id, Refund.status.in_(("succeeded", "pending")))
        .scalar()
    )
    return round(float(total or 0), 2)


def refund_amounts(db: Session, report: ProblemReport, item_quantities: dict | None = None, everything: bool = False) -> dict:
    """What a refund would be. item_quantities: {item_id: quantity}; default
    the items the customer chose. Each item's price after its share of the
    promo, plus its share of the tax; with everything, what's left of the part
    (delivery fee and service fee included). Capped at what's left."""
    so = db.get(StoreOrder, report.store_order_id)
    left = round(float(so.total) - _refunded_so_far(db, so), 2)
    subtotal, promo = float(so.subtotal), float(so.promo_discount)
    goods_total = max(subtotal - promo, 0.0)
    if everything:
        return {
            "goods": round(goods_total, 2),
            "delivery_fee": float(so.delivery_fee or 0),
            "amount": max(left, 0.0),
            "lines": ["everything left on this part"],
        }
    if item_quantities is None:
        item_quantities = {c["item_id"]: c["quantity"] for c in report.items or []}
    goods = 0.0
    lines = []
    for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id):
        quantity = min(int(item_quantities.get(str(item.id), 0)), item.quantity)
        if quantity <= 0:
            continue
        line = float(item.unit_price) * quantity
        share_of_promo = promo * line / subtotal if subtotal > 0 else 0.0
        goods += line - share_of_promo
        lines.append(f"{quantity} × {item.product_name}")
    goods = round(goods, 2)
    tax = round(float(so.tax) * goods / goods_total, 2) if goods_total > 0 else 0.0
    return {"goods": goods, "delivery_fee": 0.0, "amount": round(min(goods + tax, max(left, 0.0)), 2), "lines": lines}


def refund_report(db: Session, report_id: str, item_quantities: dict | None = None, everything: bool = False, note: str | None = None) -> dict:
    report = db.get(ProblemReport, uuid.UUID(report_id))
    if report is None or report.status != "open":
        raise ValueError("That report isn't open.")
    so = db.get(StoreOrder, report.store_order_id)
    payment = db.query(Payment).filter(Payment.order_id == so.order_id).first()
    if payment is None or orders._is_cash(payment) or not payment.stripe_payment_intent_id:
        raise ValueError("This was paid at the farm, so there's no card to refund. Settle it by hand, then mark it handled.")
    amounts = refund_amounts(db, report, item_quantities, everything)
    if amounts["amount"] <= 0:
        raise ValueError("Nothing to refund: choose items, or everything.")
    try:
        stripe_refund = stripe_client.create_refund(
            payment.stripe_payment_intent_id,
            amounts["amount"],
            reason=f"Problem reported: {REASONS.get(report.reason, report.reason)}",
            idempotency_key=f"refund-problem-{report.id}",
            store_order_id=str(so.id),
        )
    except stripe.error.StripeError as e:
        raise ValueError(f"Stripe refused the refund: {getattr(e, 'user_message', None) or e}")
    db.add(
        Refund(
            id=uuid.uuid4(),
            payment_id=payment.id,
            store_order_id=so.id,
            amount=amounts["amount"],
            reason=f"Problem reported: {REASONS.get(report.reason, report.reason)}",
            stripe_refund_id=stripe_refund.id,
            status="succeeded" if stripe_refund.status == "succeeded" else "pending",
            source="problem",
        )
    )
    payouts_service.create_problem_adjustment(db, so, amounts["goods"], amounts["delivery_fee"])
    report.status = "refunded"
    report.refund_amount = amounts["amount"]
    report.decision_note = (note or "").strip() or None
    report.decided_at = _now()
    db.commit()

    customer_id = db.query(Order.customer_id).filter(Order.id == so.order_id).scalar()
    notify(
        db,
        customer_id,
        "problem_refunded",
        {"farm_name": so.farm_name, "order_id": str(so.order_id), "amount": amounts["amount"], "note": report.decision_note},
        dedupe_key=f"problem_refunded:{report.id}",
    )
    farm_share = round(
        amounts["goods"] - round(amounts["goods"] * FARMER_COMMISSION_RATE, 2) + amounts["delivery_fee"], 2
    )
    if farm_share > 0:
        notify(
            db,
            so.farmer_id,
            "problem_refund_farmer",
            {"amount": farm_share, "reason": REASONS.get(report.reason, report.reason).lower(), "items": ", ".join(amounts["lines"])},
            dedupe_key=f"problem_refund_farmer:{report.id}",
        )
    return {"refunded": amounts["amount"], "farm_share": farm_share}


def decline_report(db: Session, report_id: str, note: str) -> None:
    report = db.get(ProblemReport, uuid.UUID(report_id))
    if report is None or report.status != "open":
        raise ValueError("That report isn't open.")
    if not (note or "").strip():
        raise ValueError("Say why, for the customer.")
    report.status = "declined"
    report.decision_note = note.strip()
    report.decided_at = _now()
    db.commit()
    so = db.get(StoreOrder, report.store_order_id)
    customer_id = db.query(Order.customer_id).filter(Order.id == so.order_id).scalar()
    notify(
        db,
        customer_id,
        "problem_declined",
        {"farm_name": so.farm_name, "order_id": str(so.order_id), "note": report.decision_note},
        dedupe_key=f"problem_declined:{report.id}",
    )


def mark_handled(db: Session, report_id: str, note: str | None) -> None:
    """Settled outside the app (a cash order paid back by hand, a call)."""
    report = db.get(ProblemReport, uuid.UUID(report_id))
    if report is None or report.status != "open":
        raise ValueError("That report isn't open.")
    report.status = "handled"
    report.decision_note = (note or "").strip() or None
    report.decided_at = _now()
    db.commit()
