import stripe
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

# Test-mode friendly by construction: whatever key is in STRIPE_SECRET_KEY
# (sk_test_... during development, sk_live_... only once this is actually
# ready to take real money) is what every call below uses — there's no
# separate "dummy" code path to maintain. Stripe's own test mode (test API
# keys + test card numbers, e.g. 4242 4242 4242 4242) is what makes this
# safe to exercise end-to-end without moving real money.


def to_cents(amount: float) -> int:
    return int(round(amount * 100))


def create_payment_intent(amount: float, currency: str, order_id: str, customer_id: str) -> stripe.PaymentIntent:
    return stripe.PaymentIntent.create(
        amount=to_cents(amount),
        currency=currency,
        automatic_payment_methods={"enabled": True},
        metadata={"order_id": order_id, "customer_id": customer_id},
    )


def retrieve_payment_intent(payment_intent_id: str) -> stripe.PaymentIntent:
    return stripe.PaymentIntent.retrieve(payment_intent_id)


def cancel_payment_intent(payment_intent_id: str) -> stripe.PaymentIntent:
    intent = stripe.PaymentIntent.retrieve(payment_intent_id)
    return intent.cancel(cancellation_reason="requested_by_customer")


def create_refund(payment_intent_id: str, amount: float, reason: str | None = None) -> stripe.Refund:
    params = {"payment_intent": payment_intent_id, "amount": to_cents(amount)}
    if reason:
        params["metadata"] = {"reason": reason}
    return stripe.Refund.create(**params)


def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    return stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)


# --- Customers, saved cards and subscriptions (Harvest Pass) -----------------
#
# Stripe objects in this SDK version are not dicts (no .get()); the helpers
# below that feed app logic return .to_dict() copies so callers can use
# plain dict access.

HARVEST_PASS_PRODUCT_ID = "harvest_pass"


def create_customer(email: str | None, name: str | None, profile_id: str) -> stripe.Customer:
    return stripe.Customer.create(
        email=email,
        name=name,
        metadata={"profile_id": profile_id},
        idempotency_key=f"customer-{profile_id}",
    )


def delete_customer(customer_id: str) -> None:
    """Also cancels the customer's subscriptions immediately and removes
    their saved cards. Past charges stay in Stripe's records."""
    try:
        stripe.Customer.delete(customer_id)
    except stripe.error.InvalidRequestError as e:
        if getattr(e, "code", None) != "resource_missing":
            raise


def create_setup_intent(customer_id: str, metadata: dict) -> stripe.SetupIntent:
    """Saves a card for off-session charges (renewals) — authenticated once
    now, so later renewals usually need no customer action."""
    return stripe.SetupIntent.create(
        customer=customer_id,
        usage="off_session",
        payment_method_types=["card"],
        metadata=metadata,
    )


def retrieve_setup_intent(setup_intent_id: str) -> dict:
    """payment_method comes back expanded (card brand/last4 for display)."""
    return stripe.SetupIntent.retrieve(setup_intent_id, expand=["payment_method"]).to_dict()


def harvest_pass_price_id(plan: str, interval_months: int, amount: float) -> str:
    """The Stripe Price for this plan at this amount — found by lookup key,
    or created (with the product) the first time. The amount is part of the
    lookup key, so changing HARVEST_PASS_MONTHLY_PRICE simply starts using
    a new Price; existing subscriptions keep theirs."""
    cents = to_cents(amount)
    lookup_key = f"harvest_pass_{plan}_{cents}"
    existing = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1)
    if existing.data:
        return existing.data[0].id

    try:
        stripe.Product.retrieve(HARVEST_PASS_PRODUCT_ID)
    except stripe.error.InvalidRequestError:
        stripe.Product.create(id=HARVEST_PASS_PRODUCT_ID, name="Harvest Pass")

    price = stripe.Price.create(
        product=HARVEST_PASS_PRODUCT_ID,
        currency="usd",
        unit_amount=cents,
        recurring={"interval": "month", "interval_count": interval_months},
        lookup_key=lookup_key,
        nickname=f"Harvest Pass — {plan}",
        idempotency_key=f"price-{lookup_key}",
    )
    return price.id


def create_subscription(
    customer_id: str,
    price_id: str,
    payment_method_id: str,
    trial_days: int,
    metadata: dict,
    idempotency_key: str,
) -> dict:
    """With a trial, nothing is charged now. Without one, the first invoice
    is charged right away to the saved card; error_if_incomplete makes a
    declined card raise a CardError instead of leaving an unpaid
    subscription behind."""
    params = {
        "customer": customer_id,
        "items": [{"price": price_id}],
        "default_payment_method": payment_method_id,
        "payment_behavior": "error_if_incomplete",
        "metadata": metadata,
        "idempotency_key": idempotency_key,
    }
    if trial_days > 0:
        params["trial_period_days"] = trial_days
        params["trial_settings"] = {"end_behavior": {"missing_payment_method": "cancel"}}
    return stripe.Subscription.create(**params).to_dict()


def retrieve_subscription(subscription_id: str) -> dict:
    return stripe.Subscription.retrieve(subscription_id).to_dict()


def set_cancel_at_period_end(subscription_id: str, cancel: bool) -> dict:
    sub = stripe.Subscription.modify(subscription_id, cancel_at_period_end=cancel)
    if not cancel and sub.cancel_at:
        # Scheduled with a specific date instead (e.g. from the Dashboard).
        sub = stripe.Subscription.modify(subscription_id, cancel_at="")
    return sub.to_dict()


def cancel_subscription_now(subscription_id: str) -> dict:
    try:
        return stripe.Subscription.cancel(subscription_id).to_dict()
    except stripe.error.InvalidRequestError:
        return retrieve_subscription(subscription_id)  # already canceled


def set_subscription_payment_method(subscription_id: str, payment_method_id: str) -> dict:
    return stripe.Subscription.modify(subscription_id, default_payment_method=payment_method_id).to_dict()


def pay_invoice(invoice_id: str) -> None:
    stripe.Invoice.pay(invoice_id)


def credit_customer_balance(customer_id: str, amount: float, description: str, idempotency_key: str) -> str:
    """A negative balance transaction is a credit — Stripe applies it to the
    customer's next invoice(s) automatically. Returns its id."""
    txn = stripe.Customer.create_balance_transaction(
        customer_id,
        amount=-to_cents(amount),
        currency="usd",
        description=description,
        idempotency_key=idempotency_key,
    )
    return txn.id
