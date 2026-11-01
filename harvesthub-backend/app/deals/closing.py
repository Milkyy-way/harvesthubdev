"""What happens at a deal's deadline: charge everyone or charge no one.

Enough households joined: the deal unlocks, and each join becomes an ordinary
order, so commission, tax, payouts and delivery runs need nothing special. Each
order then gets one charge on its saved card, through the same code as a pod
order (app/pods/charging.py): a declined card gets one retry after 2 hours, then
that household is dropped and its share goes back to stock. The deal is honored
for everyone who paid, even if that leaves it below the goal.

Not enough: nobody is charged. If the farmer offered it, members who joined get
24 hours to buy at the regular price, and the stock waits for them until then.

Run every 15 minutes by the scheduled job. Safe to repeat: a deal closes once,
under its row lock, and creating its orders is one transaction.
"""
import logging
import math
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.customers.models import CustomerProfile
from app.deals import customer as customer_side
from app.deals import service
from app.deals.models import ACTIVE, NOT_CHARGED, OPEN_STATUSES, ORDERED, GroupCommit, GroupDeal
from app.delivery import service as delivery_service
from app.delivery.models import FarmDeliverySettings
from app.farmers.models import FarmerProfile
from app.membership import service as membership_service
from app.notifications.service import Notice, notify_many
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.payments.models import CHARGING, Payment
from app.pods import charging
from app.products.models import Product

logger = logging.getLogger(__name__)

FALLBACK_OFFER = timedelta(hours=24)
_LAST_DAY = timedelta(hours=24)


def create_order_for(
    db: Session,
    deal: GroupDeal,
    product: Product,
    farmer: FarmerProfile,
    commit: GroupCommit,
    customer: CustomerProfile,
    is_member: bool,
    unit_price=None,
):
    """An ordinary order for one join, ready to charge. Its stock was already set
    aside by the deal. Doesn't commit. Returns the payment's id."""
    priced = customer_side.price_order(deal, product, farmer, commit.units, float(commit.delivery_fee), is_member, unit_price)
    delivered = commit.fulfillment_method == "delivery"
    order = Order(id=uuid.uuid4(), customer_id=commit.customer_id)
    db.add(order)
    db.flush()
    store_order = StoreOrder(
        id=uuid.uuid4(),
        order_id=order.id,
        farmer_id=deal.farmer_id,
        farm_name=farmer.farm_name,
        fulfillment_method=commit.fulfillment_method,
        pickup_address_street=farmer.address_street,
        pickup_address_city=farmer.address_city,
        pickup_address_state=farmer.address_state,
        pickup_address_zip=farmer.address_zip,
        delivery_address_street=customer.street_line if delivered else None,
        delivery_address_city=customer.address_city if delivered else None,
        delivery_address_state=customer.address_state if delivered else None,
        delivery_address_zip=customer.address_zip if delivered else None,
        delivery_window_starts_at=commit.delivery_starts_at,
        delivery_window_ends_at=commit.delivery_ends_at,
        group_deal_id=deal.id,
        subtotal=priced["subtotal"],
        promo_code=None,
        promo_discount=0,
        delivery_fee=priced["delivery_fee"],
        service_fee=priced["service_fee"],
        member_savings=priced["member_savings"],
        tax=priced["tax"],
        total=priced["total"],
        status="pending_payment",
    )
    db.add(store_order)
    db.flush()
    db.add(
        StoreOrderItem(
            id=uuid.uuid4(),
            store_order_id=store_order.id,
            product_id=product.id,
            product_name=product.name,
            unit=service.share_label(deal.share_size, deal.unit),
            unit_price=priced["share_price"],
            quantity=commit.units,
            line_total=priced["subtotal"],
            keep_cold=bool(product.keep_cold),
            # Whole listing units only: rounding down means a cancelled share can
            # return a little less than it took, and never more than was there.
            stock_units=math.floor(service.dec(deal.share_size) * commit.units),
        )
    )
    payment_id = uuid.uuid4()
    db.add(
        Payment(
            id=payment_id,
            order_id=order.id,
            customer_id=commit.customer_id,
            amount=priced["total"],
            currency="usd",
            payment_method="card",
            provider="stripe",
            status=CHARGING,
            stripe_setup_intent_id=commit.stripe_setup_intent_id,
            stripe_payment_method_id=commit.stripe_payment_method_id,
        )
    )
    commit.order_id = order.id
    commit.status = ORDERED
    db.flush()
    return payment_id


