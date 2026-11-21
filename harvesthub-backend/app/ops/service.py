"""HarvestHub keeping an eye on its own money (decided with the user
2026-11-19/20):

  * alert() emails OPS_ALERT_EMAIL, once per event (ops_alerts.dedupe_key);
  * a dispute (a customer asked their bank for the money back) is recorded
    and emailed — who pays for one is still an open question;
  * a refund made in Stripe's Dashboard, not the app, is recorded and emailed:
    it can't be matched to a farm, so the farm's earnings aren't changed;
  * Stripe's own fee on each payment is saved (fill_stripe_fees);
  * the daily check compares Stripe with the database every morning.
"""
import html
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import stripe
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.localtime import LOCAL_TZ
from app.core.models import Profile
from app.notifications import channels
from app.ops.models import OpsAlert
from app.orders.models import Order, StoreOrder
from app.payments import stripe_client
from app.payments.models import CHARGE_FAILED, Payment, PaymentDispute, Refund
from app.payouts.models import LedgerEntry, Payout
from app.problems.models import ProblemReport

logger = logging.getLogger(__name__)

# The daily check goes out on the first scheduled run after this hour, local time.
DAILY_CHECK_HOUR = 7
# Disputes still waiting on HarvestHub, or on the bank.
_OPEN_DISPUTE_STATUSES = ("warning_needs_response", "needs_response", "warning_under_review", "under_review")


def _money(amount) -> str:
    return f"${float(amount or 0):,.2f}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def alert(db: Session, kind: str, dedupe_key: str, subject: str, lines: list[str]) -> bool:
    """Records the alert and emails it, once per dedupe_key. Never raises:
    an email that can't be sent is still in ops_alerts. Commits."""
    body = "\n".join(lines)
    try:
        alert_id = db.execute(
            pg_insert(OpsAlert)
            .values(id=uuid.uuid4(), kind=kind, dedupe_key=dedupe_key, subject=subject, body=body, created_at=_utcnow())
            .on_conflict_do_nothing(index_elements=["dedupe_key"])
            .returning(OpsAlert.id)
        ).scalar()
        db.commit()
        if alert_id is None:
            return False
        if not settings.OPS_ALERT_EMAIL:
            result = "not_configured"
        else:
            html_body = (
                '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#23291F;">'
                + "".join(f"<div>{html.escape(line) or '&nbsp;'}</div>" for line in lines)
                + "</div>"
            )
            result = channels.send_email(settings.OPS_ALERT_EMAIL, f"[HarvestHub] {subject}", html_body, body, str(alert_id))
        db.query(OpsAlert).filter(OpsAlert.id == alert_id).update({"email_status": result})
        db.commit()
        return True
    except Exception:
        logger.exception("Could not record or send the alert %s", dedupe_key)
        db.rollback()
        return False


def describe_payment(db: Session, payment: Payment | None) -> list[str]:
    """Which order and customer a payment was for, for an alert."""
    if payment is None:
        return ["We have no order for this payment."]
    order = db.get(Order, payment.order_id)
    customer = db.get(Profile, order.customer_id) if order else None
    farms = [so.farm_name for so in db.query(StoreOrder).filter(StoreOrder.order_id == payment.order_id)]
    return [
        f"Order: {payment.order_id}",
        f"Customer: {(customer.full_name if customer else None) or 'unknown'}",
        f"Farms: {', '.join(farms) or 'none'}",
        f"Paid: {_money(payment.amount)} ({payment.payment_method})",
    ]


# --- Disputes and refunds made outside the app (the Stripe webhook) ----------------------


def record_dispute(db: Session, dispute: dict) -> None:
    dispute_id = dispute["id"]
    intent_id = dispute.get("payment_intent")
    payment = db.query(Payment).filter(Payment.stripe_payment_intent_id == intent_id).first() if intent_id else None
    row = db.query(PaymentDispute).filter(PaymentDispute.stripe_dispute_id == dispute_id).first()
    if row is None:
        row = PaymentDispute(id=uuid.uuid4(), stripe_dispute_id=dispute_id)
        db.add(row)
    due = (dispute.get("evidence_details") or {}).get("due_by")
    row.stripe_charge_id = dispute.get("charge")
    row.stripe_payment_intent_id = intent_id
    row.payment_id = payment.id if payment else None
    row.amount = round((dispute.get("amount") or 0) / 100, 2)
    row.reason = dispute.get("reason")
    row.status = dispute.get("status") or "unknown"
    row.evidence_due_by = datetime.fromtimestamp(due, timezone.utc) if due else None
    db.commit()

    due_text = row.evidence_due_by.astimezone(LOCAL_TZ).strftime("%b %d, %I:%M %p") if row.evidence_due_by else "not given"
    alert(
        db,
        "dispute",
        f"dispute:{dispute_id}:{row.status}",
        f"Dispute {row.status.replace('_', ' ')}: {_money(row.amount)}",
        [
            f"A customer's bank is disputing a payment of {_money(row.amount)}.",
            f"Reason: {(row.reason or 'not given').replace('_', ' ')}",
            f"Status: {row.status.replace('_', ' ')}",
            f"Answer by: {due_text}",
            "",
            *describe_payment(db, payment),
            "",
            f"In Stripe: https://dashboard.stripe.com/disputes/{dispute_id}",
            "Stripe charges a $15 fee on each dispute. Who pays for disputes is still an open question.",
        ],
    )


