"""Harvest Pass — the customer membership (see 0028_harvest_pass.sql and
0029_harvest_pass_free_period.sql).

Every new customer gets Harvest Pass free for HARVEST_PASS_FREE_DAYS, with no
card: a harvest_pass_free_periods row, created the first time their account
reaches the API. After that they pay to keep it.

Paying, card first: /prepare saves a card with a Stripe SetupIntent (the app
shows the PaymentSheet), then /subscribe starts the subscription on that
card. Joining while the free period is still running charges nothing until
it ends (a Stripe trial up to the same date); joining after it charges the
first period right away. A membership row only ever exists for a
subscription with a card behind it.

The Stripe webhook keeps every row in sync from then on (renewals, failed
payments, cancellations); /membership/sync is the app's instant-feedback
fallback. Both go through sync_subscription(), idempotently — the same
pattern as orders' reconcile_payment_intent.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.models import Profile
from app.core.pricing import (
    HARVEST_PASS_FREE_DAYS,
    HARVEST_PASS_MONTHLY_PRICE,
    HARVEST_PASS_PLANS,
    MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL,
    harvest_pass_plan_price,
)
from app.membership.models import FreePeriod, Membership, StripeCustomer
from app.notifications import service as notifications
from app.orders.models import Order, StoreOrder
from app.payments import stripe_client

logger = logging.getLogger(__name__)

# A subscription that is still running — at most one per customer (0028's
# partial unique index).
LIVE_STATUSES = ("incomplete", "trialing", "active", "past_due", "unpaid", "paused")
# Statuses that get member benefits. past_due = a renewal failed and Stripe
# is retrying it; benefits continue while it retries, and stop if Stripe
# gives up (it then moves the subscription to canceled or unpaid).
BENEFIT_STATUSES = ("trialing", "active", "past_due")

# Joining with less free time left than this charges right away instead —
# not worth a Stripe trial measured in minutes.
_MIN_TRIAL_LEFT = timedelta(hours=1)

_SETUP_PURPOSE_JOIN = "harvest_pass"
_SETUP_PURPOSE_CARD = "harvest_pass_card"


# --- Lookups -------------------------------------------------------------------


def live_membership(db: Session, customer_id) -> Membership | None:
    return (
        db.query(Membership)
        .filter(Membership.customer_id == customer_id, Membership.status.in_(LIVE_STATUSES))
        .order_by(Membership.created_at.desc())
        .first()
    )


def ensure_free_period(db: Session, customer_id) -> FreePeriod:
    """The customer's free Harvest Pass period, started now if they don't
    have one yet. Commits only when it creates the row (once per customer);
    a concurrent request creating it too is harmless (ON CONFLICT)."""
    row = db.get(FreePeriod, customer_id)
    if row:
        return row
    now = datetime.now(timezone.utc)
    db.execute(
        pg_insert(FreePeriod)
        .values(customer_id=customer_id, starts_at=now, ends_at=now + timedelta(days=HARVEST_PASS_FREE_DAYS), created_at=now)
        .on_conflict_do_nothing(index_elements=["customer_id"])
    )
    db.commit()
    return db.get(FreePeriod, customer_id)


def _free_period_active(period: FreePeriod | None) -> bool:
    return period is not None and period.ends_at > datetime.now(timezone.utc)


def has_member_benefits(db: Session, customer_id) -> bool:
    """A paid membership in good standing, or the free period still running."""
    paid = (
        db.query(Membership.id)
        .filter(Membership.customer_id == customer_id, Membership.status.in_(BENEFIT_STATUSES))
        .first()
        is not None
    )
    return paid or _free_period_active(ensure_free_period(db, customer_id))


def total_member_savings(db: Session, customer_id) -> float:
    """Every placed (released to the farmer), not-cancelled store order's
    member_savings — the savings tracker."""
    total = (
        db.query(func.coalesce(func.sum(StoreOrder.member_savings), 0))
        .join(Order, Order.id == StoreOrder.order_id)
        .filter(
            Order.customer_id == customer_id,
            StoreOrder.released_to_farmer_at.isnot(None),
            StoreOrder.status != "cancelled",
        )
        .scalar()
    )
    return round(float(total or 0), 2)


def _require_plan(plan: str) -> None:
    if plan not in HARVEST_PASS_PLANS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown Harvest Pass plan")


def plan_options() -> list[dict]:
    options = []
    for plan, (months, discount) in HARVEST_PASS_PLANS.items():
        _, per_month, billed = harvest_pass_plan_price(plan)
        options.append(
            {
                "plan": plan,
                "interval_months": months,
                "discount_percent": round(discount * 100),
                "price_per_month": per_month,
                "billed_amount": billed,
            }
        )
    return options


# --- Stripe customer -------------------------------------------------------------


def _auth_email(db: Session, profile_id) -> str | None:
    # FastAPI connects as postgres, so auth.users is readable here.
    return db.execute(text("select email from auth.users where id = :id"), {"id": str(profile_id)}).scalar()


def get_or_create_stripe_customer(db: Session, profile_id, email: str | None = None) -> str:
    row = db.query(StripeCustomer).filter(StripeCustomer.profile_id == profile_id).first()
    if row:
        return row.stripe_customer_id

    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    try:
        customer = stripe_client.create_customer(
            email or _auth_email(db, profile_id), profile.full_name if profile else None, str(profile_id)
        )
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    db.add(StripeCustomer(profile_id=profile_id, stripe_customer_id=customer.id))
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request got there first (same idempotency key, so
        # the same Stripe customer) — use the stored one.
        db.rollback()
        row = db.query(StripeCustomer).filter(StripeCustomer.profile_id == profile_id).one()
        return row.stripe_customer_id
    return customer.id


def _stored_stripe_customer(db: Session, profile_id) -> str | None:
    row = db.query(StripeCustomer).filter(StripeCustomer.profile_id == profile_id).first()
    return row.stripe_customer_id if row else None


def _stripe_unavailable(e: Exception) -> HTTPException:
    logger.error("Stripe call failed: %s", e)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="We couldn't reach our payment provider. Please try again in a moment.",
    )


# --- Syncing from Stripe -----------------------------------------------------------


def _ts(value) -> datetime | None:
    return datetime.fromtimestamp(value, tz=timezone.utc) if value else None


def _period_end(sub: dict) -> datetime | None:
    # current_period_end lives on the subscription items in this API version.
    items = (sub.get("items") or {}).get("data") or []
    ends = [i["current_period_end"] for i in items if i.get("current_period_end")]
    return _ts(max(ends)) if ends else _ts(sub.get("current_period_end"))


def _apply_subscription(membership: Membership, sub: dict) -> None:
    membership.status = sub["status"]
    membership.trial_end = _ts(sub.get("trial_end"))
    membership.current_period_end = _period_end(sub)
    membership.cancel_at_period_end = bool(sub.get("cancel_at_period_end") or sub.get("cancel_at"))
    membership.canceled_at = _ts(sub.get("canceled_at"))
    membership.ended_at = _ts(sub.get("ended_at"))


def _apply_card(membership: Membership, payment_method: dict | None) -> None:
    card = (payment_method or {}).get("card") or {}
    membership.card_brand = card.get("brand")
    membership.card_last4 = card.get("last4")


def sync_subscription(db: Session, subscription_id: str) -> None:
    """Re-reads the subscription from Stripe and mirrors it onto our row.
    Unknown subscriptions (another environment, or one whose row the
    /subscribe request hasn't committed yet — it writes the same data) are
    ignored."""
    membership = db.query(Membership).filter(Membership.stripe_subscription_id == subscription_id).first()
    if not membership:
        return
    _apply_subscription(membership, stripe_client.retrieve_subscription(subscription_id))
    db.commit()


def _invoice_subscription_id(invoice: dict) -> str | None:
    details = (invoice.get("parent") or {}).get("subscription_details") or {}
    sub = details.get("subscription") or invoice.get("subscription")
    if isinstance(sub, dict):
        return sub.get("id")
    return sub


def handle_invoice_event(db: Session, invoice: dict, paid: bool) -> None:
    """invoice.paid / invoice.payment_failed from the webhook. A failed
    renewal also tells the member to update their card — once per invoice,
    however many times Stripe retries it."""
    subscription_id = _invoice_subscription_id(invoice)
    if not subscription_id:
        return
    sync_subscription(db, subscription_id)
    if paid or (invoice.get("amount_due") or 0) <= 0:
        return
    membership = db.query(Membership).filter(Membership.stripe_subscription_id == subscription_id).first()
    if membership:
        notifications.notify(
            db,
            membership.customer_id,
            "membership_payment_failed",
            {"amount": (invoice.get("amount_due") or 0) / 100},
            dedupe_key=f"membership_payment_failed:{invoice.get('id')}",
        )


# --- Joining -------------------------------------------------------------------------


def _trial_end(db: Session, customer_id) -> datetime | None:
    """Joining during the free period: nothing is charged until it ends."""
    period = ensure_free_period(db, customer_id)
    if period and period.ends_at - datetime.now(timezone.utc) >= _MIN_TRIAL_LEFT:
        return period.ends_at
    return None


def _join_terms(plan: str, trial_end: datetime | None) -> dict:
    months, per_month, billed = harvest_pass_plan_price(plan)
    first_charge_at = trial_end or datetime.now(timezone.utc)
    return {
        "plan": plan,
        "interval_months": months,
        "price_per_month": per_month,
        "billed_amount": billed,
        "free_until": _iso(trial_end),
        "due_today": 0.0 if trial_end else billed,
        "first_charge_at": first_charge_at.isoformat(),
    }


def prepare_join(db: Session, customer_id, email: str | None, plan: str) -> dict:
    """Step 1: a SetupIntent the app confirms with the PaymentSheet."""
    _require_plan(plan)
    if live_membership(db, customer_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have Harvest Pass.")
    trial_end = _trial_end(db, customer_id)

    stripe_customer_id = get_or_create_stripe_customer(db, customer_id, email)
    try:
        intent = stripe_client.create_setup_intent(
            stripe_customer_id, {"purpose": _SETUP_PURPOSE_JOIN, "profile_id": str(customer_id), "plan": plan}
        )
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    return {"setup_intent_id": intent.id, "setup_intent_client_secret": intent.client_secret, **_join_terms(plan, trial_end)}


def _confirmed_setup_intent(db: Session, customer_id, setup_intent_id: str, purpose: str) -> dict:
    """The SetupIntent must be this customer's, for this purpose, and
    confirmed — never trust the id alone."""
    stripe_customer_id = _stored_stripe_customer(db, customer_id)
    try:
        intent = stripe_client.retrieve_setup_intent(setup_intent_id)
    except stripe.error.InvalidRequestError:
        intent = None
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    if (
        not intent
        or not stripe_customer_id
        or intent.get("customer") != stripe_customer_id
        or (intent.get("metadata") or {}).get("purpose") != purpose
        or intent.get("status") != "succeeded"
        or not intent.get("payment_method")
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your card wasn't saved. Please try again.")
    return intent


def subscribe(db: Session, customer_id, plan: str, setup_intent_id: str) -> dict:
    """Step 2: start the subscription on the card saved in step 1."""
    _require_plan(plan)
    if live_membership(db, customer_id):
        return get_overview(db, customer_id)  # a repeated tap — already done

    intent = _confirmed_setup_intent(db, customer_id, setup_intent_id, _SETUP_PURPOSE_JOIN)
    payment_method = intent["payment_method"]
    trial_end = _trial_end(db, customer_id)
    months, _, billed = harvest_pass_plan_price(plan)

    try:
        price_id = stripe_client.harvest_pass_price_id(plan, months, billed)
        sub = stripe_client.create_subscription(
            intent["customer"],
            price_id,
            payment_method["id"],
            trial_end,
            metadata={"profile_id": str(customer_id), "plan": plan},
            idempotency_key=f"harvest-pass-{setup_intent_id}",
        )
    except stripe.error.CardError as e:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=getattr(e, "user_message", None) or "Your card was declined. Please try a different card.",
        )
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)

    membership = Membership(
        id=uuid.uuid4(),
        customer_id=customer_id,
        plan=plan,
        interval_months=months,
        price_amount=billed,
        stripe_subscription_id=sub["id"],
    )
    _apply_subscription(membership, sub)
    _apply_card(membership, payment_method)
    db.add(membership)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.query(Membership.id).filter(Membership.stripe_subscription_id == sub["id"]).first():
            return get_overview(db, customer_id)  # the same request, twice
        # Two different joins raced and the other one won — don't leave a
        # second paid subscription running in Stripe.
        logger.warning("Duplicate Harvest Pass subscription %s for %s — canceling it", sub["id"], customer_id)
        stripe_client.cancel_subscription_now(sub["id"])
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have Harvest Pass.")
    return get_overview(db, customer_id)


# --- Managing ----------------------------------------------------------------------


def _require_live(db: Session, customer_id) -> Membership:
    membership = live_membership(db, customer_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You don't have Harvest Pass right now.")
    return membership


def refresh(db: Session, customer_id) -> dict:
    membership = live_membership(db, customer_id)
    if membership:
        try:
            sync_subscription(db, membership.stripe_subscription_id)
        except stripe.error.StripeError as e:
            logger.warning("Could not sync membership %s: %s", membership.id, e)
    return get_overview(db, customer_id)


def cancel(db: Session, customer_id) -> dict:
    """Cancels at the end of the current period (or trial) — benefits last
    until then, and nothing more is charged. A subscription that isn't in
    good standing has nothing left to wait for, so it ends now."""
    membership = _require_live(db, customer_id)
    try:
        if membership.status in BENEFIT_STATUSES:
            sub = stripe_client.set_cancel_at_period_end(membership.stripe_subscription_id, True)
        else:
            sub = stripe_client.cancel_subscription_now(membership.stripe_subscription_id)
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    _apply_subscription(membership, sub)
    db.commit()
    return get_overview(db, customer_id)


def resume(db: Session, customer_id) -> dict:
    membership = _require_live(db, customer_id)
    if not membership.cancel_at_period_end:
        return get_overview(db, customer_id)
    try:
        sub = stripe_client.set_cancel_at_period_end(membership.stripe_subscription_id, False)
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    _apply_subscription(membership, sub)
    db.commit()
    return get_overview(db, customer_id)


def prepare_card_update(db: Session, customer_id) -> dict:
    _require_live(db, customer_id)
    stripe_customer_id = get_or_create_stripe_customer(db, customer_id)
    try:
        intent = stripe_client.create_setup_intent(
            stripe_customer_id, {"purpose": _SETUP_PURPOSE_CARD, "profile_id": str(customer_id)}
        )
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    return {"setup_intent_id": intent.id, "setup_intent_client_secret": intent.client_secret}


def update_card(db: Session, customer_id, setup_intent_id: str) -> dict:
    """Switches renewals to the newly saved card. If a renewal had failed,
    retries it on the new card straight away."""
    membership = _require_live(db, customer_id)
    intent = _confirmed_setup_intent(db, customer_id, setup_intent_id, _SETUP_PURPOSE_CARD)
    payment_method = intent["payment_method"]
    try:
        sub = stripe_client.set_subscription_payment_method(membership.stripe_subscription_id, payment_method["id"])
        _apply_card(membership, payment_method)
        if sub["status"] in ("past_due", "unpaid") and sub.get("latest_invoice"):
            latest = sub["latest_invoice"]
            try:
                stripe_client.pay_invoice(latest["id"] if isinstance(latest, dict) else latest)
            except stripe.error.CardError as e:
                db.commit()  # keep the new card on file either way
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=getattr(e, "user_message", None) or "This card was declined too. Please try another one.",
                )
            except stripe.error.InvalidRequestError:
                pass  # already paid or voided — nothing to retry
            sub = stripe_client.retrieve_subscription(membership.stripe_subscription_id)
    except stripe.error.StripeError as e:
        raise _stripe_unavailable(e)
    _apply_subscription(membership, sub)
    db.commit()
    return get_overview(db, customer_id)


# --- Overview ------------------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _membership_out(membership: Membership) -> dict:
    price_amount = float(membership.price_amount)
    # While trialing, the "period" Stripe reports is the trial itself.
    next_date = membership.trial_end if membership.status == "trialing" else membership.current_period_end
    return {
        "plan": membership.plan,
        "status": membership.status,
        "has_benefits": membership.status in BENEFIT_STATUSES,
        "interval_months": membership.interval_months,
        "price_amount": price_amount,
        "price_per_month": round(price_amount / membership.interval_months, 2),
        "trial_end": _iso(membership.trial_end),
        "current_period_end": _iso(membership.current_period_end),
        "cancel_at_period_end": membership.cancel_at_period_end,
        # When the next charge happens — or, if canceling, when benefits end.
        "renews_at": None if membership.cancel_at_period_end else _iso(next_date),
        "ends_at": _iso(next_date) if membership.cancel_at_period_end else None,
        "card_brand": membership.card_brand,
        "card_last4": membership.card_last4,
        "started_at": _iso(membership.created_at),
    }


def get_overview(db: Session, customer_id) -> dict:
    period = ensure_free_period(db, customer_id)
    free_active = _free_period_active(period)
    membership = live_membership(db, customer_id)
    paid_benefits = membership is not None and membership.status in BENEFIT_STATUSES
    return {
        "monthly_price": HARVEST_PASS_MONTHLY_PRICE,
        "plans": plan_options(),
        "free_days": HARVEST_PASS_FREE_DAYS,
        "free_period_ends_at": _iso(period.ends_at),
        "free_period_active": free_active,
        "free_service_fee_min_subtotal": MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL,
        # Has the benefits right now — paid, or the free period.
        "is_member": paid_benefits or free_active,
        "membership": _membership_out(membership) if membership else None,
        "total_savings": total_member_savings(db, customer_id),
    }


# --- Account deletion -------------------------------------------------------------------


def release_billing_for_deletion(db: Session, profile_id) -> None:
    """Before an account is deleted: delete the Stripe Customer (cancels the
    subscription immediately — no further charges — and removes saved
    cards), then mark our rows to match. Raises StripeError on failure, so
    the deletion stops rather than leaving a subscription billing a
    deleted account."""
    row = db.query(StripeCustomer).filter(StripeCustomer.profile_id == profile_id).first()
    if not row:
        return
    stripe_client.delete_customer(row.stripe_customer_id)
    now = datetime.now(timezone.utc)
    for membership in db.query(Membership).filter(
        Membership.customer_id == profile_id, Membership.status.in_(LIVE_STATUSES)
    ):
        membership.status = "canceled"
        membership.cancel_at_period_end = False
        membership.canceled_at = membership.canceled_at or now
        membership.ended_at = now
    db.delete(row)
    db.commit()
