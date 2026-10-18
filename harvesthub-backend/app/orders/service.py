import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
import stripe

from app.orders.models import Order, StoreOrder, StoreOrderItem, OrderCancellation
from app.payments.models import Payment, Refund, PaymentCancellation
from app.payments import stripe_client
from app.products.models import Product
from app.categories.models import Category
from app.cart.models import CartItem
from app.farmers.models import FarmerProfile
from app.checkout.service import build_checkout_preview
from app.checkout.schemas import CheckoutGroupRequest
from app.orders.schemas import CreateOrderRequest
from app.payouts import service as payouts_service
from app.ratings import service as ratings_service
from app.ratings.schemas import SubmitRatingRequest
from app.cart.service import _cart_totals

# Terminal from the customer's point of view — no further payment action
# will change these without a new attempt (we don't build retries yet).
_TERMINAL_PAYMENT_STATUSES = ("succeeded", "canceled", "failed")
# Store order lifecycle (see 0025):
#   card: pending_payment -> paid -> ready_for_pickup -> completed
#   cash: pending_payment ---------> ready_for_pickup -> completed
# 'completed' is cancellable/refundable too (e.g. a quality complaint after
# pickup) — this is what makes the farmer-payout ledger's refund-before/
# after-payout branch reachable at all, since a ledger entry is only ever
# created at completion (see app/payouts/service.py). No time limit on this
# post-completion refund window yet — a known simplification.
_CANCELLABLE_STORE_ORDER_STATUSES = ("pending_payment", "paid", "ready_for_pickup", "completed")
# Statuses whose cancellation needs a refund (a no-op for cash, which never
# captured money online) + a farmer ledger adjustment, and whose stock has
# definitely been taken — as opposed to 'pending_payment'.
_REFUNDABLE_STORE_ORDER_STATUSES = ("paid", "ready_for_pickup", "completed")
# What a farmer can still cancel: anything not yet handed over.
_FARMER_CANCELLABLE_STORE_ORDER_STATUSES = ("pending_payment", "paid", "ready_for_pickup")


def get_owned_order(db: Session, customer_id: str, order_id: str) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.customer_id == customer_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


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
                "pickup_address_street": so.pickup_address_street,
                "pickup_address_city": so.pickup_address_city,
                "pickup_address_state": so.pickup_address_state,
                "pickup_address_zip": so.pickup_address_zip,
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
                "tax": float(so.tax),
                "total": float(so.total),
                "refunded_amount": float(refunded or 0),
                "status": so.status,
                "cancelled_by": cancelled_by if so.status == "cancelled" else None,
                "cancellation_reason": cancellation_reason if so.status == "cancelled" else None,
                "items": [
                    {
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
        }

    return {
        "id": str(order.id),
        "status": order.status,
        "placed_at": order.placed_at.isoformat(),
        "grand_total": round(grand_total, 2),
        "store_orders": store_order_outs,
        "payment": payment_out,
    }


def list_orders(db: Session, customer_id: str, status_filter: str | None, range_key: str | None = None) -> list[dict]:
    q = db.query(Order).filter(Order.customer_id == customer_id)
    if status_filter:
        q = q.filter(Order.status == status_filter)
    if range_key in _RANGE_WINDOWS:
        q = q.filter(Order.placed_at >= datetime.now(timezone.utc) - _RANGE_WINDOWS[range_key])
    orders = q.order_by(Order.placed_at.desc()).all()
    return [build_order_out(db, o.id) for o in orders]


def _validate_stock(db: Session, groups: list[dict]) -> None:
    for group in groups:
        for item in group["items"]:
            product = db.query(Product).filter(Product.id == item["product_id"]).first()
            if product and item["quantity"] > product.quantity_available:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Only {product.quantity_available} of {item['name']} left — please update your cart",
                )


