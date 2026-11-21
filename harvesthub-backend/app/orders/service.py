import logging
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
import stripe

from app.orders.models import Order, StoreOrder, StoreOrderItem, OrderCancellation
from app.payments.models import AWAITING_CUTOFF, Payment, Refund, PaymentCancellation
from app.payments import stripe_client
from app.products.models import Product
from app.categories.models import Category
from app.cart.models import CartItem
from app.farmers.models import FarmerProfile
from app.checkout.service import build_checkout_preview
from app.checkout.schemas import CheckoutGroupRequest
from app.orders.schemas import CreateOrderRequest
from app.payouts import service as payouts_service
from app.promotions import service as promotions_service
from app.ratings import service as ratings_service
from app.ratings.schemas import SubmitRatingRequest
from app.cart.service import _cart_totals
from app.notifications.service import Notice, notify, notify_many
from app.delivery import service as delivery_service
from app.delivery.models import FarmDeliverySettings
from app.customers.models import CustomerProfile
from app.membership import service as membership_service
from app.pods.models import Pod
from app.core.localtime import LOCAL_TZ, to_local
from app.pickup import rules as pickup_rules
from app.problems.models import ProblemReport

logger = logging.getLogger(__name__)

# Terminal from the customer's point of view — no further payment action
# will change these without a new attempt (we don't build retries yet).
_TERMINAL_PAYMENT_STATUSES = ("succeeded", "canceled", "failed")
# A card payment the customer hasn't made (2026-11-14): the payment sheet was
# closed, the card was declined, or the bank's check wasn't finished. Nothing
# has been charged. 'processing' is different: they paid and Stripe is still
# confirming it, so that order is placed.
_UNPAID_INTENT_STATUSES = ("requires_payment_method", "requires_confirmation", "requires_action")
# How long an unfinished checkout waits to be paid before it's removed
# (expire_unfinished_checkouts, on the scheduled job). Its stock is held
# meanwhile (0042), so this was cut from an hour (2026-11-20).
CHECKOUT_HOLD = timedelta(minutes=30)
_PAYMENT_PROCESSING = "Your payment is still going through. You can cancel once it's confirmed, usually within a few minutes."
_PROVIDER_UNREACHABLE = "We couldn't reach our payment provider. Please try again."
# Store order lifecycle (see 0025, 0032, 0042):
#   card pickup:   pending_payment -> paid -> ready_for_pickup -> completed | not_picked
#   cash pickup:   pending_payment ---------> ready_for_pickup -> completed | not_picked
#   card delivery: pending_payment -> paid -> out_for_delivery -> completed
# (delivery is card only; the farmer's run moves it along — app/delivery/.
# A pickup is handed over with the customer's code — app/pickup/.)
# What a customer can cancel (2026-11-20): nothing the farm has packed
# (ready_for_pickup), and a delivery only until the farm's cutoff — see
# cancel_terms. Anything wrong after the handover is "Report a problem"
# (app/problems/), which HarvestHub decides.
_CANCELLABLE_STORE_ORDER_STATUSES = ("pending_payment", "paid")
# Nothing more happens to these.
_FINISHED_STORE_ORDER_STATUSES = ("completed", "not_picked", "cancelled")
# Statuses whose cancellation needs a refund (a no-op for cash, which never
# captured money online) + a farmer ledger adjustment, and whose stock has
# definitely been taken — as opposed to 'pending_payment'.
_REFUNDABLE_STORE_ORDER_STATUSES = ("paid", "ready_for_pickup", "out_for_delivery", "completed")
# What a farmer can still cancel: anything not yet handed over — including a
# delivery they couldn't make ("Couldn't deliver").
_FARMER_CANCELLABLE_STORE_ORDER_STATUSES = ("pending_payment", "paid", "ready_for_pickup", "out_for_delivery")
# Customers can't cancel a delivery that's already on its way (it isn't in
# _CANCELLABLE_STORE_ORDER_STATUSES); they're told why.
_ON_ITS_WAY = "This order is already on its way, so it can't be cancelled now."
_POD_ORDERS_CLOSED = "Orders for this delivery have closed, so it can't be cancelled now."
_ALREADY_RECEIVED = "You've already received this order, so it can't be cancelled. If something was wrong with it, please contact support."
_DEAL_ORDER_LOCKED = "A group deal order can't be cancelled once the deal has closed. If the farm can't fill it, you'll be refunded in full."
_PACKED = (
    "The farm has already packed this order, so it can't be cancelled now. "
    "If something's wrong when you pick it up, you can report a problem."
)
_DELIVERY_CLOSED = "Orders for this delivery have closed and the farm is getting it ready, so it can't be cancelled now."
_NOT_PICKED = "The pickup time for this order has ended, so it can't be cancelled."
# A customer cancelling a pickup the farm hadn't packed within a day
# (pickup_rules.NOT_READY_LIMIT): it counts as the farm's cancellation.
FARM_NOT_READY_REASON = "The farm didn't have it ready within 24 hours"
# A Neighborhood Pod order saves a card, and is charged at the farm's cutoff
# (app/pods/charging.py).
POD_ORDER_PURPOSE = "pod_order"


def get_owned_order(db: Session, customer_id: str, order_id: str) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.customer_id == customer_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def checkout_unfinished(order: Order, store_orders: list, payment: Payment | None) -> bool:
    """A checkout the customer hasn't paid for yet (for a pod order: hasn't
    saved a card for). It isn't an order yet: no farm has seen it, no stock
    was taken, nothing was charged, and it isn't counted anywhere."""
    if order.abandoned_at is not None or payment is None or payment.payment_method == "cash_on_pickup":
        return False
    if payment.status not in _UNPAID_INTENT_STATUSES:
        return False
    if any(so.released_to_farmer_at is not None or so.group_deal_id for so in store_orders):
        return False
    return any(so.status == "pending_payment" for so in store_orders)


def _store_orders_of(db: Session, order_id) -> list:
    return db.query(StoreOrder).filter(StoreOrder.order_id == order_id).order_by(StoreOrder.created_at).all()


def _payment_of(db: Session, order_id) -> Payment | None:
    return db.query(Payment).filter(Payment.order_id == order_id).first()


def _unfinished_order_ids(db: Session, orders: list) -> set:
    """Which of these orders are unfinished checkouts, in two queries."""
    ids = [o.id for o in orders]
    if not ids:
        return set()
    payments = {p.order_id: p for p in db.query(Payment).filter(Payment.order_id.in_(ids))}
    store_orders: dict = defaultdict(list)
    for so in db.query(StoreOrder).filter(StoreOrder.order_id.in_(ids)):
        store_orders[so.order_id].append(so)
    return {o.id for o in orders if checkout_unfinished(o, store_orders[o.id], payments.get(o.id))}


def cancellations_for(db: Session, store_order_ids) -> dict:
    """store_order_id -> (cancelled_by_role, reason) for the ones that were
    cancelled — shown to the customer ("Cancelled by the farm: out of
    stock") and to the farmer."""
    if not store_order_ids:
        return {}
    rows = (
        db.query(OrderCancellation)
        .filter(OrderCancellation.store_order_id.in_(list(store_order_ids)))
        .order_by(OrderCancellation.created_at)
        .all()
    )
    return {c.store_order_id: (c.cancelled_by_role, c.reason) for c in rows}  # latest wins


