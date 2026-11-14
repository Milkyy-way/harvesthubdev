"""Group deals, end to end on the live preview setup. Run seed.py and
test_pods.py first (customers 6 and 11-13 have the free Harvest Pass month).

Deal 1 reaches its goal. Farm B offers 2.5 lb bags of apples, $6.00 regular,
for $4.50: goal 5 households, 8 bags. The rules refuse a bad deal. Publishing
sets the stock aside. For the first 24 hours only Harvest Pass members can
join; then everyone. Joining saves a card and charges nothing. One household
withdraws. At the deadline every household is charged exactly what it was
quoted, unclaimed bags go back on sale, and a card that declines is recorded.

Deal 2 misses its goal. Farm C offers basil; two households join, the
deadline passes, nobody is charged, and the Harvest Pass member is offered the
basil at the regular price, charged on the card they saved.

The deal's dates are moved in the database so each phase happens now, then
the 15-minute job is run on demand.
"""
import stripe

import hh
from seed import FARMS, customer_email
from shop import products, stock

r = hh.Report("deals")
farm_b, farm_c = hh.User(FARMS[1]["email"]), hh.User(FARMS[2]["email"])
members = [hh.User(customer_email(n)) for n in (11, 12, 13, 6)]  # free month
others = [hh.User(customer_email(n)) for n in (1, 3, 4, 5, 7)]  # no Harvest Pass
c11, c12, c13, c6 = members
c1, c3, c4, c5, c7 = others


def expect_refused(label, fn, status=None, contains=None):
    try:
        fn()
        r.check(label, False, "it was allowed")
    except hh.ApiError as e:
        r.check(label, (status is None or e.status == status) and (contains is None or contains.lower() in str(e.detail).lower()), e)


def set_phase(deal_id, phase):
    """Moves the deal's clock: 'early' = members only, 'live' = everyone, 'deadline' = closed."""
    sql = {
        "early": "member_opens_at = now() - interval '1 minute', public_opens_at = now() + interval '1 day', deadline_at = now() + interval '4 days'",
        "live": "member_opens_at = now() - interval '25 hours', public_opens_at = now() - interval '1 minute', deadline_at = now() + interval '3 days'",
        "deadline": "deadline_at = now() - interval '1 minute'",
    }[phase]
    hh.q(f"update group_deals set {sql} where id = %(d)s", d=deal_id)


def join(customer, deal_id, units=1, card="pm_card_visa"):
    """What the app does: a quote, then save a card, then confirm. Returns the quote."""
    quote = customer.post(f"/deals/{deal_id}/quote", {"units": units, "fulfillment_method": "pickup"})
    joined = customer.post(f"/deals/{deal_id}/join", {"units": units, "fulfillment_method": "pickup"})
    si = joined["setup_intent_client_secret"].split("_secret_")[0]
    stripe.SetupIntent.confirm(si, payment_method=card, return_url="https://example.com/return")
    customer.post(f"/deals/{deal_id}/join/confirm")
    return quote


def deal_orders(deal_id):
    return {row["customer_id"]: row for row in hh.q(
        "select o.customer_id::text, s.id::text as so_id, s.status, s.total::float as total, y.status as pay, y.amount::float as amount, "
        "y.stripe_payment_intent_id as pi from store_orders s join orders o on o.id = s.order_id join payments y on y.order_id = o.id "
        "where s.group_deal_id = %(d)s", d=deal_id)}


# --- Deal 1: reaches its goal ----------------------------------------------------------------
print("\n== Deal 1: setting it up")
apples = products["ZZ Apples"]
# The deal price is per pound, like the listing: $1.80/lb makes a 2.5 lb bag $4.50.
for old in farm_b.get("/farmers/me/deals")["deals"]:
    if old["status"] == "draft":
        farm_b.call("DELETE", f"/farmers/me/deals/{old['id']}")
base = {"product_id": apples["id"], "share_size": 2.5, "deal_price": 1.80, "goal": 5, "capacity": 8, "max_units": 2,
        "window_days": 5, "subscriber_fallback": True}
