"""Orders and money, end to end on the live preview setup. Run seed.py first.

1. A two-farm card order with a farm's promo code: the price is worked out by
   hand from the rules and compared with the checkout, the order, Stripe's
   charge and the database. Payment is confirmed with a Stripe test card and the
   Stripe webhook is expected to mark it paid by itself.
2. The farmer marks it ready and hands it over with the customer's code (a
   wrong code is refused, and so is the old "Mark as received"): the farmer's
   ledger entry is checked at 10%.
3. The customer cancels the other farm's part: Stripe refunds that farm's
   total less its service fee, stock comes back.
4. A cash order, start to finish: no service fee (a pay-at-farm discount), and
   the farmer owes HarvestHub its commission and tax.
5. A declined card: nothing is placed; its stock is held until it's removed.
6. Once packed, the customer can't cancel. A farmer cancels a paid order: full
   refund, and the service fee comes off the farmer's payout.
(2026-11-20 rules. Not picked up, reminders and problem reports: test_pickup.py.)
"""
import time

import stripe

import hh
from seed import FARMS, customer_email
from shop import COMMISSION, SMALL_ORDER_BELOW, expected, fill_cart, items_total, notices, payment, pickup_code, products, stock, store_orders

r = hh.Report("orders")
farm = {f["key"]: hh.User(f["email"]) for f in FARMS}

started = hh.q1("select now() as t")["t"]

# --- 1. A two-farm card order with a promo code -------------------------------------------
print("\n== 1. Two farms, card, a promo code")
cust = hh.User(customer_email(2))
code = "ZZTEST10"
existing = {c["code"]: c for c in farm["A"].get("/farmers/me/promo-codes")}
if code in existing:
    farm["A"].call("DELETE", f"/farmers/me/promo-codes/{existing[code]['id']}")
farm["A"].post("/farmers/me/promo-codes", {"code": code, "discount_type": "percentage", "discount_value": 10, "show_on_farm_page": True})
r.check("Farm A made a promo code in the app's API", code in {c["code"] for c in farm["A"].get("/farmers/me/promo-codes")})
r.check("it shows on Farm A's page", code in {p["code"] for p in cust.get(f"/farmers/{farm['A'].id}")["promotions"]})

lines_a = [("ZZ Tomatoes", 3), ("ZZ Strawberry Jam", 1)]
lines_b = [("ZZ Eggs", 1), ("ZZ Apples", 5)]
exp_a, exp_b = expected("A", lines_a, 0.10, small=items_total(lines_a, lines_b) < SMALL_ORDER_BELOW), expected("B", lines_b)
fill_cart(cust, lines_a + lines_b)
before = {n: stock(n) for n, _ in lines_a + lines_b}
groups = [{"farmer_id": farm["A"].id, "fulfillment_method": "pickup", "promo_code": "zztest10"},
          {"farmer_id": farm["B"].id, "fulfillment_method": "pickup"}]
preview = cust.post("/checkout/preview", {"groups": groups})
pa = next(g for g in preview["groups"] if g["farmer_id"] == farm["A"].id)
pb = next(g for g in preview["groups"] if g["farmer_id"] == farm["B"].id)
r.check("checkout: Farm A matches the rules (promo, 5% fee, DC tax on the jam only)",
        (pa["subtotal"], pa["promo_discount"], pa["service_fee"], pa["tax"], pa["farm_total"]) ==
        (exp_a["subtotal"], exp_a["promo"], exp_a["fee"], exp_a["tax"], exp_a["total"]), (pa, exp_a))
r.check("checkout: Farm B matches the rules (MD, no tax on raw food)",
        (pb["subtotal"], pb["service_fee"], pb["tax"], pb["farm_total"]) == (exp_b["subtotal"], exp_b["fee"], exp_b["tax"], exp_b["total"]), (pb, exp_b))
grand = round(exp_a["total"] + exp_b["total"], 2)
r.check("checkout: grand total", preview["grand_total"] == grand, (preview["grand_total"], grand))