def build_order_out(db: Session, order_id) -> dict:
    order = db.query(Order).filter(Order.id == order_id).first()
    store_orders = db.query(StoreOrder).filter(StoreOrder.order_id == order_id).order_by(StoreOrder.created_at).all()
    payment = db.query(Payment).filter(Payment.order_id == order_id).first()
    cancellation_by_store_order = cancellations_for(db, [so.id for so in store_orders])
    # Not paid for yet: the farm's street address is only shared once the
    # order is placed (2026-11-14), like the farm only sees the customer then.
    unfinished = checkout_unfinished(order, store_orders, payment)
    now = datetime.now(timezone.utc)
    reports = (
        {r.store_order_id: r for r in db.query(ProblemReport).filter(ProblemReport.store_order_id.in_([so.id for so in store_orders]))}
        if store_orders
        else {}
    )

    # Live-joined, not a snapshot — unlike price/address (frozen for
    # historical accuracy), a farm's photo has no legal/financial reason to
    # stay pinned to what it was at order time, so this just shows the
    # farm's current photo. Avoids a new snapshot column + migration.
    photo_by_farmer = dict(
        db.query(FarmerProfile.id, FarmerProfile.photo_url)
        .filter(FarmerProfile.id.in_({so.farmer_id for so in store_orders}))
        .all()
    )

    store_order_outs = []
    grand_total = 0.0
    for so in store_orders:
        items = (
            db.query(StoreOrderItem)
            .filter(StoreOrderItem.store_order_id == so.id)
            .order_by(StoreOrderItem.product_name)
            .all()
        )
        refunded = (
            db.query(func.coalesce(func.sum(Refund.amount), 0))
            .filter(Refund.store_order_id == so.id, Refund.status == "succeeded")
            .scalar()
        )
        rating = ratings_service.get_rating_for_store_order(db, so.id)
        cancelled_by, cancellation_reason = cancellation_by_store_order.get(so.id, (None, None))
        store_order_outs.append(
            {
                "id": str(so.id),
                "farmer_id": str(so.farmer_id),
                "farm_name": so.farm_name,
                "photo_url": photo_by_farmer.get(so.farmer_id),
                "my_rating": rating.rating if rating else None,
                "fulfillment_method": so.fulfillment_method,
                "pickup_address_street": None if unfinished else so.pickup_address_street,
                "pickup_address_city": so.pickup_address_city,
                "pickup_address_state": so.pickup_address_state,
                "pickup_address_zip": None if unfinished else so.pickup_address_zip,
                "delivery_address_street": so.delivery_address_street,
                "delivery_address_city": so.delivery_address_city,
                "delivery_address_state": so.delivery_address_state,
                "delivery_address_zip": so.delivery_address_zip,
                "subtotal": float(so.subtotal),
                "promo_code": so.promo_code,
                "promo_discount": float(so.promo_discount),
                "delivery_fee": float(so.delivery_fee),
                "service_fee": float(so.service_fee),
                "member_savings": float(so.member_savings or 0),
                "fixed_fee": float(so.fixed_fee or 0),
                "cash_discount": float(so.cash_discount or 0),
                "tax": float(so.tax),
                "total": float(so.total),
                "refunded_amount": float(refunded or 0),
                "status": so.status,
                "group_deal_id": str(so.group_deal_id) if so.group_deal_id else None,
                "cancelled_by": cancelled_by if so.status == "cancelled" else None,
                "cancellation_reason": cancellation_reason if so.status == "cancelled" else None,
                "delivery": delivery_service.progress_for(db, so),
                **_customer_actions(db, so, payment, store_orders, reports.get(so.id), now),
                "items": [
                    {
                        "id": str(i.id),
                        "product_id": str(i.product_id) if i.product_id else None,
                        "product_name": i.product_name,
                        "unit": i.unit,
                        "unit_price": float(i.unit_price),
                        "quantity": i.quantity,
                        "line_total": float(i.line_total),
                    }
                    for i in items
                ],
            }
        )
        grand_total += float(so.total)

    payment_out = None
    if payment:
        payment_out = {
            "id": str(payment.id),
            "amount": float(payment.amount),
            "currency": payment.currency,
            "payment_method": payment.payment_method,
            "status": payment.status,
            "failure_reason": payment.failure_reason,
            # The amount can still fall for a pod order; a deal's can't.
            "charged_at_cutoff": bool(payment.stripe_setup_intent_id) and not any(so.group_deal_id for so in store_orders),
        }

    return {
        "id": str(order.id),
        "status": order.status,
        "placed_at": order.placed_at.isoformat(),
        "grand_total": round(grand_total, 2),
        "store_orders": store_order_outs,
        "payment": payment_out,
        "checkout_unfinished": unfinished,
        "removed": order.abandoned_at is not None,
        "pay_by": (_as_utc(order.placed_at) + CHECKOUT_HOLD).isoformat() if unfinished else None,
    }


def list_orders(db: Session, customer_id: str, status_filter: str | None, range_key: str | None = None) -> list[dict]:
    # Removed checkouts never became orders (0041).
    q = db.query(Order).filter(Order.customer_id == customer_id, Order.abandoned_at.is_(None))
    if status_filter:
        q = q.filter(Order.status == status_filter)
    if range_key in _RANGE_WINDOWS:
        q = q.filter(Order.placed_at >= datetime.now(timezone.utc) - _RANGE_WINDOWS[range_key])
    orders = q.order_by(Order.placed_at.desc()).all()
    return [build_order_out(db, o.id) for o in orders]


def _take_stock(db: Session, store_order: StoreOrder, items: list[dict]) -> None:
    """Takes this farm's items off its products the moment checkout opens
    (2026-11-20), so two people can't buy the last one: each is a single
    UPDATE that only succeeds while enough is left. Given back if the
    checkout isn't paid (CHECKOUT_HOLD) or the order is cancelled. Raises
    409, rolling everything back, when something has run out."""
    for item in items:
        if not item.get("product_id"):
            continue
        taken = (
            db.query(Product)
            .filter(Product.id == item["product_id"], Product.quantity_available >= item["quantity"])
            .update({Product.quantity_available: Product.quantity_available - item["quantity"]}, synchronize_session=False)
        )
        if not taken:
            left = db.query(Product.quantity_available).filter(Product.id == item["product_id"]).scalar() or 0
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {left} of {item['name']} left — please update your cart",
            )
    store_order.stock_held = True


def _commit_inventory_and_clear_cart(db: Session, customer_id: str, order_id) -> None:
    """The point of no return for one order: count its promo codes as used,
    and drop the ordered items from the customer's active cart. Deliberately
    NOT called at order-creation time for card payments — only once payment
    is actually confirmed (see _finalize_successful_payment) — so a declined
    or abandoned payment never empties a cart for nothing. cash_on_pickup
    has no such failure mode, so it calls this immediately at creation.
    The stock was already taken when checkout opened (_take_stock, 0042);
    an order from before that takes it here.

    Only touches store orders still in 'pending_payment' — a farm cancelled
    out of a still-unpaid multi-farm order must keep its stock and its cart
    lines when the rest of the order is paid later. The row lock also makes
    a racing second call (webhook vs. the app's sync endpoint) wait, then
    find nothing left in 'pending_payment', so stock is never taken twice."""
    store_orders = (
        db.query(StoreOrder)
        .filter(StoreOrder.order_id == order_id, StoreOrder.status == "pending_payment")
        .with_for_update()
        .all()
    )
    for so in store_orders:
        promotions_service.record_promo_use(db, so.farmer_id, so.promo_code, customer_id, order_id)
        items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id).all()
        for item in items:
            if item.product_id:
                if not so.stock_held:
                    product = db.query(Product).filter(Product.id == item.product_id).first()
                    if product:
                        product.quantity_available = max(0, product.quantity_available - item.quantity)
                db.query(CartItem).filter(
                    CartItem.customer_id == customer_id, CartItem.product_id == item.product_id
                ).delete()
        so.stock_held = True


# --- Notifications (app/notifications/) — always sent after the commit ------------


def _item_count(db: Session, store_order_id) -> int:
    return db.query(func.count(StoreOrderItem.id)).filter(StoreOrderItem.store_order_id == store_order_id).scalar() or 0


def _is_cash(payment: Payment | None) -> bool:
    return payment is not None and payment.payment_method == "cash_on_pickup"


def _notify_order_placed(db: Session, order_id) -> None:
    """The customer's receipt, and "new order" to each farm it was released
    to. Dedupe keys make a second call (webhook + app sync racing) a no-op."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        return
    payment = db.query(Payment).filter(Payment.order_id == order_id).first()
    notices = [
        Notice(order.customer_id, "order_placed", {"order": build_order_out(db, order_id)}, f"order_placed:{order_id}")
    ]
    released = db.query(StoreOrder).filter(
        StoreOrder.order_id == order_id,
        StoreOrder.released_to_farmer_at.isnot(None),
        StoreOrder.status != "cancelled",
    )
    for so in released:
        notices.append(
            Notice(
                so.farmer_id,
                "new_order",
                {
                    "item_count": _item_count(db, so.id),
                    "total": float(so.subtotal),
                    "cash": _is_cash(payment),
                    "delivery_label": (
                        delivery_service.window_label(so.delivery_window_starts_at, so.delivery_window_ends_at)
                        if so.fulfillment_method == "delivery" and so.delivery_window_starts_at
                        else None
                    ),
                },
                f"new_order:{so.id}",
            )
        )
    notify_many(db, notices)


def _notify_farms_of_customer_cancellation(db: Session, store_orders: list[StoreOrder]) -> None:
    """Only farms that had the order (released to them) — an unpaid card
    order was never shown to the farm, so there's nothing to tell it."""
    notify_many(
        db,
        [
            Notice(
                so.farmer_id,
                "order_cancelled_by_customer",
                {"item_count": _item_count(db, so.id), "total": float(so.subtotal)},
                f"order_cancelled:{so.id}",
            )
            for so in store_orders
            if so.released_to_farmer_at is not None
        ],
    )