def charge(db: Session, payment_id) -> None:
    """One card never stops the others. Anything left "charging" is picked up by
    charging.settle_due on the next run, with the same idempotency key."""
    try:
        charging._charge(db, payment_id)
    except Exception:
        logger.exception("Could not charge a group deal order, payment %s", payment_id)
        db.rollback()


def _close_unlocked(db: Session, deal: GroupDeal, active: list[GroupCommit], now: datetime) -> tuple[list, list]:
    product = db.query(Product).filter(Product.id == deal.product_id).with_for_update().one()
    farmer = db.get(FarmerProfile, deal.farmer_id)
    settings = db.get(FarmDeliverySettings, deal.farmer_id)
    context = customer_side.deal_context(db, deal)
    payment_ids, notices = [], []
    claimed = 0
    for commit in active:
        customer = db.get(CustomerProfile, commit.customer_id)
        reason = (
            delivery_service.unavailable_reason(farmer, settings, customer) if commit.fulfillment_method == "delivery" else None
        )
        if reason or customer is None:
            # They moved, or the farm stopped delivering. Nothing is charged.
            commit.status = NOT_CHARGED
            notices.append(Notice(commit.customer_id, "deal_undeliverable", context, f"deal_undeliverable:{deal.id}:{commit.customer_id}"))
            continue
        is_member = commit.member_at_join or membership_service.has_member_benefits(db, commit.customer_id)
        payment_ids.append(create_order_for(db, deal, product, farmer, commit, customer, is_member))
        claimed += commit.units
        notices.append(Notice(commit.customer_id, "deal_unlocked", context, f"deal_unlocked:{deal.id}:{commit.customer_id}"))

    # Shares nobody claimed go back on sale.
    product.quantity_available += max(0, deal.reserved_quantity - math.ceil(service.dec(deal.share_size) * claimed))
    deal.reserved_quantity = 0
    deal.status = "unlocked"
    deal.closed_at = now
    keep = 1 - service.commission_rate()
    share_price = service.payout_of(deal)["share_price"]
    notices.append(
        Notice(
            deal.farmer_id,
            "deal_farmer_unlocked",
            {**context, "households": len(payment_ids), "earnings": round(share_price * claimed * keep, 2)},
            f"deal_farmer_result:{deal.id}",
        )
    )
    return payment_ids, notices


def _close_expired(db: Session, deal: GroupDeal, active: list[GroupCommit], now: datetime) -> list:
    context = customer_side.deal_context(db, deal)
    notices = []
    offered = False
    for commit in active:
        commit.status = NOT_CHARGED
        offer = deal.subscriber_fallback and membership_service.has_member_benefits(db, commit.customer_id)
        offered = offered or offer
        notices.append(
            Notice(commit.customer_id, "deal_expired", {**context, "regular_offer": offer}, f"deal_expired:{deal.id}:{commit.customer_id}")
        )
    deal.status = "expired"
    deal.closed_at = now
    if offered:
        deal.fallback_ends_at = now + FALLBACK_OFFER
    else:
        service.give_stock_back(db, deal)
    notices.append(Notice(deal.farmer_id, "deal_farmer_expired", {**context, "households": len(active)}, f"deal_farmer_result:{deal.id}"))
    return notices


def close_one(db: Session, deal_id, now: datetime) -> bool:
    deal = db.query(GroupDeal).filter(GroupDeal.id == deal_id).with_for_update().first()
    if deal is None or deal.status not in OPEN_STATUSES or now < deal.deadline_at:
        db.commit()
        return False
    active = (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.status == ACTIVE)
        .order_by(GroupCommit.joined_at)
        .with_for_update()
        .all()
    )
    payment_ids: list = []
    if len(active) >= deal.goal:
        payment_ids, notices = _close_unlocked(db, deal, active, now)
    else:
        notices = _close_expired(db, deal, active, now)
    db.commit()
    notify_many(db, notices)
    for payment_id in payment_ids:
        charge(db, payment_id)
    return True