created = cust.post("/orders", {"groups": groups, "payment_method": "card"})
order_id, secret = created["order"]["id"], created["client_secret"]
pi_id = secret.split("_secret_")[0]
r.check("order placed and waiting for payment", created["order"]["payment"]["status"] == "requires_payment_method")
r.check("Stripe was asked for exactly the grand total", stripe.PaymentIntent.retrieve(pi_id).amount == hh.cents(grand))
r.check("farmers can't see it before it's paid",
        all(s["released_to_farmer_at"] is None for s in store_orders(order_id).values()) and
        order_id not in {o["order_id"] for o in farm["A"].get("/farmers/me/orders", params={"view": "to_prepare"})["items"]})
r.check("stock is held from checkout, before payment", all(stock(n) == before[n] - q for n, q in lines_a + lines_b),
        {n: (before[n], stock(n)) for n in before})

intent = hh.pay(secret, "pm_card_visa")
r.check("Stripe charged the test card", intent.status == "succeeded", intent.status)
paid = hh.wait_for(lambda: (payment(order_id) or {}).get("status") == "succeeded", timeout=45)
if not r.check("the Stripe webhook marked it paid by itself (within 45 s)", paid, payment(order_id)):
    cust.post(f"/orders/{order_id}/sync-payment-status")
    r.note("Webhook didn't arrive: check the Stripe webhook endpoint and STRIPE_WEBHOOK_SECRET on Cloud Run. Continued using the app's sync call.")
sos = store_orders(order_id)
so_a, so_b = sos[farm["A"].id], sos[farm["B"].id]
r.check("both farms' orders are paid and released to the farmers",
        all(s["status"] == "paid" and s["released_to_farmer_at"] for s in sos.values()), {k: v["status"] for k, v in sos.items()})
r.check("database totals match what Stripe charged",
        hh.cents(sum(s["total"] for s in sos.values())) == stripe.PaymentIntent.retrieve(pi_id).amount_received)
r.check("paying didn't take the stock a second time", all(stock(n) == before[n] - q for n, q in lines_a + lines_b),
        {n: (before[n], stock(n)) for n in before})
r.check("the cart was emptied", hh.q1("select count(*) as n from cart_items where customer_id = %(c)s", c=cust.id)["n"] == 0)
r.check("the promo use was counted once",
        hh.q1("select count(*) as n from promo_code_uses u join promo_codes c on c.id = u.promo_code_id where c.code = %(c)s and u.order_id = %(o)s",
              c=code, o=order_id)["n"] == 1)
# Messages go out just after the payment is recorded: give them a few seconds.
r.check("the customer was sent a receipt", hh.wait_for(lambda: notices(cust.id, "order_placed", started), timeout=20))
r.check("both farmers were told about the new order",
        hh.wait_for(lambda: all(notices(farm[k].id, "new_order", started) for k in "AB"), timeout=20))

mine = next(o for o in farm["A"].get("/farmers/me/orders", params={"view": "to_prepare"})["items"] if o["id"] == so_a["id"])
r.check("Farm A sees its earnings: goods less 10%", mine["estimated_earnings"] == round(exp_a["goods"] * (1 - COMMISSION), 2),
        (mine["estimated_earnings"], exp_a["goods"]))
r.check("Farm A sees the customer's name and phone now it's paid", bool(mine["customer_name"]) and bool(mine["customer_phone"]))

# --- 2. Ready, picked up, ledger ----------------------------------------------------------
print("\n== 2. Ready for pickup, handed over with the code, the farmer's ledger")
farm["A"].post(f"/farmers/me/orders/{so_a['id']}/ready")
r.check("farmer marked it ready", store_orders(order_id)[farm["A"].id]["status"] == "ready_for_pickup")
r.check("the customer was told it's ready", hh.wait_for(lambda: notices(cust.id, "order_ready", started), timeout=20))
code_a = pickup_code(cust, order_id, so_a["id"])
r.check("the customer sees a 4-digit code", bool(code_a) and len(code_a) == 4 and code_a.isdigit(), code_a)
mine = next(o for o in farm["A"].get("/farmers/me/orders", params={"view": "ready"})["items"] if o["id"] == so_a["id"])
r.check("the farmer sees the 3-hour window, not the code", mine.get("pickup_ends_at") and mine.get("can_hand_over") and "pickup_code" not in mine, mine.get("pickup_ends_at"))
try:
    cust.post(f"/orders/{order_id}/store/{so_a['id']}/complete")
    r.check("the old 'Mark as received' is refused", False, "it was allowed")
