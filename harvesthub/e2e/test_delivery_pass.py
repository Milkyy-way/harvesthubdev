"""Home delivery and Harvest Pass, end to end on the live preview setup. Run
seed.py first.

Delivery: Farm A turns delivery on ($5, 8 miles, every evening), a customer
orders for delivery and pays by card, the order joins that evening's run, the
farmer starts the run (its date is moved to today in the database, since a run
can only start on its delivery day), shares a location and marks it delivered.
The farmer's ledger gets the whole delivery fee with no commission on it.

Harvest Pass: a customer starts the free month; a checkout of $25 or more has
no service fee, a smaller one still does; the free month can't be started twice.
"""
import stripe

import hh
from seed import FARMS, customer_email
from shop import expected, fill_cart, payment, store_orders

r = hh.Report("delivery-pass")
farm = {f["key"]: hh.User(f["email"]) for f in FARMS}

# --- Delivery -----------------------------------------------------------------------------
print("\n== Home delivery")
settings = farm["A"].call("PUT", "/farmers/me/delivery/settings", {
    "offers_delivery": True, "delivery_fee": 5.00, "radius_miles": 8, "cutoff_hours": 12,
    "windows": [{"weekday": d, "start_time": "16:00", "end_time": "19:00"} for d in range(7)],
    "offers_pod_delivery": False, "pod_delivery_fee": 5.00,
})[1]
r.check("Farm A saved its delivery settings", settings["offers_delivery"] and settings["delivery_fee"] == 5.0 and len(settings["windows"]) == 7)

cust = hh.User(customer_email(1))
lines = [("ZZ Tomatoes", 2), ("ZZ Kale", 2)]
fill_cart(cust, lines)
options = cust.get("/delivery/options", params={"farmer_ids": farm["A"].id})["farms"][0]
r.check("customer 1 (2.4 miles away) can get delivery", options["available"], options.get("reason"))
r.check("the customer is offered delivery windows", len(options["slots"]) > 0)
slot = options["slots"][0]
far = hh.User(customer_email(10))  # Annandale, VA: 9 miles from Farm A, past its 8
far_options = far.get("/delivery/options", params={"farmer_ids": farm["A"].id})["farms"][0]
r.check("a customer 9 miles away (past 8) can't, and is told why", not far_options["available"] and far_options["reason"], far_options.get("reason"))

group = {"farmer_id": farm["A"].id, "fulfillment_method": "delivery", "delivery_starts_at": slot["starts_at"]}
exp = expected("A", lines)
preview = cust.post("/checkout/preview", {"groups": [group]})["groups"][0]
r.check("checkout adds the farm's $5 delivery fee", preview["delivery_fee"] == 5.0 and preview["farm_total"] == round(exp["total"] + 5, 2),
        (preview["farm_total"], exp["total"]))
try:
    cust.post("/orders", {"groups": [group], "payment_method": "cash_on_pickup"})
    r.check("delivery can't be paid in cash", False, "it was allowed")
except hh.ApiError as e:
    r.check("delivery can't be paid in cash", e.status == 400, e)

created = cust.post("/orders", {"groups": [group], "payment_method": "card"})
order_id = created["order"]["id"]
hh.pay(created["client_secret"])
r.check("paid by card", hh.wait_for(lambda: (payment(order_id) or {}).get("status") == "succeeded", timeout=45), payment(order_id))
so = store_orders(order_id)[farm["A"].id]
stop = hh.q1("select s.id::text as id, s.run_id::text as run_id, s.status from delivery_stops s join store_orders o on o.delivery_stop_id = s.id where o.id = %(s)s", s=so["id"])
r.check("the order became a stop on that evening's run", stop is not None, stop)

# A run starts on its delivery day: bring this one to today. A run from an
# earlier test that already sits there moves back a few weeks first.
TODAY_16 = "date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York' + interval '16 hours'"
hh.q(f"update delivery_runs set window_starts_at = window_starts_at - interval '28 days' - (extract(epoch from now())::bigint %% 10000) * interval '1 minute', "
     f"window_ends_at = window_ends_at - interval '28 days' - (extract(epoch from now())::bigint %% 10000) * interval '1 minute' "
     f"where farmer_id = %(f)s and window_starts_at = {TODAY_16} and id <> %(r)s", f=farm["A"].id, r=stop["run_id"])