def create_order(db: Session, customer, request: CreateOrderRequest) -> tuple[dict, str | None]:
    customer_id = str(customer.id)
    if request.payment_method == "cash_on_pickup":
        blocked = pickup_rules.cash_blocked_reason(db, customer.id)
        if blocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=blocked)

    preview_groups = [
        CheckoutGroupRequest(
            farmer_id=g.farmer_id,
            fulfillment_method=g.fulfillment_method,
            promo_code=g.promo_code,
            delivery_starts_at=g.delivery_starts_at,
            pod_id=g.pod_id,
        )
        for g in request.groups
    ]
    preview = build_checkout_preview(db, customer_id, preview_groups, request.payment_method)
    if not preview["groups"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing in your cart for the selected farms")

    deliveries = [g for g in preview["groups"] if g["fulfillment_method"] == "delivery"]
    if deliveries and request.payment_method != "card":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delivery orders are paid by card.")
    for group in deliveries:
        if group["delivery_error"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"{group['farm_name']}: {group['delivery_error']}"
            )
    # A pod order is charged at its farm's cutoff, on its own.
    is_pod_order = any(g["pod_id"] for g in preview["groups"])
    if is_pod_order and len(preview["groups"]) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A pod order is charged at the farm's cutoff, so please place it on its own.",
        )
    stripe_customer = membership_service.get_or_create_stripe_customer(db, customer.id) if is_pod_order else None
    # Deliveries go to the customer's saved (and geocoded) address, or their
    # pod's drop point.
    home = db.get(CustomerProfile, customer.id) if deliveries else None

    order = Order(id=uuid.uuid4(), customer_id=customer.id)
    db.add(order)
    db.flush()

    # A cash order is fully placed right now (there's no online payment
    # step), so its farmers can see it — and the customer's name/phone —
    # immediately. A card order is released only once payment succeeds
    # (_finalize_successful_payment). The customer was told this at checkout.
    released_at = datetime.now(timezone.utc) if request.payment_method == "cash_on_pickup" else None

    for group in preview["groups"]:
        delivery = None
        if group["fulfillment_method"] == "delivery":
            delivery = db.get(Pod, uuid.UUID(group["pod_id"])) if group["pod_id"] else home
        store_order = StoreOrder(
            id=uuid.uuid4(),
            order_id=order.id,
            farmer_id=group["farmer_id"],
            farm_name=group["farm_name"],
            fulfillment_method=group["fulfillment_method"],
            pickup_address_street=group["address_street"],
            pickup_address_city=group["address_city"],
            pickup_address_state=group["address_state"],
            pickup_address_zip=group["address_zip"],
            delivery_address_street=(delivery.address_street if group["pod_id"] else delivery.street_line) if delivery else None,
            delivery_address_city=delivery.address_city if delivery else None,
            delivery_address_state=delivery.address_state if delivery else None,
            delivery_address_zip=delivery.address_zip if delivery else None,
            delivery_window_starts_at=group["delivery_window_starts_at"],
            delivery_window_ends_at=group["delivery_window_ends_at"],
            pod_id=group["pod_id"],
            pod_drop_version=group["pod_drop_version"],
            pod_full_fee=group["pod_full_fee"],
            subtotal=group["subtotal"],
            promo_code=group["promo_code"],
            promo_discount=group["promo_discount"],
            delivery_fee=group["delivery_fee"],
            service_fee=group["service_fee"],
            fixed_fee=group["fixed_fee"],
            cash_discount=group["cash_discount"],
            member_savings=group["member_savings"],
            tax=group["tax"],
            total=group["farm_total"],
            status="pending_payment",
            released_to_farmer_at=released_at,
        )
        db.add(store_order)
        db.flush()
        for item in group["items"]:
            db.add(
                StoreOrderItem(
                    id=uuid.uuid4(),
                    store_order_id=store_order.id,
                    product_id=item["product_id"],
                    product_name=item["name"],
                    unit=item["unit"],
                    unit_price=item["price"],
                    quantity=item["quantity"],
                    line_total=item["line_total"],
                    keep_cold=item["keep_cold"],
                )
            )
        _take_stock(db, store_order, group["items"])

    grand_total = preview["grand_total"]
    payment = Payment(
        id=uuid.uuid4(),
        order_id=order.id,
        customer_id=customer.id,
        amount=grand_total,
        currency="usd",
        payment_method=request.payment_method,
        provider="stripe" if request.payment_method != "cash_on_pickup" else "none",
        status="pending" if request.payment_method == "cash_on_pickup" else "requires_payment_method",
    )
    db.add(payment)
    db.flush()

    client_secret = None
    if request.payment_method == "cash_on_pickup":
        _commit_inventory_and_clear_cart(db, customer_id, order.id)
        db.commit()
        _notify_order_placed(db, order.id)
    elif is_pod_order:
        # Not placed until the card is saved (app/pods/charging.py).
        try:
            intent = stripe_client.create_setup_intent(
                stripe_customer, {"purpose": POD_ORDER_PURPOSE, "profile_id": customer_id, "order_id": str(order.id)}
            )
        except stripe.error.StripeError as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not start saving your card: {getattr(e, 'user_message', None) or str(e)}",
            )
        payment.stripe_setup_intent_id = intent.id
        client_secret = intent.client_secret
        db.commit()
    else:
        try:
            intent = stripe_client.create_payment_intent(grand_total, "usd", str(order.id), customer_id)
        except stripe.error.StripeError as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not start payment: {getattr(e, 'user_message', None) or str(e)}",
            )
        payment.stripe_payment_intent_id = intent.id
        payment.status = intent.status
        client_secret = intent.client_secret
        db.commit()

    return build_order_out(db, order.id), client_secret


def _finalize_successful_payment(db: Session, order_id, stock_taken: bool = False) -> None:
    """stock_taken: a pod order, which took its stock when it was placed."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        return
    if not stock_taken:
        _commit_inventory_and_clear_cart(db, str(order.customer_id), order_id)
    # Paid = fully placed: the farmer can now see the order (and the
    # customer's name/phone, as the customer was told at checkout).
    db.query(StoreOrder).filter(StoreOrder.order_id == order_id, StoreOrder.status == "pending_payment").update(
        {"status": "paid", "released_to_farmer_at": datetime.now(timezone.utc)}
    )
    # Delivery orders become stops on their window's run.
    for so in db.query(StoreOrder).filter(StoreOrder.order_id == order_id, StoreOrder.fulfillment_method == "delivery"):
        if so.status in ("paid", "out_for_delivery"):
            delivery_service.attach_to_run(db, so, order.customer_id)
    db.commit()
    _notify_order_placed(db, order_id)


def reconcile_payment_intent(
    db: Session,
    stripe_status: str,
    payment_intent_id: str,
    charge_id: str | None = None,
    failure_reason: str | None = None,
) -> None:
    """Shared by the Stripe webhook and the client-triggered sync endpoint —
    whichever gets there first wins; idempotent against being called twice
    for the same terminal state."""
    payment = db.query(Payment).filter(Payment.stripe_payment_intent_id == payment_intent_id).first()
    if not payment:
        return  # unrecognized intent (different environment/stale test data) — ignore, don't fail the caller

    if payment.status in _TERMINAL_PAYMENT_STATUSES:
        if payment.status == "canceled" and stripe_status == "succeeded":
            _refund_late_payment(payment_intent_id)
        return

    payment.status = stripe_status
    if charge_id:
        payment.stripe_charge_id = charge_id
    if failure_reason:
        payment.failure_reason = failure_reason
    db.commit()

    if stripe_status == "succeeded":
        _finalize_successful_payment(db, payment.order_id)
    elif stripe_status == "canceled":
        db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=failure_reason))
        db.commit()


def sync_payment_status(db: Session, customer_id: str, order_id: str) -> dict:
    order = get_owned_order(db, customer_id, order_id)
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    if not payment or not payment.stripe_payment_intent_id or payment.status in _TERMINAL_PAYMENT_STATUSES:
        return build_order_out(db, order.id)

    try:
        intent = stripe_client.retrieve_payment_intent(payment.stripe_payment_intent_id)
    except stripe.error.StripeError:
        return build_order_out(db, order.id)

    reconcile_payment_intent(
        db,
        intent.status,
        intent.id,
        charge_id=getattr(intent, "latest_charge", None),
        failure_reason=(intent.last_payment_error.message if getattr(intent, "last_payment_error", None) else None),
    )
    return build_order_out(db, order.id)


def _refund_late_payment(payment_intent_id: str) -> None:
    """Money arrived for an order we'd already cancelled as unpaid. The
    cancel paths check with Stripe before marking a payment cancelled, so
    this shouldn't happen; if it does, the customer gets it all back. Stripe
    keeps its fee on the refund. Logged as an error, to look into."""
    logger.error("Payment %s succeeded after its order was cancelled; refunding it in full", payment_intent_id)
    try:
        stripe_client.refund_in_full(payment_intent_id)
    except stripe.error.StripeError as e:
        logger.error("Could not refund late payment %s, refund it by hand: %s", payment_intent_id, e)


def _refresh_payment(db: Session, order: Order, payment: Payment | None) -> None:
    """Asks Stripe where an unpaid payment really stands (the webhook may be
    late): a card paid meanwhile is placed, and a pod order's saved card
    places it."""
    if payment is None or payment.payment_method == "cash_on_pickup":
        return
    if payment.stripe_payment_intent_id:
        if payment.status not in _TERMINAL_PAYMENT_STATUSES:
            sync_payment_status(db, str(order.customer_id), str(order.id))
    elif payment.stripe_setup_intent_id and payment.status == "requires_payment_method":
        from app.pods import charging as pod_charging  # it imports this module

        pod_charging.adopt_saved_card(db, order.customer_id, str(order.id))
    db.refresh(payment)


def _block_while_processing(db: Session, order: Order, payment: Payment | None) -> None:
    """A payment Stripe is still confirming can't be stopped, so the order
    can't be cancelled until it's confirmed (then it's refunded) or fails."""
    if payment is None or payment.status != "processing":
        return
    _refresh_payment(db, order, payment)
    if payment.status == "processing":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_PAYMENT_PROCESSING)


