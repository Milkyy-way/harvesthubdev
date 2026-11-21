# HarvestHub — checkout fee policy.
#
# These are PLACEHOLDER values, not researched or legally reviewed figures,
# except for tax (see app/core/tax.py — real jurisdiction/category rates
# now apply, DC/MD/VA only, keyed by the farm's state; whether delivered
# orders should be taxed by the delivery address instead is a question for
# the accountant). Delivery fees aren't set here: each farm sets its own
# and keeps all of it (app/delivery/, decided with the user 2026-10-27).
#
# Centralized here so replacing any of these later is a one-file change,
# not a hunt through every place that touches money.

SERVICE_FEE_RATE = 0.05  # 5% of each farm's items, before promo codes

# The service fee (decided with the user 2026-11-20):
#   * 5% of the items, everyone;
#   * plus 30¢ once per payment when the checkout's items come to less than
#     $25 (Stripe takes a fixed 30¢ from every payment, and 5% of a small
#     order doesn't cover it). Harvest Pass members pay it too;
#   * Harvest Pass members pay no fee from $25 (MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL);
#   * paying at the farm takes the whole fee off, as a discount: no card, no
#     Stripe fee. It's shown as a discount, not as a fee only card payers
#     pay, because card networks cap fees charged for paying by card.
# It isn't refunded when the customer cancels. When a farm cancels, the
# customer gets it back and the farm is charged it (app/orders/service.py).
SMALL_ORDER_FEE = 0.30
SMALL_ORDER_FEE_BELOW = 25.00

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
# Every new customer can have Harvest Pass free for this many days, no card
# needed; after that they pay to keep it (decided with the user 2026-10-19 —
# the same for everyone, and no referral rewards). It starts when they tap
# Start free month (user, 2026-10-31).
HARVEST_PASS_FREE_DAYS = 30
# Member benefit: no service fee when the checkout's items subtotal (all
# farms in one Place Order, before promo codes) is at least this much.
MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL = 25.00


def service_fees(subtotals: list[float], is_member: bool, pay_at_farm: bool = False) -> list[dict]:
    """The service fee for each farm in one payment, in the order given.
    The 30¢ goes on the first farm's part. Each entry:
      full            5% of that farm's items
      fixed_fee       the 30¢, on one farm, when the items are under $25
      member_savings  what Harvest Pass waived (the 5%, from $25)
      cash_discount   paid at the farm: the fee it would have had, taken off
      service_fee     what's charged
      member_potential what the Pass would waive, for a non-member (the upsell)"""
    items = round(sum(subtotals), 2)
    small = 0 < items < SMALL_ORDER_FEE_BELOW
    reaches_member_min = items >= MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL
    out = []
    for i, subtotal in enumerate(subtotals):
        full = round(subtotal * SERVICE_FEE_RATE, 2)
        fixed = SMALL_ORDER_FEE if small and i == 0 else 0.0
        member_savings = full if is_member and reaches_member_min else 0.0
        fee = round(full + fixed - member_savings, 2)
        cash_discount = fee if pay_at_farm else 0.0
        out.append(
            {
                "full": full,
                "fixed_fee": 0.0 if pay_at_farm else fixed,
                "member_savings": member_savings,
                "cash_discount": cash_discount,
                "service_fee": round(fee - cash_discount, 2),
                "member_potential": full if not is_member and reaches_member_min else 0.0,
            }
        )
    return out


def harvest_pass_plan_price(plan: str) -> tuple[int, float, float]:
    """(interval_months, monthly equivalent, amount billed per interval)."""
    months, discount = HARVEST_PASS_PLANS[plan]
    per_month = round(HARVEST_PASS_MONTHLY_PRICE * (1 - discount), 2)
    return months, per_month, round(per_month * months, 2)


# Farmer payout commission — flat 10% of (subtotal - promo_discount) at the
# time a store order is marked completed (see app/payouts/service.py). Never
# on a delivery fee: the farm keeps that in full. Was 12% until 2026-11-09
# (lowered by the user).
# Snapshotted onto each farmer_ledger_entries row at creation time, so a
# future rate change here never retroactively alters historical entries.
FARMER_COMMISSION_RATE = 0.10