_REFUND_STATUSES = {"succeeded": "succeeded", "failed": "failed", "canceled": "failed"}


def record_outside_refunds(db: Session, charge: dict) -> None:
    """charge.refunded: any refund on this charge the app didn't make (it was
    made in Stripe's Dashboard) is recorded and emailed. It isn't tied to a
    farm, so no farm's earnings change: do that by hand if it should."""
    intent_id = charge.get("payment_intent")
    payment = db.query(Payment).filter(Payment.stripe_payment_intent_id == intent_id).first() if intent_id else None
    try:
        refunds = stripe_client.refunds_of_charge(charge["id"])
    except stripe.error.StripeError as e:
        logger.warning("Could not list the refunds of %s: %s", charge.get("id"), e)
        return
    for refund in refunds:
        if (refund.get("metadata") or {}).get("source") == stripe_client.REFUND_SOURCE:
            continue
        if db.query(Refund.id).filter(Refund.stripe_refund_id == refund["id"]).first() is not None:
            continue
        amount = round((refund.get("amount") or 0) / 100, 2)
        if payment is not None:
            db.add(
                Refund(
                    id=uuid.uuid4(),
                    payment_id=payment.id,
                    store_order_id=None,
                    amount=amount,
                    reason="Made in Stripe's Dashboard",
                    stripe_refund_id=refund["id"],
                    status=_REFUND_STATUSES.get(refund.get("status"), "pending"),
                    source="outside",
                )
            )
            db.commit()
        alert(
            db,
            "outside_refund",
            f"outside_refund:{refund['id']}",
            f"A refund was made outside the app: {_money(amount)}",
            [
                f"{_money(amount)} was refunded in Stripe's Dashboard, not through the app.",
                "The app can't tell which farm it was for, so no farm's earnings changed. "
                "If a farm should pay for it, adjust its payout by hand.",
                "",
                *describe_payment(db, payment),
                "",
                f"In Stripe: https://dashboard.stripe.com/payments/{intent_id}" if intent_id else "",
            ],
        )


# --- Stripe's fee on each payment -----------------------------------------------------------


def fill_stripe_fees(db: Session, limit: int = 20) -> int:
    """Saves what Stripe kept on recent card payments (it's known shortly after
    the payment). Returns how many were filled in."""
    rows = (
        db.query(Payment)
        .filter(
            Payment.status == "succeeded",
            Payment.stripe_payment_intent_id.isnot(None),
            Payment.stripe_fee.is_(None),
            Payment.created_at >= datetime.utcnow() - timedelta(days=14),
        )
        .order_by(Payment.created_at.desc())
        .limit(limit)
        .all()
    )
    filled = 0
    for payment in rows:
        try:
            fee = stripe_client.payment_fee(payment.stripe_payment_intent_id)
        except stripe.error.StripeError as e:
            logger.warning("Could not read Stripe's fee for %s: %s", payment.stripe_payment_intent_id, e)
            continue
        if fee is not None:
            payment.stripe_fee = fee
            filled += 1
    db.commit()
    return filled


# --- The daily check -----------------------------------------------------------------------