def _cancel_unpaid_intent(db: Session, payment: Payment) -> None:
    """Cancels a PaymentIntent nobody has paid, so it can never be charged.
    If Stripe says it was paid after all, records that (the order is placed)
    and raises 409, so the customer can cancel it again as a refund."""
    try:
        stripe_client.cancel_payment_intent(payment.stripe_payment_intent_id)
        return
    except stripe.error.StripeError:
        pass  # already cancelled, or no longer unpaid: ask Stripe which
    try:
        intent = stripe_client.retrieve_payment_intent(payment.stripe_payment_intent_id)
    except stripe.error.StripeError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_PROVIDER_UNREACHABLE)
    if intent.status == "canceled":
        return
    if intent.status in ("succeeded", "processing"):
        reconcile_payment_intent(db, intent.status, intent.id, charge_id=getattr(intent, "latest_charge", None))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_PAYMENT_PROCESSING
            if intent.status == "processing"
            else "Your payment just went through, so this order was placed. You can still cancel it, and you'll get a refund.",
        )
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_PROVIDER_UNREACHABLE)


def _abandon(db: Session, order: Order, payment: Payment, store_orders: list) -> bool:
    """Removes an unfinished checkout: its payment is cancelled with Stripe
    first, so it can never be charged, then the order is marked removed
    (0041), not cancelled: it was never an order. Returns False, removing
    nothing, if it turns out to have been paid or a card saved meanwhile
    (then it's placed). Commits."""
    _refresh_payment(db, order, payment)
    store_orders = _store_orders_of(db, order.id)
    if not checkout_unfinished(order, store_orders, payment):
        return False
    if payment.stripe_payment_intent_id:
        try:
            _cancel_unpaid_intent(db, payment)
        except HTTPException as e:
            if e.status_code == status.HTTP_409_CONFLICT:
                return False  # paid after all: it's placed now
            raise
    # A pod order's SetupIntent is left as it is: without the app it can't
    # save a card, and a saved card alone never charges anything.
    payment.status = "canceled"
    db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason="Checkout not finished"))
    for so in store_orders:
        if so.status == "pending_payment":
            _restore_stock(db, so)
            so.status = "cancelled"
    order.abandoned_at = datetime.now(timezone.utc)
    db.commit()
    return True


def discard_checkout(db: Session, customer_id: str, order_id: str) -> dict:
    """The customer closed the payment sheet, or tapped Remove on an order
    they didn't pay for: it goes, with no cancellation on their record."""
    order = get_owned_order(db, customer_id, order_id)
    if order.abandoned_at is not None:
        return {"removed": True, "order": None}
    store_orders, payment = _store_orders_of(db, order.id), _payment_of(db, order.id)
    if not checkout_unfinished(order, store_orders, payment):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This order has been placed, so it can't be removed. You can cancel it instead.",
        )
    if _abandon(db, order, payment, store_orders):
        return {"removed": True, "order": None}
    return {"removed": False, "order": build_order_out(db, order.id)}


def _still_available(db: Session, store_orders: list) -> None:
    """Before paying for an older checkout: everything in it can still be
    had. Prices stay as they were at checkout (it's at most an hour old)."""
    now = datetime.now(timezone.utc)
    for so in store_orders:
        if so.status != "pending_payment":
            continue
        if so.fulfillment_method == "delivery" and so.delivery_window_starts_at is not None:
            s = db.get(FarmDeliverySettings, so.farmer_id)
            if now >= so.delivery_window_starts_at - timedelta(hours=s.cutoff_hours if s else 0):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Orders for that {so.farm_name} delivery time have closed. Remove this one and check out again to pick another time.",
                )
        for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id):
            product = db.get(Product, item.product_id) if item.product_id else None
            # Its stock is still held for it (0042); an older one checks what's left.
            if product is None or not product.is_active or (not so.stock_held and product.quantity_available < item.quantity):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"{item.product_name} from {so.farm_name} isn't available in that amount any more. Remove this one and check out again.",
                )


def resume_payment(db: Session, customer, order_id: str) -> dict:
    """Pay for a checkout the customer left unfinished: the same payment sheet
    again, on the same PaymentIntent when Stripe allows it. Returns no
    client_secret when it turns out to be paid already."""
    customer_id = str(customer.id)
    order = get_owned_order(db, customer_id, order_id)
    payment = _payment_of(db, order.id)
    _refresh_payment(db, order, payment)
    store_orders = _store_orders_of(db, order.id)
    if not checkout_unfinished(order, store_orders, payment):
        if order.abandoned_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This checkout was removed. Your cart still has what's in stock, so please check out again.",
            )
        return {"order": build_order_out(db, order.id), "client_secret": None, "card_setup": False}
    if datetime.now(timezone.utc) >= _as_utc(order.placed_at) + CHECKOUT_HOLD:
        _abandon(db, order, payment, store_orders)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This checkout has expired. Your cart still has what's in stock, so please check out again.",
        )
    _still_available(db, store_orders)

    try:
        if payment.stripe_payment_intent_id:
            intent = stripe_client.retrieve_payment_intent(payment.stripe_payment_intent_id)
            if intent.status != "requires_payment_method":
                # Part-way through a bank check: start over on a fresh one,
                # cancelling the old so only one can ever be paid.
                _cancel_unpaid_intent(db, payment)
                intent = stripe_client.create_payment_intent(float(payment.amount), payment.currency, str(order.id), customer_id)
                payment.stripe_payment_intent_id = intent.id
                payment.status = intent.status
                db.commit()
            return {"order": build_order_out(db, order.id), "client_secret": intent.client_secret, "card_setup": False}
        # A pod order: save a card, as at checkout.
        setup = stripe_client.retrieve_setup_intent(payment.stripe_setup_intent_id)
        if setup.get("status") == "requires_payment_method":
            client_secret = setup.get("client_secret")
        else:
            stripe_customer = membership_service.get_or_create_stripe_customer(db, customer.id)
            fresh = stripe_client.create_setup_intent(
                stripe_customer, {"purpose": POD_ORDER_PURPOSE, "profile_id": customer_id, "order_id": str(order.id)}
            )
            payment.stripe_setup_intent_id = fresh.id
            db.commit()
            client_secret = fresh.client_secret
        return {"order": build_order_out(db, order.id), "client_secret": client_secret, "card_setup": True}
    except stripe.error.StripeError as e:
        logger.warning("Could not resume payment for order %s: %s", order.id, e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_PROVIDER_UNREACHABLE)


def expire_unfinished_checkouts(db: Session, limit: int = 50) -> int:
    """Scheduled job: checkouts nobody paid for within CHECKOUT_HOLD are
    removed, their payments cancelled with Stripe. Returns how many."""
    cutoff = datetime.now(timezone.utc) - CHECKOUT_HOLD
    candidates = (
        db.query(Order)
        .join(Payment, Payment.order_id == Order.id)
        .filter(
            Order.abandoned_at.is_(None),
            Order.placed_at < cutoff,
            Payment.payment_method != "cash_on_pickup",
            Payment.status.in_(_UNPAID_INTENT_STATUSES),
        )
        .order_by(Order.placed_at)
        .limit(limit)
        .all()
    )
    removed = 0
    for order in candidates:
        store_orders, payment = _store_orders_of(db, order.id), _payment_of(db, order.id)
        if not checkout_unfinished(order, store_orders, payment):
            continue
        try:
            if _abandon(db, order, payment, store_orders):
                removed += 1
        except HTTPException as e:
            db.rollback()
            logger.warning("Could not remove unfinished checkout %s: %s", order.id, e.detail)
    return removed


def _record_cancellation(order_id, store_order_id, cancelled_by, cancelled_by_role: str, reason: str | None) -> OrderCancellation:
    return OrderCancellation(
        id=uuid.uuid4(),
        order_id=order_id,
        store_order_id=store_order_id,
        cancelled_by=cancelled_by,
        cancelled_by_role=cancelled_by_role,
        reason=reason,
    )


def _stock_was_taken(payment: Payment | None, store_order: StoreOrder) -> bool:
    """Whether this store order's stock is off the products — from checkout
    on (0042), until it's given back."""
    return bool(store_order.stock_held)


def _restore_stock(db: Session, store_order: StoreOrder) -> None:
    """Puts this store order's stock back on its products, once."""
    if not store_order.stock_held:
        return
    items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == store_order.id).all()
    for item in items:
        if item.product_id:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if product:
                product.quantity_available += item.quantity if item.stock_units is None else item.stock_units
    store_order.stock_held = False


def _restore_stock_and_promo(db: Session, store_order: StoreOrder) -> None:
    """Undoes the order for one cancelled store order: the stock goes back
    and the promo code gets its use back."""
    promotions_service.release_promo_use(db, store_order.farmer_id, store_order.promo_code, store_order.order_id)
    _restore_stock(db, store_order)


def _as_aware(value):
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value) -> str | None:
    return _as_aware(value).isoformat() if value else None


def _farm_late(store_order: StoreOrder, now: datetime) -> bool:
    """A pickup the farm hasn't packed within a day of getting it."""
    return (
        store_order.fulfillment_method == "pickup"
        and store_order.status in ("paid", "pending_payment")
        and store_order.released_to_farmer_at is not None
        and not store_order.group_deal_id
        and now >= _as_aware(store_order.released_to_farmer_at) + pickup_rules.NOT_READY_LIMIT
    )