except hh.ApiError as e:
    r.check("the old 'Mark as received' is refused", e.status == 409, e)
try:
    farm["A"].post(f"/farmers/me/orders/{so_a['id']}/handover", {"code": "0000" if code_a != "0000" else "1111"})
    r.check("a wrong code is refused", False, "it was accepted")
except hh.ApiError as e:
    r.check("a wrong code is refused", e.status == 400, e)
farm["A"].post(f"/farmers/me/orders/{so_a['id']}/handover", {"code": code_a})
r.check("handed over with the code", store_orders(order_id)[farm["A"].id]["status"] == "completed")
r.check("the customer was asked to rate it", hh.wait_for(lambda: notices(cust.id, "picked_up", started), timeout=20))
entry = hh.q1("select gross_amount::float as gross, commission_rate::float as rate, commission_amount::float as commission, "
              "cash_collected::float as cash, net_amount::float as net, status from farmer_ledger_entries "
              "where store_order_id = %(s)s and entry_type = 'order'", s=so_a["id"])
commission = round(exp_a["goods"] * COMMISSION, 2)
r.check("ledger: sales are the goods after the promo, commission 10%",
        entry and (entry["gross"], entry["rate"], entry["commission"], entry["net"]) == (exp_a["goods"], 0.10, commission, round(exp_a["goods"] - commission, 2)), entry)
r.check("ledger: net = gross - commission - cash - fees", entry and abs(entry["gross"] - entry["commission"] - entry["cash"] - entry["net"]) < 0.005)
earn = farm["A"].get("/farmers/me/earnings")
r.check("Farm A's Earnings screen data reports the 10% rate", earn["commission_rate"] == 0.10, earn["commission_rate"])

# --- 3. The customer cancels the other farm -----------------------------------------------
print("\n== 3. The customer cancels Farm B's part")
before_b = {n: stock(n) for n, _ in lines_b}
cust.post(f"/orders/{order_id}/store/{so_b['id']}/cancel", {"reason": "Autotest: changed my mind"})
refund = hh.q1("select amount::float, status, stripe_refund_id from refunds where store_order_id = %(s)s", s=so_b["id"])
back_b = round(exp_b["total"] - exp_b["fee"], 2)
r.check("a refund of Farm B's total less its service fee was recorded", refund and refund["amount"] == back_b, (refund, back_b))
if refund:
    sr = stripe.Refund.retrieve(refund["stripe_refund_id"])
    r.check("Stripe shows the same refund", sr.amount == hh.cents(back_b) and sr.payment_intent == pi_id and sr.status in ("succeeded", "pending"), sr.status)
r.check("Farm B's stock came back", all(stock(n) == before_b[n] + q for n, q in lines_b))
r.check("Farm A's part is untouched", store_orders(order_id)[farm["A"].id]["status"] == "completed")
r.check("Farm B was told", hh.wait_for(lambda: notices(farm["B"].id, "order_cancelled_by_customer", started), timeout=20))
try:
    cust.post(f"/orders/{order_id}/store/{so_a['id']}/cancel", {"reason": "after pickup"})
    r.check("a picked-up order can't be cancelled", False, "it was allowed")
except hh.ApiError as e:
    r.check("a picked-up order can't be cancelled", e.status == 409, e)