def daily_check(db: Session, force: bool = False) -> bool:
    """Every morning (the first scheduled run after DAILY_CHECK_HOUR): Stripe
    compared with the database, and what needs a look. One email a day, with
    anything wrong at the top. Returns True when it went out."""
    local_now = datetime.now(LOCAL_TZ)
    if not force and local_now.hour < DAILY_CHECK_HOUR:
        return False
    key = f"daily_check:{local_now.date().isoformat()}" + (f":{local_now:%H%M%S}" if force else "")
    if db.query(OpsAlert.id).filter(OpsAlert.dedupe_key == key).first() is not None:
        return False

    issues: list[str] = []
    notes: list[str] = []
    since = _utcnow() - timedelta(days=2)
    since_naive = since.replace(tzinfo=None)
    day_ago_naive = (_utcnow() - timedelta(days=1)).replace(tzinfo=None)

    _check_payments(db, int(since.timestamp()), issues, notes)
    _check_refunds(db, int(since.timestamp()), since_naive, day_ago_naive, issues, notes)
    _check_disputes(db, issues)
    _check_pass(int((_utcnow() - timedelta(days=1)).timestamp()), issues, notes)

    failed_charges = db.query(Payment).filter(Payment.status == CHARGE_FAILED).count()
    if failed_charges:
        issues.append(f"{failed_charges} pod or group deal orders have a card that was declined at the charge (the app keeps retrying).")

    _check_payouts(db, issues, notes)

    open_reports = db.query(ProblemReport).filter(ProblemReport.status == "open").order_by(ProblemReport.created_at).all()
    if open_reports:
        issues.append(
            f"{len(open_reports)} problem reports are waiting for a decision (oldest {open_reports[0].created_at.astimezone(LOCAL_TZ):%b %d}). "
            "See them with: python scripts/problems.py list"
        )

    _check_pickups(db, issues, notes)

    fees = (
        db.query(func.coalesce(func.sum(Payment.stripe_fee), 0), func.count(Payment.id))
        .filter(Payment.stripe_fee.isnot(None), Payment.created_at >= day_ago_naive)
        .one()
    )
    notes.append(f"Stripe's fees on yesterday's payments: {_money(fees[0])} on {fees[1]} payments.")

    subject = "Daily check: all good" if not issues else f"Daily check: {len(issues)} to look at"
    lines = ["Things to look at:" if issues else "Nothing needs a look today."]
    lines += [f"• {i}" for i in issues]
    lines += ["", "The numbers:"] + [f"• {n}" for n in notes]
    return alert(db, "daily_check", key, subject, lines)


def _check_payments(db: Session, since_ts: int, issues: list, notes: list) -> None:
    try:
        intents = stripe_client.payment_intents_since(since_ts)
    except stripe.error.StripeError as e:
        issues.append(f"Couldn't reach Stripe to compare payments: {e}")
        return
    for_orders = [i for i in intents if (i.get("metadata") or {}).get("order_id")]
    ours = (
        {p.stripe_payment_intent_id: p for p in db.query(Payment).filter(Payment.stripe_payment_intent_id.in_([i["id"] for i in for_orders]))}
        if for_orders
        else {}
    )
    paid, paid_total = 0, 0.0
    for intent in for_orders:
        payment = ours.get(intent["id"])
        stripe_paid = intent["status"] == "succeeded"
        received = round((intent.get("amount_received") or 0) / 100, 2)
        if stripe_paid:
            paid += 1
            paid_total += received
        if payment is None:
            if stripe_paid:
                issues.append(f"Stripe took {_money(received)} ({intent['id']}) for order {intent['metadata']['order_id']}, but we have no such payment.")
            continue
        if stripe_paid and payment.status != "succeeded":
            issues.append(f"Stripe says {intent['id']} was paid ({_money(received)}), but our payment says '{payment.status}' (order {payment.order_id}).")
        elif not stripe_paid and payment.status == "succeeded":
            issues.append(f"Our payment for order {payment.order_id} says paid, but Stripe says '{intent['status']}' ({intent['id']}).")
        elif stripe_paid and abs(received - float(payment.amount)) > 0.009:
            issues.append(f"Order {payment.order_id}: Stripe took {_money(received)}, our payment says {_money(payment.amount)}.")
    notes.append(f"Card payments in the last 2 days: {paid}, {_money(paid_total)}.")


def _check_refunds(db: Session, since_ts: int, since_naive, day_ago_naive, issues: list, notes: list) -> None:
    stuck = db.query(Refund).filter(Refund.status == "pending", Refund.created_at < day_ago_naive).count()
    if stuck:
        issues.append(f"{stuck} refunds have been pending for more than a day.")
    failed = db.query(Refund).filter(Refund.status == "failed", Refund.updated_at >= since_naive).all()
    for refund in failed:
        issues.append(f"A refund of {_money(refund.amount)} failed (store order {refund.store_order_id}): refund it by hand.")
    try:
        stripe_refunds = stripe_client.refunds_since(since_ts)
    except stripe.error.StripeError as e:
        issues.append(f"Couldn't reach Stripe to compare refunds: {e}")
        return
    known = {r for (r,) in db.query(Refund.stripe_refund_id).filter(Refund.stripe_refund_id.in_([r["id"] for r in stripe_refunds]))} if stripe_refunds else set()
    total = sum((r.get("amount") or 0) for r in stripe_refunds if r.get("status") == "succeeded") / 100
    notes.append(f"Refunds in the last 2 days: {len(stripe_refunds)}, {_money(total)}.")
    for r in stripe_refunds:
        if r["id"] not in known and (r.get("metadata") or {}).get("source") != stripe_client.REFUND_SOURCE:
            issues.append(f"A refund of {_money((r.get('amount') or 0) / 100)} ({r['id']}) was made outside the app and isn't recorded.")
    outside = db.query(Refund).filter(Refund.source == "outside", Refund.created_at >= since_naive).count()
    if outside:
        notes.append(f"Refunds made in Stripe's Dashboard in the last 2 days: {outside} (each was emailed).")