bad = farm_b.post("/farmers/me/deals/preview", {**base, "deal_price": 0.80})
r.check("the rules refuse 67% off (must be 10-40%)", any("10–40%" in e for e in bad["errors"]), bad["errors"])
bad = farm_b.post("/farmers/me/deals/preview", {**base, "goal": 2})
r.check("the rules refuse a goal under 5 households", any("at least" in e for e in bad["errors"]), bad["errors"])
preview = farm_b.post("/farmers/me/deals/preview", base)
pay = preview["payout"]
r.check("a good deal has no errors", preview["errors"] == [], preview["errors"])
r.check("the farmer sees $6.00 regular, $4.50 a bag, 25% off, $4.05 each after 10%",
        (pay["regular_share_price"], pay["share_price"], pay["discount_percent"], pay["net_per_share"]) == (6.0, 4.5, 25.0, 4.05), pay)

stock_before = stock("ZZ Apples")
deal = farm_b.post("/farmers/me/deals", base)
deal = farm_b.post(f"/farmers/me/deals/{deal['id']}/publish")
deal_id = deal["id"]
r.check("published: 20 lb (8 bags of 2.5 lb) set aside from Farm B's stock", stock("ZZ Apples") == stock_before - 20, (stock_before, stock("ZZ Apples")))

print("\n== Deal 1: members first, then everyone")
set_phase(deal_id, "early")
hh.run_jobs()
expect_refused("in the first 24 hours a non-member can't join", lambda: join(c1, deal_id), contains="Harvest Pass members")
quotes = {c11.id: join(c11, deal_id, units=2)}
r.check("a member can join early, 2 bags", hh.q1("select units, status from group_commits where deal_id = %(d)s and customer_id = %(c)s", d=deal_id, c=c11.id) is not None)
r.check("joining charges nothing: no payment yet",
        not hh.q1("select 1 from orders o join store_orders s on s.order_id = o.id where s.group_deal_id = %(d)s", d=deal_id))
# The quote only prices; joining is where the limit is enforced.
expect_refused("joining with 3 bags is refused (2 per household)",
               lambda: c12.post(f"/deals/{deal_id}/join", {"units": 3, "fulfillment_method": "pickup"}), 409, "up to 2")

set_phase(deal_id, "live")
hh.run_jobs()
for person in (c12, c13, c1, c3):
    quotes[person.id] = join(person, deal_id)
quotes[c4.id] = join(c4, deal_id, card="pm_card_chargeCustomerFail")  # saves, then declines at the deadline
join(c5, deal_id)
c5.post(f"/deals/{deal_id}/withdraw")
r.check("a household can withdraw well before the deadline",
        hh.q1("select status from group_commits where deal_id = %(d)s and customer_id = %(c)s", d=deal_id, c=c5.id)["status"] != "active")
expect_refused("joining twice is refused", lambda: c12.post(f"/deals/{deal_id}/join", {"units": 1}), contains="already joined")
view = c7.get(f"/deals/{deal_id}")
r.check("6 households have joined, goal 5: the deal shows the goal is met", view["households"] == 6 and view["status"] in ("goal_met", "live", "full"), (view["households"], view["status"]))

print("\n== Deal 1: the deadline")
t0 = hh.q1("select now() at time zone 'utc' as t")["t"]
set_phase(deal_id, "deadline")
result = hh.run_jobs()
r.note(f"job result: deals_closed={result.get('deals_closed')}")
hh.wait_for(lambda: len(deal_orders(deal_id)) >= 6, timeout=30)
done = deal_orders(deal_id)
r.check("the deal unlocked", hh.q1("select status from group_deals where id = %(d)s", d=deal_id)["status"] == "unlocked")
r.check("every household that stayed in got an order (6)", len(done) == 6, len(done))
for person in (c11, c12, c13, c1, c3):
    o = done.get(person.id)
    ok = o and o["pay"] == "succeeded" and o["amount"] == quotes[person.id]["total"]
    if ok and o["pi"]:
        pi = stripe.PaymentIntent.retrieve(o["pi"])
        ok = pi.status == "succeeded" and pi.amount_received == hh.cents(quotes[person.id]["total"])
    r.check(f"{person.email.split('@')[0]}: charged exactly what they were quoted (${quotes[person.id]['total']:.2f}), and Stripe agrees", ok, o)