hh.q("update delivery_runs set window_starts_at = date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York' + interval '16 hours', "
     "window_ends_at = date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York' + interval '19 hours' where id = %(r)s", r=stop["run_id"])
hh.q("update store_orders set delivery_window_starts_at = (select window_starts_at from delivery_runs where id = %(r)s), "
     "delivery_window_ends_at = (select window_ends_at from delivery_runs where id = %(r)s) where id = %(s)s", r=stop["run_id"], s=so["id"])
runs = farm["A"].get("/farmers/me/delivery/runs")
run = next(x for x in runs["upcoming"] if x["id"] == stop["run_id"])
r.check("the farmer sees today's run, ready to start", run["can_start"] and run["stop_count"] >= 1, run)
started = farm["A"].post(f"/farmers/me/delivery/runs/{stop['run_id']}/start")
r.check("the run started and the order is on its way", started["status"] == "in_progress" and store_orders(order_id)[farm["A"].id]["status"] == "out_for_delivery",
        started["status"])
try:
    cust.post(f"/orders/{order_id}/store/{so['id']}/cancel", {"reason": "too late"})
    r.check("the customer can't cancel once it's on its way", False, "it was allowed")
except hh.ApiError as e:
    r.check("the customer can't cancel once it's on its way", e.status == 409, e)
farm["A"].call("POST", f"/farmers/me/delivery/runs/{stop['run_id']}/location", {"latitude": 38.93, "longitude": -77.07, "heading": 90})
tracking = cust.get(f"/orders/{order_id}/store/{so['id']}/tracking")
r.check("the customer can track the farmer's location", tracking is not None, tracking)
done = farm["A"].post(f"/farmers/me/delivery/runs/{stop['run_id']}/stops/{stop['id']}/delivered", {"note": "Autotest: left at the door"})
r.check("marked delivered: the order is complete", store_orders(order_id)[farm["A"].id]["status"] == "completed")
entry = hh.q1("select gross_amount::float as gross, commission_amount::float as commission, net_amount::float as net "
              "from farmer_ledger_entries where store_order_id = %(s)s and entry_type = 'order'", s=so["id"])
commission = round(exp["goods"] * 0.10, 2)
r.check("ledger: the farm keeps the whole $5 fee, commission only on the goods",
        entry and (entry["gross"], entry["commission"], entry["net"]) == (round(exp["goods"] + 5, 2), commission, round(exp["goods"] + 5 - commission, 2)), entry)

# --- Harvest Pass ----------------------------------------------------------------------------
print("\n== Harvest Pass free month")
member = hh.User(customer_email(6))
overview = member.post("/membership/start-free")
r.check("customer 6 started the free month", hh.q1("select 1 from harvest_pass_free_periods where customer_id = %(c)s and ends_at > now()", c=member.id) is not None, overview)
fill_cart(member, [("ZZ Honey", 2), ("ZZ Basil", 1)])  # $27 at Farm C
big = member.post("/checkout/preview", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}]})
r.check("$25 or more: no service fee, and the saving is shown", big["groups"][0]["service_fee"] == 0 and big["member_savings"] == round(27 * 0.05, 2),
        (big["groups"][0]["service_fee"], big["member_savings"]))
fill_cart(member, [("ZZ Basil", 2)])  # $6
small = member.post("/checkout/preview", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}]})
r.check("under $25: the service fee still applies", small["groups"][0]["service_fee"] == 0.30, small["groups"][0]["service_fee"])
member.post("/membership/start-free")
r.check("tapping Start free month again doesn't add a second month",
        hh.q1("select count(*) as n from harvest_pass_free_periods where customer_id = %(c)s", c=member.id)["n"] == 1)
nonmember = hh.User(customer_email(7))
fill_cart(nonmember, [("ZZ Honey", 2), ("ZZ Basil", 1)])
upsell = nonmember.post("/checkout/preview", {"groups": [{"farmer_id": farm["C"].id, "fulfillment_method": "pickup"}]})
r.check("a non-member pays the fee and is shown what Harvest Pass would save", upsell["groups"][0]["service_fee"] == 1.35 and upsell["member_potential_savings"] == 1.35,
        (upsell["groups"][0]["service_fee"], upsell["member_potential_savings"]))
for c in (member, nonmember):
    hh.q("delete from cart_items where customer_id = %(c)s", c=c.id)

r.save()
