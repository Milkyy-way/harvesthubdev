"""Shared shopping helpers for the end-to-end tests: the checkout rules worked
out independently of the app, and quick reads of orders, payments and stock."""
import hh
from seed import FARMS

TAX = {"DC": (0.0, 0.10), "MD": (0.0, 0.06), "VA": (0.01, 0.06)}  # (raw, prepared), app/core/tax.py
SERVICE_FEE, COMMISSION = 0.05, 0.10
state = {f["key"]: f["state"] for f in FARMS}
products = {p["name"]: p for p in hh.q(
    "select p.id::text as id, p.name, p.price::float as price, p.tax_category, p.quantity_available as stock, p.farmer_id::text as farmer_id "
    "from products p where p.name like 'ZZ %%'")}


def expected(farm_key, lines, promo_pct=0.0):
    """The checkout rules, worked out independently of the app's code."""
    subtotal = round(sum(products[n]["price"] * qty for n, qty in lines), 2)
    promo = round(subtotal * promo_pct, 2)
    tax = 0.0
    for name, qty in lines:
        line = products[name]["price"] * qty
        share = promo * line / subtotal if subtotal else 0
        raw, prepared = TAX[state[farm_key]]
        tax += (line - share) * (prepared if products[name]["tax_category"] == "prepared" else raw)
    fee = round(subtotal * SERVICE_FEE, 2)
    total = round(subtotal - promo + fee + round(tax, 2), 2)
    return {"subtotal": subtotal, "promo": promo, "fee": fee, "tax": round(tax, 2), "total": total, "goods": round(subtotal - promo, 2)}


def fill_cart(customer, lines):
    hh.q("delete from cart_items where customer_id = %(c)s", c=customer.id)
    for name, qty in lines:
        for _ in range(qty):
            customer.post(f"/cart/items/{products[name]['id']}/increment")


def stock(name):
    return hh.q1("select quantity_available as n from products where id = %(p)s", p=products[name]["id"])["n"]


def store_orders(order_id):
    return {row["farmer_id"]: row for row in hh.q(
        "select id::text, farmer_id::text, status, subtotal::float, promo_code, promo_discount::float, service_fee::float, "
        "tax::float, total::float, released_to_farmer_at from store_orders where order_id = %(o)s", o=order_id)}


def payment(order_id):
    return hh.q1("select status, amount::float, stripe_payment_intent_id from payments where order_id = %(o)s", o=order_id)


def notices(profile_id, kind, since):
    return hh.q("select kind, push_status, email_status, sms_status from notifications where profile_id = %(p)s and kind = %(k)s and created_at >= %(t)s",
                p=profile_id, k=kind, t=since)