def _check_disputes(db: Session, issues: list) -> None:
    for d in db.query(PaymentDispute).filter(PaymentDispute.status.in_(_OPEN_DISPUTE_STATUSES)).order_by(PaymentDispute.evidence_due_by):
        due = f", answer by {d.evidence_due_by.astimezone(LOCAL_TZ):%b %d}" if d.evidence_due_by else ""
        issues.append(f"Open dispute of {_money(d.amount)} ({d.status.replace('_', ' ')}{due}): https://dashboard.stripe.com/disputes/{d.stripe_dispute_id}")


def _check_pass(since_ts: int, issues: list, notes: list) -> None:
    try:
        invoices = stripe_client.invoices_since(since_ts)
    except stripe.error.StripeError as e:
        issues.append(f"Couldn't reach Stripe to check Harvest Pass charges: {e}")
        return
    paid = [i for i in invoices if i.get("status") == "paid" and (i.get("amount_paid") or 0) > 0]
    failed = [i for i in invoices if i.get("status") == "open" and (i.get("attempt_count") or 0) > 0]
    notes.append(
        f"Harvest Pass charges yesterday: {len(paid)} paid ({_money(sum(i['amount_paid'] for i in paid) / 100)}), {len(failed)} declined."
    )


def _check_payouts(db: Session, issues: list, notes: list) -> None:
    waiting = db.query(Payout).filter(Payout.status == "pending_disbursement").all()
    if not waiting:
        notes.append("No farmer payouts waiting to be sent.")
        return
    sums = dict(
        db.query(LedgerEntry.payout_id, func.sum(LedgerEntry.net_amount))
        .filter(LedgerEntry.payout_id.in_([p.id for p in waiting]))
        .group_by(LedgerEntry.payout_id)
        .all()
    )
    for payout in waiting:
        expected = round(float(sums.get(payout.id) or 0) + float(payout.carried_in_total or 0), 2)
        if abs(expected - float(payout.net_total)) > 0.009:
            issues.append(f"Payout {payout.id} says {_money(payout.net_total)}, but its entries add up to {_money(expected)}.")
    to_send = [p for p in waiting if float(p.net_total) > 0]
    notes.append(f"Farmer payouts waiting to be sent: {len(to_send)}, {_money(sum(float(p.net_total) for p in to_send))}.")


def _check_pickups(db: Session, issues: list, notes: list) -> None:
    month_ago = _utcnow() - timedelta(days=30)
    day_ago = _utcnow() - timedelta(days=1)
    cash_missed = (
        db.query(StoreOrder.farm_name, StoreOrder.collected_answer, StoreOrder.collected_answered_at)
        .join(Payment, Payment.order_id == StoreOrder.order_id)
        .filter(StoreOrder.status == "not_picked", Payment.payment_method == "cash_on_pickup", StoreOrder.not_picked_at >= month_ago)
        .all()
    )
    by_farm: dict = defaultdict(int)
    for farm_name, answer, answered_at in cash_missed:
        by_farm[farm_name] += 1
        if answer == "yes" and answered_at and answered_at >= _utcnow() - timedelta(days=2):
            issues.append(f"A customer says they did collect a cash order from {farm_name} that the farm never confirmed. Check with the farm.")
    for farm_name, count in by_farm.items():
        if count >= 3:
            issues.append(f"{farm_name} has {count} cash orders not picked up in 30 days. Worth a look: is the farm skipping the code?")
    backups = (
        db.query(StoreOrder.farm_name, StoreOrder.pickup_backup_reason)
        .filter(StoreOrder.pickup_confirmed_by == "backup", StoreOrder.completed_at >= day_ago)
        .all()
    )
    for farm_name, reason in backups:
        notes.append(f"{farm_name} handed an order over without the code: “{reason}”.")
    not_picked = db.query(StoreOrder.id).filter(StoreOrder.status == "not_picked", StoreOrder.not_picked_at >= day_ago).count()
    picked = db.query(StoreOrder.id).filter(StoreOrder.status == "completed", StoreOrder.completed_at >= day_ago).count()
    notes.append(f"Yesterday: {picked} orders handed over, {not_picked} not picked up.")