def _commit_inventory_and_clear_cart(db: Session, customer_id: str, order_id) -> None:
    """The point of no return for one order: decrement real stock and drop
    the ordered items from the customer's active cart. Deliberately NOT
    called at order-creation time for card payments — only once payment is
    actually confirmed (see _finalize_successful_payment) — so a declined
    or abandoned payment never locks stock or empties a cart for nothing.
    cash_on_pickup has no such failure mode, so it calls this immediately
    at creation instead.

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
        items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id).all()
        for item in items:
            if item.product_id:
                product = db.query(Product).filter(Product.id == item.product_id).first()
                if product:
                    product.quantity_available = max(0, product.quantity_available - item.quantity)
                db.query(CartItem).filter(
                    CartItem.customer_id == customer_id, CartItem.product_id == item.product_id
                ).delete()


def create_order(db: Session, customer, request: CreateOrderRequest) -> tuple[dict, str | None]:
    customer_id = str(customer.id)

    preview_groups = [
        CheckoutGroupRequest(farmer_id=g.farmer_id, fulfillment_method=g.fulfillment_method, promo_code=g.promo_code)
        for g in request.groups
    ]
    preview = build_checkout_preview(db, customer_id, preview_groups)
    if not preview["groups"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing in your cart for the selected farms")

    _validate_stock(db, preview["groups"])

    delivery_by_farmer = {g.farmer_id: g.delivery_address for g in request.groups}
    for group in preview["groups"]:
        if group["fulfillment_method"] == "delivery" and not delivery_by_farmer.get(group["farmer_id"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Delivery address required for {group['farm_name']}",
            )

    order = Order(id=uuid.uuid4(), customer_id=customer.id)
    db.add(order)
    db.flush()

    # A cash order is fully placed right now (there's no online payment
    # step), so its farmers can see it — and the customer's name/phone —
    # immediately. A card order is released only once payment succeeds
    # (_finalize_successful_payment). The customer was told this at checkout.
    released_at = datetime.now(timezone.utc) if request.payment_method == "cash_on_pickup" else None

    for group in preview["groups"]:
        delivery = delivery_by_farmer.get(group["farmer_id"])
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
            delivery_address_street=delivery.street if delivery else None,
            delivery_address_city=delivery.city if delivery else None,
            delivery_address_state=delivery.state if delivery else None,
            delivery_address_zip=delivery.zip if delivery else None,
            subtotal=group["subtotal"],
            promo_code=group["promo_code"],
            promo_discount=group["promo_discount"],
            delivery_fee=group["delivery_fee"],
            service_fee=group["service_fee"],
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
                )
            )

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


def _finalize_successful_payment(db: Session, order_id) -> None:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        return
    _commit_inventory_and_clear_cart(db, str(order.customer_id), order_id)
    # Paid = fully placed: the farmer can now see the order (and the
    # customer's name/phone, as the customer was told at checkout).
    db.query(StoreOrder).filter(StoreOrder.order_id == order_id, StoreOrder.status == "pending_payment").update(
        {"status": "paid", "released_to_farmer_at": datetime.now(timezone.utc)}
    )
    db.commit()


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
    """Whether _commit_inventory_and_clear_cart already ran for this store
    order — card orders take stock once paid, cash orders the moment they're
    placed. Must be checked BEFORE the store order's status changes."""
    if store_order.status in _REFUNDABLE_STORE_ORDER_STATUSES:
        return True
    return (
        store_order.status == "pending_payment"
        and payment is not None
        and payment.payment_method == "cash_on_pickup"
    )


def _restore_inventory(db: Session, store_order: StoreOrder) -> None:
    items = db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == store_order.id).all()
    for item in items:
        if item.product_id:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if product:
                product.quantity_available += item.quantity


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


def _refund_store_order(db: Session, payment: Payment, store_order: StoreOrder, reason: str | None) -> None:
    if payment.payment_method == "cash_on_pickup":
        return  # nothing was ever electronically captured — just a status change, no refund object

    try:
        stripe_refund = stripe_client.create_refund(payment.stripe_payment_intent_id, float(store_order.total), reason=reason)
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
            amount=store_order.total,
            reason=reason,
            stripe_refund_id=stripe_refund.id,
            status="succeeded" if stripe_refund.status == "succeeded" else "pending",
        )
    )


