# HarvestHub — checkout fee policy.
#
# These are PLACEHOLDER values, not researched or legally reviewed figures,
# except for tax (see app/core/tax.py — real jurisdiction/category rates
# now apply, DC/MD/VA only, farm-jurisdiction-based for the pickup-only
# phase). Real delivery pricing likely needs a mileage tier once
# farm-to-customer distance is factored in (farmer_profiles/
# customer_profiles already have the coordinates for that — see
# app/core/geo.py's haversine_km — this just isn't wired up yet). An open
# business decision, not something to guess into "done."
#
# Centralized here so replacing any of these later is a one-file change,
# not a hunt through every place that touches money.

SERVICE_FEE_RATE = 0.05  # 5% of subtotal — placeholder platform fee
DELIVERY_FEE_FLAT = 4.99  # flat fee for delivery orders — not mileage-based yet

# Harvest Pass (customer membership — see app/membership/). Only the base
# monthly price needs changing to reprice everything: each plan's price is
# derived from it, and a matching Stripe Price is found or created on demand
# (lookup key includes the amount). A price change applies to NEW members
# only; existing subscriptions keep the price they signed up at.
HARVEST_PASS_MONTHLY_PRICE = 20.00
# plan -> (billing interval in months, discount off the monthly price)
#   monthly   $20.00/month
#   3_months  $18.00/month, billed $54.00 every 3 months
#   6_months  $17.00/month, billed $102.00 every 6 months
HARVEST_PASS_PLANS = {
    "monthly": (1, 0.0),
    "3_months": (3, 0.10),
    "6_months": (6, 0.15),
}
HARVEST_PASS_TRIAL_DAYS = 7
HARVEST_PASS_REFERRAL_TRIAL_DAYS = 30  # joining with a friend's referral code
# Member benefit: no service fee when the checkout's items subtotal (all
# farms in one Place Order, before promo codes) is at least this much.
MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL = 25.00
# What the referrer earns once their friend's first paid invoice goes
# through: one month at the base price, as a credit on their next bill.
HARVEST_PASS_REFERRAL_REWARD = HARVEST_PASS_MONTHLY_PRICE


def harvest_pass_plan_price(plan: str) -> tuple[int, float, float]:
    """(interval_months, monthly equivalent, amount billed per interval)."""
    months, discount = HARVEST_PASS_PLANS[plan]
    per_month = round(HARVEST_PASS_MONTHLY_PRICE * (1 - discount), 2)
    return months, per_month, round(per_month * months, 2)


# Farmer payout commission — flat 12% of (subtotal - promo_discount) at the
# time a store order is marked completed (see app/payouts/service.py).
# Snapshotted onto each farmer_ledger_entries row at creation time, so a
# future rate change here never retroactively alters historical entries.
FARMER_COMMISSION_RATE = 0.12
