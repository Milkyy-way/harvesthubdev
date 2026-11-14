"""Neighborhood Pods, end to end on the live preview setup. Run seed.py first.

1. Three neighbours in one building start the free Harvest Pass month. One
   starts a pod with the building as its drop point, and invites the other two.
   With three members it's active. Someone without Harvest Pass, and someone
   who lives too far away, can't join.
2. Farm A delivers to pods for $4.50 a stop. Two neighbours order to the pod
   and save a card: nothing is charged yet, and the farm can't see the orders.
   The third orders and cancels for free before orders close.
3. Orders close: the test moves these orders' delivery window to 10 minutes
   from now, so the farm's 12-hour cutoff has passed, and runs the 15-minute
   job. The $4.50 is split between the 2 households that ordered: $2.25 each,
   charged once each in Stripe. One card is declined; that neighbour saves a
   new card and is charged.
4. Farm A delivers to the drop point: one stop for both orders, both completed,
   and the ledger has each $2.25 share, with commission only on the goods.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import stripe

import hh
from seed import FARMS, customer_email, seed_neighbours
from shop import expected, fill_cart, payment, store_orders

ET = ZoneInfo("America/New_York")
POD_FEE = 4.50
r = hh.Report("pods")
farm_a = hh.User(FARMS[0]["email"])
host, second, third = seed_neighbours(r)


def pod_share(fee, households):
    cents = round(fee * 100)
    return -(-cents // households) / 100  # rounded up to the cent


def confirm_setup(client_secret, card):
    si_id = client_secret.split("_secret_")[0]
    return stripe.SetupIntent.confirm(si_id, payment_method=card, return_url="https://example.com/return")


def expect_refused(label, fn, status, contains=None):
    try:
        fn()
        r.check(label, False, "it was allowed")
    except hh.ApiError as e:
        r.check(label, e.status == status and (contains is None or contains.lower() in str(e.detail).lower()), e)


# --- 0. A clean start: leave pods from an earlier run --------------------------------------
for person in (host, second, third):
    for pod in person.get("/pods")["pods"]:
        try:
            if pod["is_host"]:
                person.post(f"/pods/{pod['id']}/dissolve")
            else:
                person.post(f"/pods/{pod['id']}/leave")
        except hh.ApiError as e:
            r.note(f"Couldn't clear an earlier pod for {person.email}: {e}")

# --- 1. Starting a pod ----------------------------------------------------------------------
print("\n== 1. Starting a pod")
for person in (host, second, third):
    person.post("/membership/start-free")
r.check("the three neighbours have Harvest Pass (free month)",
        all(hh.q1("select 1 from harvest_pass_free_periods where customer_id = %(c)s and ends_at > now()", c=p.id) for p in (host, second, third)))

settings = farm_a.get("/farmers/me/delivery/settings")
settings.update({"offers_delivery": True, "offers_pod_delivery": True, "pod_delivery_fee": POD_FEE, "cutoff_hours": 12})
settings = farm_a.call("PUT", "/farmers/me/delivery/settings", {k: settings[k] for k in (
    "offers_delivery", "delivery_fee", "radius_miles", "cutoff_hours", "windows", "offers_pod_delivery", "pod_delivery_fee")})[1]
r.check("Farm A delivers to pods for $4.50 a stop", settings["offers_pod_delivery"] and settings["pod_delivery_fee"] == POD_FEE)

weekday = (datetime.now(ET) + timedelta(days=2)).weekday()  # two days out: well before any cutoff
options = host.post("/pods/drop-options", {"drop_kind": "home"})
day = next((d for d in options["days"] if d["weekday"] == weekday), None)
farm_offer = next((f for f in (day or {}).get("farms", []) if f["farmer_id"] == farm_a.id), None)
r.check("the host's building can be a drop point, and Farm A delivers there that day", farm_offer is not None, options)
if farm_offer:
    r.check("the host is shown the $4.50 fee", farm_offer["pod_delivery_fee"] == POD_FEE, farm_offer)

pod = host.post("/pods", {"drop_kind": "home", "name": "ZZ Autotest Pod", "delivery_weekday": weekday})
pod_id = pod["id"]
r.check("pod started, waiting for members", pod["status"] in ("draft", "pending") and pod["member_count"] == 1, pod["status"])
invite = host.post(f"/pods/{pod_id}/invites", {"label": "Apt 202"})
preview = second.get(f"/pods/invites/{invite['code']}")
r.check("the invite shows the pod and the host's first name only", preview["pod_name"] == "ZZ Autotest Pod" and " " not in preview["host_first_name"], preview)
second.post(f"/pods/invites/{invite['code']}/accept")
invite3 = host.post(f"/pods/{pod_id}/invites", {"label": "Apt 303"})
pod = third.post(f"/pods/invites/{invite3['code']}/accept")
r.check("with 3 members the pod is active", pod["status"] == "active" and pod["member_count"] == 3, (pod["status"], pod["member_count"]))
r.check("members see first names only, no addresses", all(" " not in m["first_name"] for m in pod["members"]) and pod["access_notes"] is None)

no_pass = hh.User(customer_email(2))  # never started a free month
inv = host.post(f"/pods/{pod_id}/invites", {"label": "no pass"})
expect_refused("someone without Harvest Pass can't join", lambda: no_pass.post(f"/pods/invites/{inv['code']}/accept"), 402, "Harvest Pass")
far = hh.User(customer_email(6))  # has the free month, lives in Silver Spring
inv = host.post(f"/pods/{pod_id}/invites", {"label": "far"})
expect_refused("someone who lives too far away can't join", lambda: far.post(f"/pods/invites/{inv['code']}/accept"), 409)

# --- 2. Ordering to the pod ------------------------------------------------------------------
print("\n== 2. Ordering to the pod: a saved card, nothing charged yet")
orders_by = {}
lines = {host.id: [("ZZ Tomatoes", 2)], second.id: [("ZZ Kale", 2)], third.id: [("ZZ Kale", 1)]}
cards = {host.id: "pm_card_visa", second.id: "pm_card_chargeCustomerFail", third.id: "pm_card_visa"}  # second: saves, then declines
for person in (host, second, third):
    fill_cart(person, lines[person.id])
    opts = person.get("/delivery/options", params={"farmer_ids": farm_a.id})["farms"][0]
    pod_opt = next((p for p in opts["pods"] if p["pod_id"] == pod_id), None)
    slot = next((s for s in opts["slots"] if datetime.fromisoformat(s["starts_at"]).astimezone(ET).weekday() == weekday), None)
    if person is host:
        r.check("checkout offers the pod as a delivery choice", pod_opt is not None, opts["pods"])
        r.check("there's a delivery window on the pod's day", slot is not None)
    group = {"farmer_id": farm_a.id, "fulfillment_method": "delivery", "delivery_starts_at": slot["starts_at"], "pod_id": pod_id}
    pre = person.post("/checkout/preview", {"groups": [group]})["groups"][0]
    if person is host:
        r.check("checkout shows the most it can cost ($4.50) and the least ($1.50 if all 3 order)",
                pre["delivery_fee"] == POD_FEE and pre["pod_fee_low"] == pod_share(POD_FEE, 3), (pre["delivery_fee"], pre["pod_fee_low"]))
    created = person.post("/orders", {"groups": [group], "payment_method": "card"})
    confirm_setup(created["client_secret"], cards[person.id])
    person.post(f"/orders/{created['order']['id']}/sync-payment-status")
    orders_by[person.id] = created["order"]["id"]

for person in (host, second, third):
    p = payment(orders_by[person.id])
    r.check(f"{person.email.split('@')[0]}: order placed and waiting for orders to close, nothing charged",
            p["status"] == "awaiting_cutoff" and p["stripe_payment_intent_id"] is None, p)
r.check("the farm can't see pod orders before they close",
        not {orders_by[p.id] for p in (host, second)} & {o["order_id"] for o in farm_a.get("/farmers/me/orders", params={"view": "to_prepare"})["items"]})
pod_now = host.get(f"/pods/{pod_id}")
r.check("the pod shows how the split stands: 3 of 3 ordered, $1.50 each so far",
        pod_now["next_orders"] and pod_now["next_orders"]["ordered"] == 3 and pod_now["next_orders"]["share_now"] == pod_share(POD_FEE, 3), pod_now["next_orders"])

third.post(f"/orders/{orders_by[third.id]}/cancel", {"reason": "Autotest: changed my mind"})
r.check("cancelling before orders close is free: nothing was ever charged",
        payment(orders_by[third.id])["status"] == "canceled" and not hh.q1("select 1 from refunds f join payments y on y.id = f.payment_id where y.order_id = %(o)s", o=orders_by[third.id]))

# --- 3. Orders close: the fee is split and charged -------------------------------------------
print("\n== 3. Orders close: the fee is split and each card charged once")
window = hh.q1("select date_trunc('minute', now()) + interval '10 minutes' as s")["s"]
for person in (host, second):
    hh.q("update store_orders set delivery_window_starts_at = %(s)s, delivery_window_ends_at = %(s)s + interval '3 hours' where order_id = %(o)s",
         s=window, o=orders_by[person.id])
expect_refused("after the cutoff a pod order can't be cancelled",
               lambda: host.post(f"/orders/{orders_by[host.id]}/cancel", {"reason": "too late"}), 409, "closed")
jobs = hh.run_jobs()
r.note(f"job result: {({k: v for k, v in jobs.items() if k.startswith('pod')})}")
share = pod_share(POD_FEE, 2)
exp_host = expected("A", lines[host.id])
so_host = store_orders(orders_by[host.id])[farm_a.id]
p_host = payment(orders_by[host.id])
r.check("the fee was split between the 2 households that ordered: $2.25 each", share == 2.25 and hh.q1(
    "select delivery_fee::float as f from store_orders where order_id = %(o)s", o=orders_by[host.id])["f"] == share)
r.check("the host was charged once, the exact total", p_host["status"] == "succeeded" and so_host["total"] == round(exp_host["total"] + share, 2), (p_host, so_host))
if p_host["stripe_payment_intent_id"]:
    pi = stripe.PaymentIntent.retrieve(p_host["stripe_payment_intent_id"])
    r.check("Stripe: the host's saved card was charged that amount", pi.status == "succeeded" and pi.amount_received == hh.cents(so_host["total"]), (pi.status, pi.amount_received))
r.check("the host's order is now paid and released to the farm", so_host["status"] == "paid" and so_host["released_to_farmer_at"] is not None)

p_second = payment(orders_by[second.id])
r.check("the declined card is recorded, the order kept for now", p_second["status"] == "charge_failed", p_second)
r.check("the neighbour is told their card was declined",
        hh.wait_for(lambda: hh.q("select 1 from notifications where profile_id = %(p)s and kind = 'pod_charge_failed'", p=second.id), timeout=20))
new_card = second.post(f"/orders/{orders_by[second.id]}/pod-card")
confirm_setup(new_card["setup_intent_client_secret"], "pm_card_visa")
second.post(f"/orders/{orders_by[second.id]}/sync-payment-status")
p_second = payment(orders_by[second.id])
so_second = store_orders(orders_by[second.id])[farm_a.id]
exp_second = expected("A", lines[second.id])
r.check("with a new card, the neighbour is charged the same $2.25 share", p_second["status"] == "succeeded" and so_second["total"] == round(exp_second["total"] + share, 2),
        (p_second, so_second))
fees = hh.q1("select sum(delivery_fee)::float as f from store_orders where order_id in (%(a)s, %(b)s)", a=orders_by[host.id], b=orders_by[second.id])["f"]
r.check("the two shares add up to the farm's whole $4.50", fees == POD_FEE, fees)

# --- 4. Delivering to the drop point ----------------------------------------------------------
print("\n== 4. Delivering to the drop point")
stops = hh.q("select distinct s.id::text as id, s.run_id::text as run_id, s.kind from store_orders o join delivery_stops s on s.id = o.delivery_stop_id "
             "where o.order_id in (%(a)s, %(b)s)", a=orders_by[host.id], b=orders_by[second.id])
r.check("both orders are one stop: the pod's drop point", len(stops) == 1 and stops[0]["kind"] == "pod", stops)
if len(stops) == 1:
    stop = stops[0]
    run = farm_a.get(f"/farmers/me/delivery/runs/{stop['run_id']}")
    r.check("the farmer's run shows the pod stop, ready to start", run["can_start"], run["status"])
    farm_a.post(f"/farmers/me/delivery/runs/{stop['run_id']}/start")
    farm_a.post(f"/farmers/me/delivery/runs/{stop['run_id']}/stops/{stop['id']}/delivered", {"note": "Autotest: left in the lobby"})
    done = {p.email: store_orders(orders_by[p.id])[farm_a.id]["status"] for p in (host, second)}
    r.check("one 'delivered' completes both orders", set(done.values()) == {"completed"}, done)
    for person, exp in ((host, exp_host), (second, exp_second)):
        e = hh.q1("select gross_amount::float as gross, commission_amount::float as commission from farmer_ledger_entries l "
                  "join store_orders s on s.id = l.store_order_id where s.order_id = %(o)s and l.entry_type = 'order'", o=orders_by[person.id])
        r.check(f"ledger: goods plus the $2.25 share, 10% commission on the goods only ({person.email.split('@')[0]})",
                e and (e["gross"], e["commission"]) == (round(exp["goods"] + share, 2), round(exp["goods"] * 0.10, 2)), e)

r.save()