def _delivery_closed(db: Session, store_order: StoreOrder, now: datetime) -> bool:
    """A paid home delivery after the farm's cutoff for its window: the farm
    is getting it ready (decided 2026-11-20). Pod orders: _pod_orders_closed."""
    if store_order.fulfillment_method != "delivery" or store_order.pod_full_fee is not None:
        return False
    if store_order.status != "paid" or store_order.delivery_window_starts_at is None:
        return False
    s = db.get(FarmDeliverySettings, store_order.farmer_id)
    return now >= _as_aware(store_order.delivery_window_starts_at) - timedelta(hours=s.cutoff_hours if s else 0)


def farm_cancel_amounts(db: Session, store_order: StoreOrder, siblings: list | None = None) -> tuple[float, float]:
    """(back to the customer, charged to the farm) when a paid farm's part is
    cancelled through no fault of the customer: the farm cancelled it, or
    didn't pack it within a day. The customer gets the whole part back and
    the farm pays its service fee — on a Harvest Pass order, the 5% the fee
    would have been (2026-11-20). The 30¢ belongs to the payment: it stays
    while other farms' parts of it go ahead, and when this is the last part
    it comes back, with any 30¢ kept from an earlier farm's cancel, paid by
    this farm. Work it out BEFORE the store order's status changes."""
    siblings = siblings if siblings is not None else _store_orders_of(db, store_order.order_id)
    others = [s for s in siblings if s.id != store_order.id]
    total, fixed = float(store_order.total), float(store_order.fixed_fee or 0)
    charge = float(store_order.service_fee) + float(store_order.member_savings or 0)
    if any(s.status != "cancelled" for s in others):
        return round(total - fixed, 2), round(charge - fixed, 2)
    with_fixed = [s for s in others if float(s.fixed_fee or 0) > 0]
    cancellations = cancellations_for(db, [s.id for s in with_fixed])
    kept = sum(
        float(s.fixed_fee)
        for s in with_fixed
        if s.id in cancellations and (cancellations[s.id][0] == "farmer" or cancellations[s.id][1] == FARM_NOT_READY_REASON)
    )
    return round(total + kept, 2), round(charge + kept, 2)


def cancel_terms(db: Session, store_order: StoreOrder, payment: Payment | None, siblings: list, now: datetime) -> dict:
    """Whether the customer can cancel this farm's part now, and what they'd
    get back (decided 2026-11-20):
      * not once the farm has packed it, a delivery after the farm's cutoff, a
        pod order after the cutoff, a group deal order, or while a payment is
        still going through;
      * a paid part: everything back except the service fee;
      * a pickup the farm hasn't packed within a day: everything back, and it
        counts as the farm's cancellation (farm_late)."""

    def no(reason: str | None) -> dict:
        return {"can": False, "reason": reason, "refund": 0.0, "keeps_fee": False, "farm_late": False}

    if store_order.status == "cancelled":
        return no(None)
    if store_order.status == "completed":
        return no(_ALREADY_RECEIVED)
    if store_order.status == "not_picked":
        return no(_NOT_PICKED)
    if store_order.status == "ready_for_pickup":
        return no(_PACKED)
    if store_order.status == "out_for_delivery":
        return no(_ON_ITS_WAY)
    if store_order.group_deal_id:
        return no(_DEAL_ORDER_LOCKED)
    if payment is not None and payment.status == "processing":
        return no(_PAYMENT_PROCESSING)
    if _pod_orders_closed(db, store_order, payment):
        return no(_POD_ORDERS_CLOSED)
    if _delivery_closed(db, store_order, now):
        return no(_DELIVERY_CLOSED)
    late = _farm_late(store_order, now)
    if store_order.status != "paid" or _is_cash(payment):
        # Nothing paid yet: an unpaid card checkout, a cash order, a pod order before its charge.
        return {"can": True, "reason": None, "refund": 0.0, "keeps_fee": False, "farm_late": late}
    if late:
        refund, _ = farm_cancel_amounts(db, store_order, siblings)
        return {"can": True, "reason": None, "refund": refund, "keeps_fee": False, "farm_late": True}
    fee = float(store_order.service_fee)
    return {"can": True, "reason": None, "refund": round(float(store_order.total) - fee, 2), "keeps_fee": fee > 0, "farm_late": False}


def _customer_actions(db: Session, so: StoreOrder, payment: Payment | None, siblings: list, report, now: datetime) -> dict:
    """What the customer can do with this farm's part now — for the app."""
    terms = cancel_terms(db, so, payment, siblings, now)
    pickup = None
    if so.fulfillment_method == "pickup":
        late_until = _as_aware(so.not_picked_at) + pickup_rules.LATE_CONFIRM if so.not_picked_at else None
        show_code = so.status == "ready_for_pickup" or (so.status == "not_picked" and late_until is not None and now < late_until)
        pickup = {
            "ready_at": _iso(so.ready_at),
            "starts_at": _iso(so.pickup_starts_at),
            "ends_at": _iso(so.pickup_ends_at),
            "extended": so.pickup_extended_at is not None,
            "can_extend": so.status == "ready_for_pickup"
            and so.pickup_extended_at is None
            and so.pickup_ends_at is not None
            and now < _as_aware(so.pickup_ends_at),
            "code": so.pickup_code if show_code else None,
            "picked_up_at": _iso(so.completed_at) if so.status == "completed" else None,
            "not_picked_at": _iso(so.not_picked_at),
            # Not packed by then: the customer can cancel with everything back.
            "free_cancel_from": (
                _iso(_as_aware(so.released_to_farmer_at) + pickup_rules.NOT_READY_LIMIT)
                if so.status in ("paid", "pending_payment") and so.released_to_farmer_at and not so.group_deal_id
                else None
            ),
        }
    finished_at = so.completed_at if so.status == "completed" else so.not_picked_at if so.status == "not_picked" else None
    report_until = _as_aware(finished_at) + pickup_rules.REPORT_WINDOW if finished_at else None
    return {
        "can_cancel": terms["can"],
        "cancel_blocked_reason": terms["reason"],
        "cancel_refund": terms["refund"],
        "cancel_keeps_service_fee": terms["keeps_fee"],
        "pickup": pickup,
        "completed_at": _iso(so.completed_at),
        "problem": (
            {
                "status": report.status,
                "reason": report.reason,
                "created_at": _iso(report.created_at),
                "refund_amount": float(report.refund_amount) if report.refund_amount is not None else None,
                "note": report.decision_note,
            }
            if report
            else None
        ),
        "can_report_problem": report is None and report_until is not None and now < report_until,
        "report_until": report_until.isoformat() if report_until else None,
        # A cash order not picked up: "Did you collect it?" (the farm may have skipped the code).
        "ask_collected": so.status == "not_picked"
        and _is_cash(payment)
        and so.collected_answer is None
        and so.not_picked_at is not None
        and now < _as_aware(so.not_picked_at) + timedelta(days=7),
    }


def _sync_cash_payment_status(db: Session, order_id, payment: Payment | None) -> None:
    """A cash payment has no Stripe object reporting its status, so derive
    it from the store orders: 'pending' while any farm still awaits pickup,
    'succeeded' once everything not cancelled was collected, 'canceled' if
    every farm was cancelled."""
    if payment is None or payment.payment_method != "cash_on_pickup":
        return
    db.flush()  # autoflush is off — the caller's status change must be visible to the query below
    statuses = {s for (s,) in db.query(StoreOrder.status).filter(StoreOrder.order_id == order_id).all()}
    if statuses & {"pending_payment", "ready_for_pickup"}:
        payment.status = "pending"
    elif "completed" in statuses:
        payment.status = "succeeded"
    else:
        payment.status = "canceled"


def _pod_orders_closed(db: Session, store_order: StoreOrder, payment: Payment | None) -> bool:
    """Customers can't cancel a pod order once the farm's orders have closed
    (decided with the user 2026-10-31): they've had until the cutoff to decide,
    and the others' shares were worked out counting them. Before that it's free,
    because nothing has been paid. A farm that can't deliver still refunds in
    full, and an order never placed (no card saved) can always go."""
    if store_order.pod_full_fee is None or payment is None or payment.status == "requires_payment_method":
        return False
    if store_order.status == "cancelled":
        return False
    if store_order.status != "pending_payment":
        return True
    s = db.get(FarmDeliverySettings, store_order.farmer_id)
    cutoff = store_order.delivery_window_starts_at - timedelta(hours=s.cutoff_hours if s else 0)
    return payment.status != AWAITING_CUTOFF or datetime.now(timezone.utc) >= cutoff