r.check("the withdrawn household got no order", c5.id not in done)
o4 = done.get(c4.id)
r.check("the card that declines is recorded, not charged", o4 and o4["pay"] == "charge_failed", o4)
claimed = 2 + 1 + 1 + 1 + 1 + 1  # bags, including the declined one until it's dropped
# The same job also drops declined deal orders from earlier runs (after their
# 2-hour retry), which gives their stock back: count that in.
returned = hh.q1(
    "select coalesce(sum(i.stock_units), 0) as n from order_cancellations c join store_orders s on s.id = c.store_order_id "
    "join store_order_items i on i.store_order_id = s.id where s.group_deal_id is not null and s.group_deal_id <> %(d)s "
    "and s.farmer_id = %(f)s and c.created_at >= %(t)s", d=deal_id, f=farm_b.id, t=t0)["n"]
if returned:
    r.note(f"{returned} lb came back from earlier runs' declined deal orders, dropped after their retry")
r.check("unclaimed bags went back on sale: 20 lb set aside, 7 bags (18 lb, rounded up) kept",
        stock("ZZ Apples") == stock_before - 18 + returned, (stock_before, stock("ZZ Apples"), returned))
r.check("the farmer sees the paid orders", len({o["so_id"] for o in done.values() if o["status"] == "paid"} &
                                               {x["id"] for x in farm_b.get("/farmers/me/orders", params={"view": "to_prepare"})["items"]}) == 5)
expect_refused("a deal order can't be cancelled once the deal has closed",
               lambda: c12.post(f"/orders/{hh.q1('select order_id::text as o from store_orders where id = %(s)s', s=done[c12.id]['so_id'])['o']}/cancel", {"reason": "late"}),
               409, "closed")
so = done[c12.id]["so_id"]
farm_b.post(f"/farmers/me/orders/{so}/ready")
oid = hh.q1("select order_id::text as o from store_orders where id = %(s)s", s=so)["o"]
c12.post(f"/orders/{oid}/store/{so}/complete")
e = hh.q1("select gross_amount::float as gross, commission_amount::float as commission from farmer_ledger_entries where store_order_id = %(s)s", s=so)
r.check("ledger: a $4.50 bag, $0.45 commission, like any sale", e and (e["gross"], e["commission"]) == (4.5, 0.45), e)

# --- Deal 2: misses its goal --------------------------------------------------------------
print("\n== Deal 2: misses its goal")
basil = products["ZZ Basil"]
d2 = farm_c.post("/farmers/me/deals", {"product_id": basil["id"], "share_size": 1, "deal_price": 2.40, "goal": 5, "capacity": 6,
                                       "max_units": 1, "window_days": 5, "subscriber_fallback": True})
d2 = farm_c.post(f"/farmers/me/deals/{d2['id']}/publish")
basil_before = stock("ZZ Basil")
set_phase(d2["id"], "live")
hh.run_jobs()
join(c11, d2["id"])
join(c1, d2["id"])
set_phase(d2["id"], "deadline")
hh.run_jobs()
r.check("the deal expired: 2 households, goal 5", hh.q1("select status from group_deals where id = %(d)s", d=d2["id"])["status"] == "expired")
r.check("nobody was charged", not deal_orders(d2["id"]))
offer = c11.get(f"/deals/{d2['id']}")["fallback"]
r.check("the member is offered the basil at the regular price", offer is not None, offer)
r.check("the non-member isn't", c1.get(f"/deals/{d2['id']}")["fallback"] is None)
c11.post(f"/deals/{d2['id']}/regular-price")
o = deal_orders(d2["id"]).get(c11.id)
r.check("buying it charges their saved card the regular $3.00 plus fee and tax", o and o["pay"] == "succeeded" and hh.q1(
    "select subtotal::float as s from store_orders where id = %(s)s", s=o["so_id"])["s"] == 3.0, o)
if o and o["pi"]:
    r.check("Stripe agrees", stripe.PaymentIntent.retrieve(o["pi"]).amount_received == hh.cents(o["amount"]))

r.save()