def buy_at_regular_price(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    """The offer after a missed deal. Their choice, on the card they saved."""
    now = service.now()
    deal = customer_side.deal_or_404(db, deal_id, lock=True)
    product = db.get(Product, deal.product_id)
    farmer = db.get(FarmerProfile, deal.farmer_id)
    commit = (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.customer_id == customer.id, GroupCommit.status == NOT_CHARGED)
        .with_for_update()
        .first()
    )
    is_member = membership_service.has_member_benefits(db, customer.id)
    if customer_side.fallback_offer(db, deal, commit, product, farmer, is_member, now) is None:
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This offer has ended.")
    if commit.fulfillment_method == "delivery":
        reason = delivery_service.unavailable_reason(farmer, db.get(FarmDeliverySettings, deal.farmer_id), customer)
        if reason:
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)
    payment_id = create_order_for(db, deal, product, farmer, commit, customer, is_member, unit_price=deal.regular_price)
    deal.reserved_quantity = max(0, deal.reserved_quantity - customer_side.stock_for(deal, commit.units))
    db.commit()
    charge(db, payment_id)
    return customer_side.get_deal(db, customer, deal_id)


def _warn_last_day(db: Session, now: datetime) -> int:
    """24 hours left and short of the goal: a nudge to invite a neighbor, and the
    farmer's chance to lower it."""
    deals = (
        db.query(GroupDeal)
        .filter(GroupDeal.status.in_(OPEN_STATUSES), GroupDeal.deadline_at > now, GroupDeal.deadline_at <= now + _LAST_DAY)
        .all()
    )
    notices = []
    for deal in deals:
        households, _ = service.counts(db, deal.id)
        if households >= deal.goal:
            continue
        context = {**customer_side.deal_context(db, deal), "households": households}
        people = db.query(GroupCommit.customer_id).filter(GroupCommit.deal_id == deal.id, GroupCommit.status == ACTIVE).all()
        for (customer_id,) in people:
            notices.append(Notice(customer_id, "deal_last_day", context, f"deal_last_day:{deal.id}:{customer_id}"))
        notices.append(Notice(deal.farmer_id, "deal_farmer_last_day", context, f"deal_farmer_last_day:{deal.id}"))
    notify_many(db, notices)
    return len(notices)


def _end_offers(db: Session, now: datetime) -> int:
    """The regular-price offer has ended: unsold stock goes back on sale."""
    ids = [
        deal_id
        for (deal_id,) in db.query(GroupDeal.id).filter(
            GroupDeal.status == "expired", GroupDeal.reserved_quantity > 0, GroupDeal.fallback_ends_at <= now
        )
    ]
    for deal_id in ids:
        deal = db.query(GroupDeal).filter(GroupDeal.id == deal_id).with_for_update().first()
        if deal is not None:
            service.give_stock_back(db, deal)
        db.commit()
    return len(ids)


def run(db: Session, now: datetime | None = None) -> dict:
    now = now or service.now()
    updated = service.run_jobs(db, now)
    adopted = customer_side.adopt_pending(db, now)
    due = [
        deal_id
        for (deal_id,) in db.query(GroupDeal.id).filter(GroupDeal.status.in_(OPEN_STATUSES), GroupDeal.deadline_at <= now)
    ]
    closed = 0
    for deal_id in due:
        try:
            closed += 1 if close_one(db, deal_id, now) else 0
        except Exception:
            logger.exception("Could not close group deal %s", deal_id)
            db.rollback()
    return {
        "deals_updated": updated,
        "deal_joins_adopted": adopted,
        "deals_closed": closed,
        "deal_warnings": _warn_last_day(db, now),
        "deal_offers_ended": _end_offers(db, now),
    }