def _refund_store_order(
    db: Session, payment: Payment, store_order: StoreOrder, reason: str | None, amount: float | None = None
) -> float:
    """Refunds `amount` of this farm's part to the card (default: all of it),
    at most once — the idempotency key makes a repeat return the same refund.
    Returns what went back (0 for cash, which never captured money online)."""
    if payment.payment_method == "cash_on_pickup":
        return 0.0
    amount = round(float(store_order.total) if amount is None else amount, 2)
    if amount <= 0:
        return 0.0

    try:
        stripe_refund = stripe_client.create_refund(
            payment.stripe_payment_intent_id,
            amount,
            reason=reason,
            idempotency_key=f"refund-cancel-{store_order.id}",
            store_order_id=str(store_order.id),
        )
    except stripe.error.StripeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Refund failed: {getattr(e, 'user_message', None) or str(e)}",
        )
    db.add(
        Refund(
            id=uuid.uuid4(),
            payment_id=payment.id,
            store_order_id=store_order.id,
            amount=amount,
            reason=reason,
            stripe_refund_id=stripe_refund.id,
            status="succeeded" if stripe_refund.status == "succeeded" else "pending",
            source="cancel",
        )
    )
    return amount


# How Stripe's refund statuses end up in ours (0013 allows pending, succeeded, failed).
_FINAL_REFUND_STATUSES = {"succeeded": "succeeded", "failed": "failed", "canceled": "failed"}


def sync_pending_refunds(db: Session, limit: int = 50) -> int:
    """Scheduled job: a refund Stripe didn't finish at once is saved as
    'pending' (_refund_store_order), so ask Stripe how it ended. A failed one
    means the money didn't go back: it's logged, and shows in the refunds query
    for HarvestHub to refund by hand. Returns how many changed."""
    pending = (
        db.query(Refund)
        .filter(Refund.status == "pending", Refund.stripe_refund_id.isnot(None))
        .order_by(Refund.created_at)
        .limit(limit)
        .all()
    )
    changed = 0
    for refund in pending:
        try:
            stripe_status = stripe_client.retrieve_refund(refund.stripe_refund_id).status
        except stripe.error.StripeError as e:
            logger.warning("Could not check refund %s: %s", refund.stripe_refund_id, e)
            continue
        final = _FINAL_REFUND_STATUSES.get(stripe_status)
        if final is None:
            continue  # still on its way
        refund.status = final
        changed += 1
        if final == "failed":
            logger.error("Refund %s of $%s for store order %s %s", refund.stripe_refund_id, refund.amount, refund.store_order_id, stripe_status)
    db.commit()
    return changed


def cancel_store_order(
    db: Session, customer_id: str, order_id: str, store_order_id: str, cancelled_by_role: str, cancelled_by, reason: str | None
) -> dict:
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    if store_order.status == "out_for_delivery":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_ON_ITS_WAY)
    payment = _payment_of(db, order.id)
    _block_while_processing(db, order, payment)
    store_orders = _store_orders_of(db, order.id)
    # The last farm on a checkout nobody paid for: the whole checkout goes, and
    # it isn't counted as a cancelled order (older app builds cancel these).
    if (
        checkout_unfinished(order, store_orders, payment)
        and store_order.status == "pending_payment"
        and sum(1 for so in store_orders if so.status == "pending_payment") == 1
        and _abandon(db, order, payment, store_orders)
    ):
        return build_order_out(db, order.id)
    db.refresh(store_order)
    payment = _payment_of(db, order.id)
    if store_order.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This part of the order is already cancelled.")
    terms = cancel_terms(db, store_order, payment, _store_orders_of(db, order.id), datetime.now(timezone.utc))
    if not terms["can"]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=terms["reason"] or "This order can't be cancelled now.")

    farm_fee = 0.0
    if terms["farm_late"]:
        reason = FARM_NOT_READY_REASON
        if store_order.status in _REFUNDABLE_STORE_ORDER_STATUSES and not _is_cash(payment):
            farm_fee = farm_cancel_amounts(db, store_order)[1]
    refunded = _cancel_one_store_order(
        db, order, store_order, cancelled_by, cancelled_by_role, reason, refund_amount=terms["refund"]
    )
    if refunded and farm_fee > 0:
        payouts_service.create_cancellation_fee_entry(db, store_order, farm_fee)
    delivery_service.release_stop(db, store_order)
    db.commit()
    if terms["farm_late"]:
        _notify_farm_not_ready(db, store_order, farm_fee if refunded else 0.0)
    else:
        _notify_farms_of_customer_cancellation(db, [store_order])
    return build_order_out(db, order.id)


def _notify_farm_not_ready(db: Session, store_order: StoreOrder, fee: float) -> None:
    if store_order.released_to_farmer_at is None:
        return
    notify(
        db,
        store_order.farmer_id,
        "order_cancelled_not_ready",
        {"item_count": _item_count(db, store_order.id), "total": float(store_order.subtotal), "fee": fee},
        dedupe_key=f"order_cancelled:{store_order.id}",
    )


def _cancel_one_store_order(
    db: Session,
    order: Order,
    store_order: StoreOrder,
    cancelled_by,
    cancelled_by_role: str,
    reason: str | None,
    refund_amount: float | None = None,
) -> float:
    """Cancels one farm's part of an order — shared by the customer's and the
    farmer's cancel actions. Refunds refund_amount of what was paid (default:
    the whole part; the callers work it out — cancel_terms, farm_cancel_amounts),
    restores stock that was taken, adjusts the farmer ledger, and records who
    cancelled. Does NOT commit. Returns what was refunded to a card."""
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    stock_taken = _stock_was_taken(payment, store_order)
    refunded = 0.0

    if store_order.status in _REFUNDABLE_STORE_ORDER_STATUSES:
        refunded = _refund_store_order(db, payment, store_order, reason, refund_amount)
        payouts_service.handle_refund_ledger_adjustment(db, store_order)
    elif payment and payment.stripe_setup_intent_id and not payment.stripe_payment_intent_id:
        # A pod order before its charge: no money has moved, so nothing to refund.
        payment.status = "canceled"
        db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=reason))
    elif payment and payment.payment_method == "card" and payment.status not in _TERMINAL_PAYMENT_STATUSES:
        sibling_count = (
            db.query(StoreOrder)
            .filter(StoreOrder.order_id == order.id, StoreOrder.status.in_(_CANCELLABLE_STORE_ORDER_STATUSES))
            .count()
        )
        if sibling_count <= 1:
            # Only store order left on this PaymentIntent — cancel it outright.
            # Raises if Stripe says it was paid meanwhile (then it's placed).
            _cancel_unpaid_intent(db, payment)
            payment.status = "canceled"
            db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=reason))
        else:
            # Still-unpaid multi-farm order — shrink the shared PaymentIntent's
            # amount instead of cancelling it, so sibling stores can still pay.
            new_amount = round(float(payment.amount) - float(store_order.total), 2)
            try:
                stripe.PaymentIntent.modify(payment.stripe_payment_intent_id, amount=stripe_client.to_cents(new_amount))
            except stripe.error.StripeError:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This farm can't be removed individually right now — cancel the whole order and re-checkout instead.",
                )
            payment.amount = new_amount

    if stock_taken:
        _restore_stock_and_promo(db, store_order)
    store_order.status = "cancelled"
    db.add(_record_cancellation(order.id, store_order.id, cancelled_by, cancelled_by_role, reason))
    _sync_cash_payment_status(db, order.id, payment)
    return refunded


def cancel_whole_order(db: Session, customer_id: str, order_id: str, cancelled_by_role: str, cancelled_by, reason: str | None) -> dict:
    """Every farm's part that's still open — only if each one can be
    cancelled now (cancel_terms); otherwise nothing is, and the customer is
    told which farm's part is locked."""
    order = get_owned_order(db, customer_id, order_id)
    if not [so for so in _store_orders_of(db, order.id) if so.status not in _FINISHED_STORE_ORDER_STATUSES]:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nothing left to cancel on this order")

    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    _block_while_processing(db, order, payment)
    # A checkout nobody paid for is removed, not counted as a cancelled order
    # (older app builds cancel these).
    if checkout_unfinished(order, _store_orders_of(db, order.id), payment) and _abandon(db, order, payment, _store_orders_of(db, order.id)):
        return build_order_out(db, order.id)
    now = datetime.now(timezone.utc)
    siblings = _store_orders_of(db, order.id)
    store_orders = [so for so in siblings if so.status not in _FINISHED_STORE_ORDER_STATUSES]
    late = {}
    for so in store_orders:
        terms = cancel_terms(db, so, payment, siblings, now)
        if not terms["can"]:
            detail = terms["reason"] or "This order can't be cancelled now."
            if len(store_orders) > 1:
                detail = f"{so.farm_name}: {detail} You can still cancel the other farms one at a time."
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
        late[so.id] = terms["farm_late"]
    # The farm's-fault parts last, so a 30¢ kept on the way comes back with them.
    refundable = sorted((so for so in store_orders if so.status in _REFUNDABLE_STORE_ORDER_STATUSES), key=lambda so: late[so.id])
    pending = [so for so in store_orders if so.status == "pending_payment"]
    late_fees: dict = {}

    for so in refundable:
        terms = cancel_terms(db, so, payment, _store_orders_of(db, order.id), now)
        so_reason = FARM_NOT_READY_REASON if terms["farm_late"] else reason
        fee = farm_cancel_amounts(db, so)[1] if terms["farm_late"] and not _is_cash(payment) else 0.0
        refunded = _refund_store_order(db, payment, so, so_reason, terms["refund"])
        payouts_service.handle_refund_ledger_adjustment(db, so)
        _restore_stock_and_promo(db, so)
        so.status = "cancelled"
        db.add(_record_cancellation(order.id, so.id, cancelled_by, cancelled_by_role, so_reason))
        if refunded and fee > 0:
            payouts_service.create_cancellation_fee_entry(db, so, fee)
        if terms["farm_late"]:
            late_fees[so.id] = fee if refunded else 0.0
        db.flush()  # the next part's terms see this one cancelled

    if pending:
        late_fees.update({so.id: 0.0 for so in pending if late[so.id]})
        if payment and payment.stripe_setup_intent_id and not payment.stripe_payment_intent_id:
            # A pod order before its charge: no money has moved.
            stock_taken = {so.id: _stock_was_taken(payment, so) for so in pending}
            payment.status = "canceled"
            db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=reason))
            for so in pending:
                if stock_taken[so.id]:
                    _restore_stock_and_promo(db, so)
                so.status = "cancelled"
                db.add(_record_cancellation(order.id, so.id, cancelled_by, cancelled_by_role, reason))
            pending = []
        elif payment and payment.payment_method == "card" and payment.status not in _TERMINAL_PAYMENT_STATUSES:
            # Raises if Stripe says it was paid meanwhile (then it's placed).
            _cancel_unpaid_intent(db, payment)
            payment.status = "canceled"
            db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=reason))
        for so in pending:
            if _stock_was_taken(payment, so):  # cash orders take stock at placement
                _restore_stock_and_promo(db, so)
            so.status = "cancelled"
            db.add(_record_cancellation(order.id, so.id, cancelled_by, cancelled_by_role, reason))

    _sync_cash_payment_status(db, order.id, payment)
    for so in store_orders:
        delivery_service.release_stop(db, so)
    db.commit()
    _notify_farms_of_customer_cancellation(db, [so for so in store_orders if so.id not in late_fees])
    for so in store_orders:
        if so.id in late_fees:
            _notify_farm_not_ready(db, so, late_fees[so.id])
    return build_order_out(db, order.id)


