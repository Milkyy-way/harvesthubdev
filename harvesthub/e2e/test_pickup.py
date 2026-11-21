"""Pickup with a code, missed pickups, the extra hour and "Report a problem"
(the 2026-11-20 rules), end to end on the live preview setup. Run seed.py first.

1. A card pickup: Ready gives the customer a code. With the window moved on
   (test rows only) the job sends the 15-minute reminder; the customer adds the
   extra hour, once. When the window ends the job marks it "not picked": the
   stock goes back, the farm is still paid (ledger entry), nothing is refunded,
   and both sides are told. The customer turns up late: the farm enters the
   code, the stock is taken again.
2. Report a problem on that order: it's recorded and HarvestHub is alerted.
   HarvestHub refunds one item with the refund tool's code: Stripe refunds that
   item, and the farm's share comes off its payout.
3. Cash pickups missed twice: no ledger entries, the customer is asked "did you
   collect it?", and the third cash checkout is refused (card still works).
4. Ready from a later time: the window starts then.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import stripe

import hh
from seed import FARMS, customer_email
from shop import COMMISSION, fill_cart, notices, payment, pickup_code, products, stock, store_orders

r = hh.Report("pickup")
farm = {f["key"]: hh.User(f["email"]) for f in FARMS}
started = hh.q1("select now() as t")["t"]


def place_and_pay(customer, farm_key, lines, method="card"):
    fill_cart(customer, lines)
    o = customer.post("/orders", {"groups": [{"farmer_id": farm[farm_key].id, "fulfillment_method": "pickup"}], "payment_method": method})
    if method == "card":
        hh.pay(o["client_secret"])
        hh.wait_for(lambda: (payment(o["order"]["id"]) or {}).get("status") == "succeeded", timeout=45) or customer.post(
            f"/orders/{o['order']['id']}/sync-payment-status"
        )
    return o["order"]["id"], store_orders(o["order"]["id"])[farm[farm_key].id]


def move_window(store_order_id, ends_in: str, starts_ago: str = "2 hours 50 minutes"):
    """Test rows only: move a pickup window so the job acts on it now."""
    hh.q(
        f"update store_orders set pickup_starts_at = now() - interval '{starts_ago}', pickup_ends_at = now() + interval '{ends_in}' "
        "where id = %(s)s and farm_name like 'ZZ Autotest%%'",
        s=store_order_id,
    )


# --- 1. Card pickup: reminder, extra hour, not picked, late handover -------------------------------
print("\n== 1. A card pickup nobody collects in time")
cust = hh.User(customer_email(6))
lines = [("ZZ Kale", 1)]
before = stock("ZZ Kale")
order_id, so = place_and_pay(cust, "A", lines)
farm["A"].post(f"/farmers/me/orders/{so['id']}/ready")
code = pickup_code(cust, order_id, so["id"])
r.check("Ready: the customer has a code", bool(code) and len(code) == 4, code)
r.check("the customer was told, with the code", hh.wait_for(lambda: notices(cust.id, "order_ready", started), timeout=20))

move_window(so["id"], "10 minutes")
hh.run_jobs()
r.check("15 minutes left: the job offered the extra hour", hh.wait_for(lambda: notices(cust.id, "pickup_last_call", started), timeout=20))
cust.post(f"/orders/{order_id}/store/{so['id']}/extend-pickup")
ends = hh.q1("select pickup_ends_at, pickup_extended_at from store_orders where id = %(s)s", s=so["id"])
r.check("the extra hour was added", ends["pickup_extended_at"] is not None and ends["pickup_ends_at"] > datetime.now(timezone.utc) + timedelta(minutes=65), ends)
try:
    cust.post(f"/orders/{order_id}/store/{so['id']}/extend-pickup")
    r.check("only once", False, "a second hour was allowed")
except hh.ApiError as e:
    r.check("only once", e.status == 409, e)
r.check("the farm was told", hh.wait_for(lambda: notices(farm["A"].id, "pickup_extended", started), timeout=20))

move_window(so["id"], "-1 minute")
hh.run_jobs()
now_so = store_orders(order_id)[farm["A"].id]
r.check("the window ended: not picked up", now_so["status"] == "not_picked", now_so["status"])
r.check("its stock went back on sale", stock("ZZ Kale") == before, (before, stock("ZZ Kale")))
entry = hh.q1("select net_amount::float as net from farmer_ledger_entries where store_order_id = %(s)s and entry_type = 'order'", s=so["id"])
goods = so["subtotal"]
r.check("the farm is still paid for it", entry and entry["net"] == round(goods - round(goods * COMMISSION, 2), 2), entry)
r.check("nothing was refunded", hh.q1("select count(*) as n from refunds where store_order_id = %(s)s", s=so["id"])["n"] == 0)
r.check("both sides were told", hh.wait_for(
    lambda: notices(cust.id, "pickup_missed", started) and notices(farm["A"].id, "pickup_missed_farmer", started), timeout=20))
shown = cust.get(f"/orders/{order_id}")["store_orders"][0]
r.check("the customer can't cancel it, but can report a problem", not shown["can_cancel"] and shown["can_report_problem"])

farm["A"].post(f"/farmers/me/orders/{so['id']}/handover", {"code": code})
r.check("late arrival: the farm can still hand it over with the code", store_orders(order_id)[farm["A"].id]["status"] == "completed")
r.check("and its stock is taken again", stock("ZZ Kale") == before - 1, (before, stock("ZZ Kale")))
r.check("still one ledger entry", hh.q1("select count(*) as n from farmer_ledger_entries where store_order_id = %(s)s and entry_type = 'order'", s=so["id"])["n"] == 1)

# --- 2. Report a problem, and the refund tool -----------------------------------------------------
print("\n== 2. Report a problem")
lines2 = [("ZZ Tomatoes", 2), ("ZZ Kale", 1)]
order2, so2 = place_and_pay(cust, "A", lines2)
farm["A"].post(f"/farmers/me/orders/{so2['id']}/ready")
farm["A"].post(f"/farmers/me/orders/{so2['id']}/handover", {"code": pickup_code(cust, order2, so2["id"])})
shown = cust.get(f"/orders/{order2}")["store_orders"][0]
tomatoes = next(i for i in shown["items"] if i["product_name"] == "ZZ Tomatoes")
cust.post(f"/orders/{order2}/store/{so2['id']}/problem", {"reason": "damaged", "details": "Autotest: one was squashed", "items": [{"item_id": tomatoes["id"], "quantity": 1}]})
report = hh.q1("select id::text, status from problem_reports where store_order_id = %(s)s", s=so2["id"])
r.check("the report was recorded", report and report["status"] == "open", report)
r.check("HarvestHub was alerted", hh.q1("select count(*) as n from ops_alerts where dedupe_key = %(k)s", k=f"problem:{report['id']}")["n"] == 1)
try:
    cust.post(f"/orders/{order2}/store/{so2['id']}/problem", {"reason": "quality", "items": []})
    r.check("one report per order", False, "a second was allowed")
except hh.ApiError as e:
    r.check("one report per order", e.status == 409, e)

# HarvestHub decides with scripts/problems.py: the same code, run here.
os.environ.update({k: v for k, v in hh._backend.items() if v is not None})
sys.path.insert(0, str(hh.ROOT / "harvesthub-backend"))
from app.core.database import SessionLocal  # noqa: E402
from app.problems import service as problems  # noqa: E402

db = SessionLocal()
try:
    result = problems.refund_report(db, report["id"], note="Autotest: sorry about the tomato.")
finally:
    db.close()
price = products["ZZ Tomatoes"]["price"]
refund = hh.q1("select amount::float, stripe_refund_id, source from refunds where store_order_id = %(s)s", s=so2["id"])
r.check("one tomato was refunded (MD: no tax on raw food)", refund and refund["amount"] == price and refund["source"] == "problem", refund)
if refund:
    r.check("Stripe shows the same refund", stripe.Refund.retrieve(refund["stripe_refund_id"]).amount == hh.cents(price))
adj = hh.q1("select net_amount::float as net, commission_amount::float as commission from farmer_ledger_entries "
            "where store_order_id = %(s)s and entry_type = 'refund_adjustment'", s=so2["id"])
r.check("the farm gives back its 90%, HarvestHub its 10%", adj and adj["net"] == -round(price - round(price * COMMISSION, 2), 2)
        and adj["commission"] == -round(price * COMMISSION, 2), adj)
r.check("the customer sees the refund on the order", cust.get(f"/orders/{order2}")["store_orders"][0]["problem"]["status"] == "refunded")

# --- 3. Cash pickups missed twice -------------------------------------------------------------------
print("\n== 3. Cash pickups not collected")
cust7 = hh.User(customer_email(7))
# Earlier runs' missed cash pickups don't count for this one (test rows only).
hh.q("update store_orders so set collected_answer = 'yes' from orders o where o.id = so.order_id and o.customer_id = %(c)s "
     "and so.status = 'not_picked' and so.farm_name like 'ZZ Autotest%%'", c=cust7.id)
for n in (1, 2):
    cash_id, cso = place_and_pay(cust7, "C", [("ZZ Honey", 1)], "cash_on_pickup")
    r.check(f"cash {n}: no service fee", cso["service_fee"] == 0 and cso["cash_discount"] > 0, cso)
    farm["C"].post(f"/farmers/me/orders/{cso['id']}/ready")
    move_window(cso["id"], "-1 minute")
    hh.run_jobs()
    cso = store_orders(cash_id)[farm["C"].id]
    r.check(f"cash {n}: not picked up, nothing owed", cso["status"] == "not_picked"
            and hh.q1("select count(*) as n from farmer_ledger_entries where store_order_id = %(s)s", s=cso["id"])["n"] == 0)
    asked = cust7.get(f"/orders/{cash_id}")["store_orders"][0]
    r.check(f"cash {n}: the customer is asked if they collected it", asked["ask_collected"])
    cust7.post(f"/orders/{cash_id}/store/{cso['id']}/collected", {"collected": False})
fill_cart(cust7, [("ZZ Honey", 1)])
preview = cust7.post("/checkout/preview", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}]})
r.check("after 2, checkout offers no cash", preview["cash_allowed"] is False and preview["cash_blocked_reason"], preview.get("cash_blocked_reason"))
try:
    cust7.post("/orders", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}], "payment_method": "cash_on_pickup"})
    r.check("and refuses a cash order", False, "it was placed")
except hh.ApiError as e:
    r.check("and refuses a cash order", e.status == 409, e)
card = cust7.post("/orders", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}], "payment_method": "card"})
r.check("paying in the app still works", bool(card["client_secret"]))
cust7.post(f"/orders/{card['order']['id']}/discard")

# --- 4. Ready from a later time ------------------------------------------------------------------------
print("\n== 4. Ready from a later time")
order4, so4 = place_and_pay(cust, "B", [("ZZ Eggs", 1)])
later = (datetime.now(timezone.utc) + timedelta(hours=14)).replace(microsecond=0)
farm["B"].post(f"/farmers/me/orders/{so4['id']}/ready", {"ready_from": later.isoformat()})
w = hh.q1("select pickup_starts_at, pickup_ends_at from store_orders where id = %(s)s", s=so4["id"])
r.check("the window starts then, for 3 hours", w["pickup_starts_at"] == later and w["pickup_ends_at"] == later + timedelta(hours=3), w)
farm["B"].post(f"/farmers/me/orders/{so4['id']}/handover", {"code": pickup_code(cust, order4, so4["id"])})
r.check("an early customer can still be handed it", store_orders(order4)[farm["B"].id]["status"] == "completed")

r.save()
