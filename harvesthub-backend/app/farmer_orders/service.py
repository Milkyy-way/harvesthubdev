from collections import defaultdict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.core.pricing import FARMER_COMMISSION_RATE
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.orders import service as orders_service
from app.payments.models import Payment, Refund
from app.core.localtime import window_label

# Which store order statuses each Orders-tab segment shows.
_VIEW_STATUSES = {
    "to_prepare": ("pending_payment", "paid"),  # pending_payment only ever appears here for cash orders (released at placement)
    "ready": ("ready_for_pickup", "out_for_delivery"),  # waiting for pickup, or on today's delivery run
    "completed": ("completed",),
    "cancelled": ("cancelled",),
}
_ACTIVE_STATUSES = ("pending_payment", "paid", "ready_for_pickup", "out_for_delivery")


def _released_orders(db: Session, farmer_id):
    """The farmer's own store orders that have been released to them — the
    only ones a farmer ever sees (see 0025: card orders once paid, cash
    orders once placed)."""
    return (
        db.query(StoreOrder, Order, Payment, Profile)
        .join(Order, Order.id == StoreOrder.order_id)
        .join(Payment, Payment.order_id == Order.id)
        .join(Profile, Profile.id == Order.customer_id)
        .filter(StoreOrder.farmer_id == farmer_id, StoreOrder.released_to_farmer_at.isnot(None))
    )


def _build(db: Session, rows: list) -> list[dict]:
    store_order_ids = [so.id for so, _, _, _ in rows]
    if not store_order_ids:
        return []

    items_by_store_order: dict = defaultdict(list)
    for item in (
        db.query(StoreOrderItem)
        .filter(StoreOrderItem.store_order_id.in_(store_order_ids))
        .order_by(StoreOrderItem.product_name)
        .all()
    ):
        items_by_store_order[item.store_order_id].append(item)

    refunded_by_store_order = dict(
        db.query(Refund.store_order_id, func.sum(Refund.amount))
        .filter(Refund.store_order_id.in_(store_order_ids), Refund.status == "succeeded")
        .group_by(Refund.store_order_id)
        .all()
    )
    cancellations = orders_service.cancellations_for(db, store_order_ids)

    results = []
    for so, order, payment, customer in rows:
        active = so.status in _ACTIVE_STATUSES
        is_cash = payment.payment_method == "cash_on_pickup"
        goods = round(float(so.subtotal) - float(so.promo_discount), 2)
        # The delivery fee is the farm's in full; commission is on the goods.
        earnings = (
            round(goods - round(goods * FARMER_COMMISSION_RATE, 2) + float(so.delivery_fee or 0), 2)
            if so.status != "cancelled"
            else 0.0
        )
        is_delivery = so.fulfillment_method == "delivery"
        cancelled_by, reason = cancellations.get(so.id, (None, None))
        results.append(
            {
                "id": str(so.id),
                "order_id": str(order.id),
                "placed_at": order.placed_at.isoformat(),
                "status": so.status,
                "payment_method": payment.payment_method,
                "customer_name": customer.full_name,
                "customer_phone": customer.phone if active else None,
                "fulfillment_method": so.fulfillment_method,
                "delivery_window_label": (
                    window_label(so.delivery_window_starts_at, so.delivery_window_ends_at)
                    if is_delivery and so.delivery_window_starts_at
                    else None
                ),
                "delivery_address_line": (
                    ", ".join(
                        p
                        for p in (
                            so.delivery_address_street,
                            so.delivery_address_city,
                            f"{so.delivery_address_state or ''} {so.delivery_address_zip or ''}".strip(),
                        )
                        if p
                    )
                    if is_delivery and active
                    else None
                ),
                "delivery_fee": float(so.delivery_fee or 0),
                "items": [
                    {
                        "product_name": i.product_name,
                        "unit": i.unit,
                        "unit_price": float(i.unit_price),
                        "quantity": i.quantity,
                        "line_total": float(i.line_total),
                    }
                    for i in items_by_store_order.get(so.id, [])
                ],
                "subtotal": float(so.subtotal),
                "promo_code": so.promo_code,
                "promo_discount": float(so.promo_discount),
                "service_fee": float(so.service_fee),
                "tax": float(so.tax),
                "total": float(so.total),
                "estimated_earnings": earnings,
                "amount_to_collect": float(so.total) if is_cash and active else 0.0,
                "refunded_amount": float(refunded_by_store_order.get(so.id) or 0),
                "cancelled_by": cancelled_by if so.status == "cancelled" else None,
                "cancellation_reason": reason if so.status == "cancelled" else None,
            }
        )
    return results


def list_farmer_orders(db: Session, farmer_id, view: str) -> dict:
    statuses = _VIEW_STATUSES[view]
    q = _released_orders(db, farmer_id).filter(StoreOrder.status.in_(statuses))
    # Work queues oldest-first (first come, first packed); history newest-first.
    q = q.order_by(Order.placed_at.asc() if view in ("to_prepare", "ready") else Order.placed_at.desc())
    rows = q.all()

    count_by_status = dict(
        db.query(StoreOrder.status, func.count(StoreOrder.id))
        .filter(StoreOrder.farmer_id == farmer_id, StoreOrder.released_to_farmer_at.isnot(None))
        .group_by(StoreOrder.status)
        .all()
    )
    counts = {v: sum(count_by_status.get(s, 0) for s in sts) for v, sts in _VIEW_STATUSES.items()}
    return {"items": _build(db, rows), "counts": counts}


def get_farmer_order(db: Session, farmer_id, store_order_id) -> dict:
    rows = _released_orders(db, farmer_id).filter(StoreOrder.id == store_order_id).all()
    return _build(db, rows)[0]