def _owned_delivery(db: Session, customer_id: str, order_id: str, store_order_id: str) -> StoreOrder:
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    return store_order


def delivery_photo_url(db: Session, customer_id: str, order_id: str, store_order_id: str) -> str | None:
    """The proof-of-delivery photo for one of the customer's own orders."""
    return delivery_service.photo_url(db, _owned_delivery(db, customer_id, order_id, store_order_id))


def delivery_tracking(db: Session, customer_id: str, order_id: str, store_order_id: str) -> dict:
    """Live tracking for one of the customer's own delivery orders."""
    tracking = delivery_service.tracking_for(db, _owned_delivery(db, customer_id, order_id, store_order_id))
    if tracking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This isn't a delivery order")
    return tracking


def mark_store_order_completed(db: Session, customer_id: str, order_id: str, store_order_id: str) -> dict:
    """The customer's old "Mark as received". Since 2026-11-20 only the farm
    can hand an order over, with the customer's 4-digit code
    (app/pickup/service.py::hand_over) — so this always refuses. Older app
    builds still show the button."""
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The farm now confirms pickup with your 4-digit code. Please update the app to see it.",
    )


# --- Farmer-side actions (Farmer F3) -----------------------------------------


def get_farmer_store_order(db: Session, farmer_id, store_order_id: str) -> StoreOrder:
    """A store order the farmer is allowed to act on: theirs, and released to
    them (paid by card, or placed as cash). Anything else 404s — a farmer
    can't even confirm an unreleased order exists."""
    try:
        sid = uuid.UUID(store_order_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    store_order = (
        db.query(StoreOrder)
        .filter(StoreOrder.id == sid, StoreOrder.farmer_id == farmer_id, StoreOrder.released_to_farmer_at.isnot(None))
        .first()
    )
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return store_order


def farmer_cancel_store_order(db: Session, farmer_id, store_order_id: str, reason: str) -> StoreOrder:
    """The farm can't fill the order (out of stock, ...). The customer gets
    their part back in full; the farmer bears the service fee — on a Harvest
    Pass order the 5% it would have been — deducted from their next payout
    (farm_cancel_amounts). Cancelling a cash order costs the farmer nothing —
    no money was collected."""
    store_order = get_farmer_store_order(db, farmer_id, store_order_id)
    if store_order.status not in _FARMER_CANCELLABLE_STORE_ORDER_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This order can't be cancelled (current status: '{store_order.status}')",
        )
    order = db.query(Order).filter(Order.id == store_order.order_id).one()
    refund_amount, farm_fee = None, 0.0
    if store_order.status in _REFUNDABLE_STORE_ORDER_STATUSES and not _is_cash(_payment_of(db, order.id)):
        refund_amount, farm_fee = farm_cancel_amounts(db, store_order)
    refunded = _cancel_one_store_order(db, order, store_order, farmer_id, "farmer", reason, refund_amount=refund_amount)
    if refunded:
        payouts_service.create_cancellation_fee_entry(db, store_order, farm_fee)
    run = delivery_service.release_stop(db, store_order)
    db.commit()
    delivery_service.notify_after_release(db, run)
    notify(
        db,
        order.customer_id,
        "order_cancelled_by_farm",
        {
            "farm_name": store_order.farm_name,
            "order_id": str(order.id),
            "reason": reason,
            "refund_amount": refunded,
        },
        dedupe_key=f"order_cancelled:{store_order.id}",
    )
    return store_order


def submit_store_order_rating(
    db: Session, customer_id: str, order_id: str, store_order_id: str, payload: SubmitRatingRequest
) -> dict:
    """Only once a store order is 'completed' — a customer rates the
    experience they actually had, not one still in progress. Submitting
    again revises the existing rating (see ratings_service.submit_rating)
    rather than failing or stacking duplicates."""
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    if store_order.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only a completed order can be rated (current status: '{store_order.status}')",
        )
    ratings_service.submit_rating(db, customer_id, store_order.farmer_id, store_order.id, payload)
    db.commit()
    return build_order_out(db, order.id)


def reorder(db: Session, customer_id: str, order_id: str) -> dict:
    """Re-adds a past order's items to the customer's cart ('Rebook') —
    skips anything no longer active or out of stock rather than failing
    the whole action, and caps each item at whatever room is actually left
    (current stock minus whatever's already in the cart), never oversells.
    Never re-adds more than the original line's own quantity even if more
    stock is now available — reordering isn't a chance to buy extra."""
    order = get_owned_order(db, customer_id, order_id)
    store_order_ids = [so.id for so in db.query(StoreOrder).filter(StoreOrder.order_id == order.id).all()]
    items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id.in_(store_order_ids)).all()

    added_count = 0
    skipped_count = 0
    for item in items:
        product = (
            db.query(Product).filter(Product.id == item.product_id, Product.is_active.is_(True)).first()
            if item.product_id
            else None
        )
        if not product:
            skipped_count += 1
            continue

        cart_item = (
            db.query(CartItem).filter(CartItem.customer_id == customer_id, CartItem.product_id == item.product_id).first()
        )
        current_qty = cart_item.quantity if cart_item else 0
        room = product.quantity_available - current_qty
        if room <= 0:
            skipped_count += 1
            continue

        add_qty = min(item.quantity, room)
        if cart_item:
            cart_item.quantity += add_qty
        else:
            db.add(CartItem(id=uuid.uuid4(), customer_id=customer_id, product_id=item.product_id, quantity=add_qty))
        added_count += 1
        if add_qty < item.quantity:
            skipped_count += 1  # partially added — still flag it so the UI can say so

    db.commit()
    _, cart_item_count = _cart_totals(db, customer_id)
    return {"added_count": added_count, "skipped_count": skipped_count, "cart_item_count": cart_item_count}


# Statuses that represent money actually kept by a farmer — a cancelled
# store_order was refunded (or never captured), so it contributes nothing
# to spending/savings/insights even if the parent order also has paid
# siblings.
_KEPT_STORE_ORDER_STATUSES = ("paid", "ready_for_pickup", "out_for_delivery", "completed", "not_picked")


# Rolling windows, not calendar-based (no "this month" edge cases to
# reason about) — 'all' or an unrecognized/missing key means no lower
# bound at all (genuine all-time), which is also what Account's own
# dashboard-summary call (no range param) relies on for its stat tiles.
_RANGE_WINDOWS = {
    "week": timedelta(days=7),
    "month": timedelta(days=30),
    "3m": timedelta(days=90),
    "6m": timedelta(days=180),
}


# Calendar periods for the Dashboard's month/year arrows, in the marketplace's
# local time (a 9 PM order on Oct 31 in DC belongs to October). `range_key`
# above stays for app builds that still send the rolling windows.
_CALENDAR_PERIODS = ("month", "year")


def _period_bounds(period: str, start: date | None) -> tuple[date, date, date]:
    """(previous period's first day, this period's first day, next period's
    first day) for the calendar month or year holding `start` (today, local
    time, when absent)."""
    day = start or datetime.now(LOCAL_TZ).date()
    if period == "year":
        return date(day.year - 1, 1, 1), date(day.year, 1, 1), date(day.year + 1, 1, 1)
    first = date(day.year, day.month, 1)
    following = date(day.year + (day.month == 12), day.month % 12 + 1, 1)
    previous = date(day.year - (day.month == 1), (day.month - 2) % 12 + 1, 1)
    return previous, first, following


