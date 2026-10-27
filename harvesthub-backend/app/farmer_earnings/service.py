from collections import defaultdict
from datetime import date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.core.pricing import FARMER_COMMISSION_RATE
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.payments.models import Payment
from app.payouts.models import LedgerEntry, Payout
from app.payouts.service import pay_period_for

_PAYOUT_HISTORY_LIMIT = 26  # about six months of weekly payouts
_IN_PROGRESS_STATUSES = ("pending_payment", "paid", "ready_for_pickup", "out_for_delivery")


def _money(value) -> float:
    return round(float(value or 0), 2)


def _breakdown(gross, commission, cash, fees, carried_in, net) -> dict:
    gross, commission = _money(gross), _money(commission)
    return {
        "gross": gross,
        "commission": commission,
        "earnings": round(gross - commission, 2),
        "cash_collected": _money(cash),
        "fees": _money(fees),
        "carried_in": _money(carried_in),
        "net": _money(net),
    }


def _activity(db: Session, entries: list[LedgerEntry]) -> list[dict]:
    """Ledger entries with enough order context for a farmer to recognize
    them (customer, when it was placed, how many items, card vs cash)."""
    store_order_ids = {e.store_order_id for e in entries}
    if not store_order_ids:
        return []
    order_rows = (
        db.query(StoreOrder.id, Order.placed_at, Profile.full_name, Payment.payment_method)
        .join(Order, Order.id == StoreOrder.order_id)
        .join(Profile, Profile.id == Order.customer_id)
        .outerjoin(Payment, Payment.order_id == Order.id)
        .filter(StoreOrder.id.in_(store_order_ids))
        .all()
    )
    context = {so_id: (placed_at, name, method) for so_id, placed_at, name, method in order_rows}
    item_counts = dict(
        db.query(StoreOrderItem.store_order_id, func.sum(StoreOrderItem.quantity))
        .filter(StoreOrderItem.store_order_id.in_(store_order_ids))
        .group_by(StoreOrderItem.store_order_id)
        .all()
    )

    out = []
    for e in sorted(entries, key=lambda x: x.created_at, reverse=True):
        placed_at, name, method = context.get(e.store_order_id, (None, None, None))
        out.append(
            {
                "id": str(e.id),
                "entry_type": e.entry_type,
                "created_at": e.created_at.isoformat(),
                "customer_name": name,
                "order_placed_at": placed_at.isoformat() if placed_at else None,
                "item_count": int(item_counts.get(e.store_order_id) or 0),
                "payment_method": method,
                "gross": _money(e.gross_amount),
                "commission": _money(e.commission_amount),
                "cash_collected": _money(e.cash_collected),
                "fee": _money(e.fee_amount),
                "net": _money(e.net_amount),
            }
        )
    return out


def get_farmer_earnings(db: Session, farmer_id) -> dict:
    """Everything the farmer Earnings screen shows, aggregated in one place
    (same "one endpoint, aggregate in Python" convention as the customer
    dashboard) so the money math isn't re-implemented in the app."""
    current_start, current_end = pay_period_for(date.today())

    # Open (not yet swept) entries, grouped by week. Usually two weeks: the
    # one that ended last Friday (swept this coming Friday) and this one.
    open_entries = (
        db.query(LedgerEntry)
        .filter(LedgerEntry.farmer_id == farmer_id, LedgerEntry.status == "open")
        .all()
    )
    by_period: dict = defaultdict(list)
    for e in open_entries:
        by_period[(e.pay_period_start, e.pay_period_end)].append(e)
    by_period.setdefault((current_start, current_end), [])

    open_periods = []
    for (start, end), entries in sorted(by_period.items(), key=lambda kv: kv[0][1], reverse=True):
        open_periods.append(
            {
                "period_start": start.isoformat(),
                "period_end": end.isoformat(),
                "is_current_week": start == current_start,
                "payout_prepared_on": (end + timedelta(days=7)).isoformat(),
                "breakdown": _breakdown(
                    sum(float(e.gross_amount) for e in entries),
                    sum(float(e.commission_amount) for e in entries),
                    sum(float(e.cash_collected) for e in entries),
                    sum(float(e.fee_amount) for e in entries),
                    0,
                    sum(float(e.net_amount) for e in entries),
                ),
                "entries": _activity(db, entries),
            }
        )

    # Orders released to the farmer but not picked up yet — they reach the
    # ledger only at completion, so this is an estimate.
    in_progress = (
        db.query(StoreOrder.subtotal, StoreOrder.promo_discount, StoreOrder.delivery_fee)
        .filter(
            StoreOrder.farmer_id == farmer_id,
            StoreOrder.released_to_farmer_at.isnot(None),
            StoreOrder.status.in_(_IN_PROGRESS_STATUSES),
        )
        .all()
    )
    estimated = 0.0
    for subtotal, promo, delivery_fee in in_progress:
        goods = round(float(subtotal) - float(promo), 2)
        estimated += goods - round(goods * FARMER_COMMISSION_RATE, 2) + float(delivery_fee or 0)

    payouts = (
        db.query(Payout)
        .filter(Payout.farmer_id == farmer_id)
        .order_by(Payout.pay_period_end.desc())
        .limit(_PAYOUT_HISTORY_LIMIT)
        .all()
    )
    carried_into_ids = {p.carried_into_payout_id for p in payouts if p.carried_into_payout_id}
    period_end_by_payout = (
        dict(db.query(Payout.id, Payout.pay_period_end).filter(Payout.id.in_(carried_into_ids)).all())
        if carried_into_ids
        else {}
    )

    pending = db.query(Payout.net_total).filter(Payout.farmer_id == farmer_id, Payout.status == "pending_disbursement").all()
    lifetime_earnings = (
        db.query(func.coalesce(func.sum(LedgerEntry.gross_amount - LedgerEntry.commission_amount), 0))
        .filter(LedgerEntry.farmer_id == farmer_id, LedgerEntry.entry_type.in_(("order", "refund_adjustment")))
        .scalar()
    )
    # Money actually sent to the farmer — a negative week an admin settled by
    # hand (also marked 'paid') was money the farmer paid in, not out.
    lifetime_paid_out = (
        db.query(func.coalesce(func.sum(Payout.net_total), 0))
        .filter(Payout.farmer_id == farmer_id, Payout.status == "paid", Payout.net_total > 0)
        .scalar()
    )

    return {
        "commission_rate": FARMER_COMMISSION_RATE,
        "open_periods": open_periods,
        "in_progress": {"order_count": len(in_progress), "estimated_earnings": round(estimated, 2)},
        "awaiting_payout": _money(sum(float(n) for (n,) in pending if float(n) > 0)),
        "owed_carrying": _money(sum(float(n) for (n,) in pending if float(n) < 0)),
        "lifetime_earnings": _money(lifetime_earnings),
        "lifetime_paid_out": _money(lifetime_paid_out),
        "payouts": [
            {
                "id": str(p.id),
                "period_start": p.pay_period_start.isoformat(),
                "period_end": p.pay_period_end.isoformat(),
                "breakdown": _breakdown(
                    p.gross_total, p.commission_total, p.cash_collected_total, p.fee_total, p.carried_in_total, p.net_total
                ),
                "status": p.status,
                "disbursed_at": p.disbursed_at.isoformat() if p.disbursed_at else None,
                "carried_into_period_end": (
                    period_end_by_payout[p.carried_into_payout_id].isoformat()
                    if p.carried_into_payout_id in period_end_by_payout
                    else None
                ),
            }
            for p in payouts
        ],
    }