def cancel_store_order(
    db: Session, customer_id: str, order_id: str, store_order_id: str, cancelled_by_role: str, cancelled_by, reason: str | None
) -> dict:
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")
    if store_order.status not in _CANCELLABLE_STORE_ORDER_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a store order with status '{store_order.status}'",
        )

    _cancel_one_store_order(db, order, store_order, cancelled_by, cancelled_by_role, reason)
    db.commit()
    return build_order_out(db, order.id)


def _cancel_one_store_order(
    db: Session, order: Order, store_order: StoreOrder, cancelled_by, cancelled_by_role: str, reason: str | None
) -> bool:
    """Cancels one farm's part of an order — shared by the customer's and the
    farmer's cancel actions. Refunds whatever was paid (full store order
    total), restores stock that was taken, adjusts the farmer ledger, and
    records who cancelled. Does NOT commit. Returns True if real money was
    refunded to a card (the case where a farmer cancellation costs the
    farmer the service fee)."""
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    stock_taken = _stock_was_taken(payment, store_order)
    refunded_to_card = False

    if store_order.status in _REFUNDABLE_STORE_ORDER_STATUSES:
        _refund_store_order(db, payment, store_order, reason)
        payouts_service.handle_refund_ledger_adjustment(db, store_order)
        refunded_to_card = payment is not None and payment.payment_method == "card"
    elif payment and payment.payment_method == "card" and payment.status not in _TERMINAL_PAYMENT_STATUSES:
        sibling_count = (
            db.query(StoreOrder)
            .filter(StoreOrder.order_id == order.id, StoreOrder.status.in_(_CANCELLABLE_STORE_ORDER_STATUSES))
            .count()
        )
        if sibling_count <= 1:
            # Only store order left on this PaymentIntent — cancel it outright.
            try:
                stripe_client.cancel_payment_intent(payment.stripe_payment_intent_id)
            except stripe.error.StripeError:
                pass  # already terminal on Stripe's side — proceed with local cancellation regardless
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
        _restore_inventory(db, store_order)
    store_order.status = "cancelled"
    db.add(_record_cancellation(order.id, store_order.id, cancelled_by, cancelled_by_role, reason))
    _sync_cash_payment_status(db, order.id, payment)
    return refunded_to_card


def cancel_whole_order(db: Session, customer_id: str, order_id: str, cancelled_by_role: str, cancelled_by, reason: str | None) -> dict:
    order = get_owned_order(db, customer_id, order_id)
    store_orders = (
        db.query(StoreOrder)
        .filter(StoreOrder.order_id == order.id, StoreOrder.status.in_(_CANCELLABLE_STORE_ORDER_STATUSES))
        .all()
    )
    if not store_orders:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nothing left to cancel on this order")

    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    refundable = [so for so in store_orders if so.status in _REFUNDABLE_STORE_ORDER_STATUSES]
    pending = [so for so in store_orders if so.status == "pending_payment"]

    for so in refundable:
        _refund_store_order(db, payment, so, reason)
        payouts_service.handle_refund_ledger_adjustment(db, so)
        _restore_inventory(db, so)  # paid/completed always had its stock taken
        so.status = "cancelled"
        db.add(_record_cancellation(order.id, so.id, cancelled_by, cancelled_by_role, reason))

    if pending:
        if payment and payment.payment_method == "card" and payment.status not in _TERMINAL_PAYMENT_STATUSES:
            try:
                stripe_client.cancel_payment_intent(payment.stripe_payment_intent_id)
            except stripe.error.StripeError:
                pass  # already terminal on Stripe's side — proceed with local cancellation regardless
            payment.status = "canceled"
            db.add(PaymentCancellation(id=uuid.uuid4(), payment_id=payment.id, reason=reason))
        for so in pending:
            if _stock_was_taken(payment, so):  # cash orders take stock at placement
                _restore_inventory(db, so)
            so.status = "cancelled"
            db.add(_record_cancellation(order.id, so.id, cancelled_by, cancelled_by_role, reason))

    _sync_cash_payment_status(db, order.id, payment)
    db.commit()
    return build_order_out(db, order.id)