def _local_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=LOCAL_TZ)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _money(kept_store_orders: list) -> tuple[float, float]:
    """(spent, saved) on these store orders. Saved = promo codes plus what
    Harvest Pass took off (the waived service fee)."""
    spent = round(sum(float(so.total) for so in kept_store_orders), 2)
    saved = round(sum(float(so.promo_discount) + float(so.member_savings or 0) for so in kept_store_orders), 2)
    return spent, saved


def get_dashboard_summary(
    db: Session, customer_id: str, range_key: str | None = None, period: str | None = None, start: date | None = None
) -> dict:
    # A checkout nobody paid for isn't an order: not while it waits to be paid,
    # and not once it's removed (2026-11-14).
    orders = db.query(Order).filter(Order.customer_id == customer_id, Order.abandoned_at.is_(None)).all()
    unfinished = _unfinished_order_ids(db, orders)
    orders = [o for o in orders if o.id not in unfinished]

    calendar = period in _CALENDAR_PERIODS
    if calendar:
        previous_first, period_first, period_next = _period_bounds(period, start)
    period_fields = {
        "period": period if calendar else ("all" if period == "all" else None),
        "period_start": period_first.isoformat() if calendar else None,
        "period_end": period_next.isoformat() if calendar else None,
        "previous": None,
        "first_order_on": min(to_local(_as_utc(o.placed_at)).date() for o in orders).isoformat() if orders else None,
    }

    empty = {
        **period_fields,
        "orders_total": 0,
        "orders_active": 0,
        "orders_completed": 0,
        "orders_cancelled": 0,
        "spending_all_time": 0.0,
        "savings_all_time": 0.0,
        "average_order_value": 0.0,
        "activity_last_7_days": _empty_activity_buckets(),
        "favorite_farm": None,
        "most_ordered_product": None,
        "spending_by_category": [],
    }
    if not orders:
        return empty

    # A card order's money is kept from 'paid' on; a cash order's only once
    # it's actually collected at pickup ('completed') — a cash order that's
    # merely ready_for_pickup hasn't been paid yet.
    all_kept_store_orders = (
        db.query(StoreOrder)
        .join(Payment, Payment.order_id == StoreOrder.order_id)
        .filter(
            StoreOrder.order_id.in_({o.id for o in orders}),
            StoreOrder.status.in_(_KEPT_STORE_ORDER_STATUSES),
            or_(StoreOrder.status == "completed", Payment.payment_method != "cash_on_pickup"),
        )
        .all()
    )

    # The recent-activity pulse is always the real last 7 days, independent
    # of the selected range filter below — a variable-granularity chart
    # (daily bars for a week, weekly/monthly bars for 6 months) was more
    # than this needed; a known, deliberate simplification.
    buckets = _empty_activity_buckets()
    buckets_by_date = {b["date"]: b for b in buckets}
    store_orders_by_order: dict = defaultdict(list)
    for so in all_kept_store_orders:
        store_orders_by_order[so.order_id].append(so)
    for order in orders:
        day_key = order.placed_at.date().isoformat()
        bucket = buckets_by_date.get(day_key)
        if bucket is None:
            continue  # outside the 7-day window
        bucket["order_count"] += 1
        bucket["amount"] = round(bucket["amount"] + sum(float(so.total) for so in store_orders_by_order.get(order.id, [])), 2)

    # Everything below IS scoped to the chosen period: a calendar month or
    # year (`period`), else range_key's rolling window, else all time. The
    # Dashboard's date control drives the whole view (stat tiles + insights),
    # not just a headline number.
    window_start = window_end = None
    if calendar:
        window_start, window_end = _local_midnight(period_first), _local_midnight(period_next)
    elif range_key in _RANGE_WINDOWS:
        window_start = datetime.now(timezone.utc) - _RANGE_WINDOWS[range_key]

    def placed_in(order, lo, hi) -> bool:
        placed = _as_utc(order.placed_at)
        return (lo is None or placed >= lo) and (hi is None or placed < hi)

    orders_in_range = [o for o in orders if placed_in(o, window_start, window_end)]
    order_ids_in_range = {o.id for o in orders_in_range}
    kept_store_orders = [so for so in all_kept_store_orders if so.order_id in order_ids_in_range]

    spending_total, savings_total = _money(kept_store_orders)

    # The period before, for "+2 vs October" on the tiles.
    if calendar:
        before = [o for o in orders if placed_in(o, _local_midnight(previous_first), window_start)]
        before_ids = {o.id for o in before}
        before_spent, before_saved = _money([so for so in all_kept_store_orders if so.order_id in before_ids])
        period_fields["previous"] = {
            "start": previous_first.isoformat(),
            "orders_total": len(before),
            "spending": before_spent,
            "savings": before_saved,
        }

    orders_with_spend = {so.order_id for so in kept_store_orders}
    average_order_value = round(spending_total / len(orders_with_spend), 2) if orders_with_spend else 0.0

    favorite_farm = None
    farm_stats: dict = defaultdict(lambda: {"farm_name": "", "count": 0, "spend": 0.0})
    for so in kept_store_orders:
        entry = farm_stats[so.farmer_id]
        entry["farm_name"] = so.farm_name
        entry["count"] += 1
        entry["spend"] += float(so.total)
    if farm_stats:
        top_farmer_id, top = max(farm_stats.items(), key=lambda kv: (kv[1]["count"], kv[1]["spend"]))
        favorite_farm = {"farmer_id": str(top_farmer_id), "farm_name": top["farm_name"], "order_count": top["count"]}

    most_ordered_product = None
    kept_store_order_ids = [so.id for so in kept_store_orders]
    if kept_store_order_ids:
        product_qty: dict = defaultdict(int)
        items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id.in_(kept_store_order_ids)).all()
        for item in items:
            product_qty[item.product_name] += item.quantity
        if product_qty:
            top_name, top_qty = max(product_qty.items(), key=lambda kv: kv[1])
            most_ordered_product = {"product_name": top_name, "quantity": top_qty}

    return {
        **period_fields,
        "orders_total": len(orders_in_range),
        "orders_active": sum(1 for o in orders_in_range if o.status == "active"),
        "orders_completed": sum(1 for o in orders_in_range if o.status == "completed"),
        "orders_cancelled": sum(1 for o in orders_in_range if o.status == "cancelled"),
        "spending_all_time": spending_total,
        "savings_all_time": savings_total,
        "average_order_value": average_order_value,
        "activity_last_7_days": buckets,
        "favorite_farm": favorite_farm,
        "most_ordered_product": most_ordered_product,
        "spending_by_category": _spending_by_category(db, kept_store_orders, all_kept_store_orders),
    }


# The dashboard donut ("What you buy") gives fixed colors to the customer's
# top categories and groups the rest as "Other" — this many slots, matching
# the chart palette in the app (constants/theme.ts chartColors).
_CATEGORY_COLOR_SLOTS = 3


def _category_item_totals(db: Session, store_order_ids) -> dict:
    """slug -> (name, item total) over those store orders' lines. Item value
    only (fees/tax excluded). A line whose product was since deleted has no
    category any more and counts as 'other'."""
    if not store_order_ids:
        return {}
    rows = (
        db.query(Category.slug, Category.name, func.sum(StoreOrderItem.line_total))
        .select_from(StoreOrderItem)
        .outerjoin(Product, Product.id == StoreOrderItem.product_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .filter(StoreOrderItem.store_order_id.in_(list(store_order_ids)))
        .group_by(Category.slug, Category.name)
        .all()
    )
    totals: dict = {}
    for slug, name, amount in rows:
        key = slug or "other"
        prev_name, prev_amount = totals.get(key, (name or "Other", 0.0))
        totals[key] = (prev_name, prev_amount + float(amount or 0))
    return totals


def _spending_by_category(db: Session, kept_in_range: list, kept_all_time: list) -> list[dict]:
    """In-range item totals per category, largest first. color_slot pins each
    of the customer's ALL-TIME top categories to a fixed chart color, so
    switching the date range never repaints a category (color follows the
    category, not its rank in the current view); null = grouped as "Other"."""
    all_time = _category_item_totals(db, [so.id for so in kept_all_time])
    top = [slug for slug, _ in sorted(all_time.items(), key=lambda kv: kv[1][1], reverse=True) if slug != "other"]
    slot_by_slug = {slug: i for i, slug in enumerate(top[:_CATEGORY_COLOR_SLOTS])}

    in_range = _category_item_totals(db, [so.id for so in kept_in_range])
    return [
        {"slug": slug, "name": name, "amount": round(amount, 2), "color_slot": slot_by_slug.get(slug)}
        for slug, (name, amount) in sorted(in_range.items(), key=lambda kv: kv[1][1], reverse=True)
        if amount > 0
    ]


def _empty_activity_buckets() -> list[dict]:
    today = datetime.utcnow().date()
    return [
        {"date": (today - timedelta(days=offset)).isoformat(), "order_count": 0, "amount": 0.0}
        for offset in range(6, -1, -1)
    ]