# --- 4. Cash on pickup ----------------------------------------------------------------------
print("\n== 4. Cash on pickup")
cust3 = hh.User(customer_email(3))
lines_c = [("ZZ Honey", 1), ("ZZ Basil", 1)]
exp_c = expected("C", lines_c, small=items_total(lines_c) < SMALL_ORDER_BELOW, cash=True)
fill_cart(cust3, lines_c)
cash_preview = cust3.post("/checkout/preview", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}], "payment_method": "cash_on_pickup"})
pc = cash_preview["groups"][0]
r.check("paying at the farm: no service fee, shown as a discount", (pc["service_fee"], pc["cash_discount"], pc["farm_total"]) == (0.0, exp_c["cash_discount"], exp_c["total"]), pc)
cash_order = cust3.post("/orders", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}], "payment_method": "cash_on_pickup"})
cash_id = cash_order["order"]["id"]
so_c = store_orders(cash_id)[farm["C"].id]
r.check("placed at once, released to the farmer, no Stripe charge", so_c["released_to_farmer_at"] is not None and cash_order["client_secret"] is None)
r.check("VA tax is 1% on raw food", so_c["tax"] == exp_c["tax"] and so_c["total"] == exp_c["total"], (so_c, exp_c))
mine = next(o for o in farm["C"].get("/farmers/me/orders", params={"view": "to_prepare"})["items"] if o["id"] == so_c["id"])
r.check("the farmer is told how much cash to collect", mine["amount_to_collect"] == exp_c["total"], mine["amount_to_collect"])
farm["C"].post(f"/farmers/me/orders/{so_c['id']}/ready")
farm["C"].post(f"/farmers/me/orders/{so_c['id']}/handover", {"code": pickup_code(cust3, cash_id, so_c["id"])})
entry = hh.q1("select gross_amount::float as gross, commission_amount::float as commission, cash_collected::float as cash, net_amount::float as net "
              "from farmer_ledger_entries where store_order_id = %(s)s", s=so_c["id"])
owed = round(exp_c["goods"] - round(exp_c["goods"] * COMMISSION, 2) - exp_c["total"], 2)
r.check("ledger: the farmer kept the cash, so they owe HarvestHub its commission and tax",
        entry and (entry["cash"], entry["net"]) == (exp_c["total"], owed), (entry, owed))
r.check("the cash payment reads succeeded", payment(cash_id)["status"] == "succeeded", payment(cash_id))

# --- 5. A declined card ------------------------------------------------------------------
print("\n== 5. A declined card")
cust4 = hh.User(customer_email(4))
fill_cart(cust4, [("ZZ Kale", 2)])
before_kale = stock("ZZ Kale")
before4 = cust4.get("/customers/me/dashboard-summary")
declined = cust4.post("/orders", {"groups": [{"farmer_id": farm["A"].id, "fulfillment_method": "pickup"}], "payment_method": "card"})
intent = hh.pay(declined["client_secret"], "pm_card_chargeDeclined")
r.check("Stripe declined the card", intent.status == "requires_payment_method", intent.status)
time.sleep(5)
sd = store_orders(declined["order"]["id"])[farm["A"].id]
r.check("nothing was placed: not paid, not released, its stock held meanwhile",
        sd["status"] == "pending_payment" and sd["released_to_farmer_at"] is None and stock("ZZ Kale") == before_kale - 2, sd)
r.check("the kale is still in the cart to try again", hh.q1("select count(*) as n from cart_items where customer_id = %(c)s", c=cust4.id)["n"] == 1)
# 2026-11-14: a checkout nobody paid for isn't an order.
shown = cust4.get(f"/orders/{declined['order']['id']}")
r.check("it reads 'not paid yet', the farm's street held back",
        shown.get("checkout_unfinished") is True and shown["store_orders"][0]["pickup_address_street"] is None, shown.get("checkout_unfinished"))
summary4 = cust4.get("/customers/me/dashboard-summary")
r.check("it isn't counted as an order", summary4["orders_total"] == before4["orders_total"], (before4["orders_total"], summary4["orders_total"]))
again = cust4.post(f"/orders/{declined['order']['id']}/resume-payment")
r.check("Pay again: the same payment, ready for another card", again["client_secret"] == declined["client_secret"] and again["card_setup"] is False)
cust4.post(f"/orders/{declined['order']['id']}/cancel", {"reason": "Autotest: gave up"})
r.check("cancelling it cancels the Stripe payment", stripe.PaymentIntent.retrieve(declined["client_secret"].split("_secret_")[0]).status == "canceled")
r.check("removing it gives the stock back", stock("ZZ Kale") == before_kale, (before_kale, stock("ZZ Kale")))
r.check("and removes it: not listed, not counted as cancelled",
        hh.q1("select abandoned_at is not null as gone from orders where id = %(o)s", o=declined["order"]["id"])["gone"]
        and declined["order"]["id"] not in [o["id"] for o in cust4.get("/orders")]
        and cust4.get("/customers/me/dashboard-summary")["orders_cancelled"] == before4["orders_cancelled"])