def mark_store_order_completed(db: Session, customer_id: str, order_id: str, store_order_id: str) -> dict:
    """Customer-initiated 'I picked this up' confirmation — only once the
    farm has marked it ready_for_pickup. For a cash order this is also the
    moment the cash changes hands, so its ledger entry records the cash the
    farmer collected (see app/payouts/service.py)."""
    order = get_owned_order(db, customer_id, order_id)
    store_order = db.query(StoreOrder).filter(StoreOrder.id == store_order_id, StoreOrder.order_id == order.id).first()
    if not store_order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store order not found")

    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    is_cash = payment is not None and payment.payment_method == "cash_on_pickup"
    if store_order.status != "ready_for_pickup":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The farm hasn't marked this order ready for pickup yet",
        )
    store_order.status = "completed"
    payouts_service.create_ledger_entry_for_completion(
        db, store_order, cash_collected=float(store_order.total) if is_cash else 0.0
    )
    _sync_cash_payment_status(db, order.id, payment)
    db.commit()
    return build_order_out(db, order.id)


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


def mark_store_order_ready_for_pickup(db: Session, farmer_id, store_order_id: str) -> StoreOrder:
    """The farm has the order packed: card orders go paid -> ready_for_pickup,
    cash orders pending_payment -> ready_for_pickup (they're paid at pickup).
    The customer's "Mark as Received" unlocks from here."""
    store_order = get_farmer_store_order(db, farmer_id, store_order_id)
    payment = db.query(Payment).filter(Payment.order_id == store_order.order_id).first()
    is_cash = payment is not None and payment.payment_method == "cash_on_pickup"
    preparable_status = "pending_payment" if is_cash else "paid"
    if store_order.status != preparable_status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This order can't be marked ready (current status: '{store_order.status}')",
        )
    store_order.status = "ready_for_pickup"
    _sync_cash_payment_status(db, store_order.order_id, payment)
    db.commit()
    return store_order


def farmer_cancel_store_order(db: Session, farmer_id, store_order_id: str, reason: str) -> StoreOrder:
    """The farm can't fill the order (out of stock, ...). The customer gets a
    full refund to their card; the farmer bears the service fee, deducted
    from their next payout (decided with the user). Cancelling a cash order
    costs the farmer nothing — no money was collected."""
    store_order = get_farmer_store_order(db, farmer_id, store_order_id)
    if store_order.status not in _FARMER_CANCELLABLE_STORE_ORDER_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This order can't be cancelled (current status: '{store_order.status}')",
        )
    order = db.query(Order).filter(Order.id == store_order.order_id).one()
    refunded_to_card = _cancel_one_store_order(db, order, store_order, farmer_id, "farmer", reason)
    if refunded_to_card:
        payouts_service.create_cancellation_fee_entry(db, store_order)
    db.commit()
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
_KEPT_STORE_ORDER_STATUSES = ("paid", "ready_for_pickup", "completed")


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


def get_dashboard_summary(db: Session, customer_id: str, range_key: str | None = None) -> dict:
    orders = db.query(Order).filter(Order.customer_id == customer_id).all()

    empty = {
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

    # Everything below IS scoped to range_key (all-time when absent/'all'/
    # unrecognized) — the Dashboard tab's date filter controls the whole
    # view (stat tiles + insights), not just a headline number.
    window_start = None
    if range_key in _RANGE_WINDOWS:
        window_start = datetime.now(timezone.utc) - _RANGE_WINDOWS[range_key]

    orders_in_range = [o for o in orders if window_start is None or o.placed_at >= window_start]
    order_ids_in_range = {o.id for o in orders_in_range}
    kept_store_orders = [so for so in all_kept_store_orders if so.order_id in order_ids_in_range]

    spending_total = round(sum(float(so.total) for so in kept_store_orders), 2)
    # Promo codes plus what Harvest Pass took off (the waived service fee).
    savings_total = round(sum(float(so.promo_discount) + float(so.member_savings or 0) for so in kept_store_orders), 2)

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