closed = cust4.post("/orders", {"groups": [{"farmer_id": farm["A"].id, "fulfillment_method": "pickup"}], "payment_method": "card"})
gone = cust4.post(f"/orders/{closed['order']['id']}/discard")
r.check("closing the payment sheet removes the checkout", gone["removed"] is True
        and stripe.PaymentIntent.retrieve(closed["client_secret"].split("_secret_")[0]).status == "canceled")

# --- 6. The farmer cancels a paid order -----------------------------------------------------
print("\n== 6. The farmer cancels a paid order")
cust5 = hh.User(customer_email(5))
lines_k = [("ZZ Kale", 2)]
exp_k = expected("A", lines_k, small=items_total(lines_k) < SMALL_ORDER_BELOW)
fill_cart(cust5, lines_k)
o = cust5.post("/orders", {"groups": [{"farmer_id": farm["A"].id, "fulfillment_method": "pickup"}], "payment_method": "card"})
hh.pay(o["client_secret"])
hh.wait_for(lambda: (payment(o["order"]["id"]) or {}).get("status") == "succeeded", timeout=45) or cust5.post(f"/orders/{o['order']['id']}/sync-payment-status")
so_k = store_orders(o["order"]["id"])[farm["A"].id]
farm["A"].post(f"/farmers/me/orders/{so_k['id']}/ready")
try:
    cust5.post(f"/orders/{o['order']['id']}/store/{so_k['id']}/cancel", {"reason": "after packing"})
    r.check("once packed, the customer can't cancel", False, "it was allowed")
except hh.ApiError as e:
    r.check("once packed, the customer can't cancel", e.status == 409, e)
farm["A"].post(f"/farmers/me/orders/{so_k['id']}/cancel", {"reason": "Autotest: out of kale"})
refund = hh.q1("select amount::float, stripe_refund_id from refunds where store_order_id = %(s)s", s=so_k["id"])
r.check("the customer gets the whole total back", refund and refund["amount"] == exp_k["total"] and
        stripe.Refund.retrieve(refund["stripe_refund_id"]).amount == hh.cents(exp_k["total"]), refund)
fee = hh.q1("select fee_amount::float as fee, net_amount::float as net from farmer_ledger_entries where store_order_id = %(s)s and entry_type = 'cancellation_fee'", s=so_k["id"])
r.check("the farmer pays the service fee from their payout", fee and fee["fee"] == exp_k["fee"] and fee["net"] == -exp_k["fee"], fee)
r.check("the customer was told, with the reason", hh.wait_for(lambda: notices(cust5.id, "order_cancelled_by_farm", started), timeout=20))

# --- Money checks over everything the test accounts did --------------------------------------
print("\n== Money checks (test_queries.sql 4.7, 4.8, 4.10) on test accounts")
r.check("4.7: every paid payment equals its orders' total", not hh.q(
    "select y.order_id from payments y join store_orders s on s.order_id = y.order_id join auth.users u on u.id = y.customer_id "
    "where y.status = 'succeeded' and u.email like 'autotest-%%' group by y.order_id, y.amount having abs(y.amount - sum(s.total)) > 0.01"))
r.check("4.8: nothing refunded beyond its total", not hh.q(
    "select s.id from store_orders s join refunds f on f.store_order_id = s.id where s.farm_name like 'ZZ Autotest%%' "
    "group by s.id, s.total having sum(f.amount) > s.total + 0.01"))
r.check("4.10: every ledger entry adds up", not hh.q(
    "select l.id from farmer_ledger_entries l join farmer_profiles f on f.id = l.farmer_id where f.farm_name like 'ZZ Autotest%%' "
    "and abs(l.gross_amount - l.commission_amount - l.cash_collected - l.fee_amount - l.net_amount) > 0.01"))

r.save()
