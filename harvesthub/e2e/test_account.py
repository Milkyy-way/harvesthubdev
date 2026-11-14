"""Saved places, ratings, deleting an account, and a pod pausing, on the live
preview setup. Run seed.py, test_orders.py and test_pods.py first.

Saved places: customer 6 (Silver Spring) adds "Work" in Arlington and browses
from there: the farms and distances change, and back to Home they change back.
Up to 5 places.

Ratings: only a picked-up order can be rated; rating again revises it; the
farmer and the farm's spotlight card show it.

Deleting: a throwaway customer with an open order is told to finish it first;
once it's picked up they can delete. They can't log in again, their name is
gone, and the order stays in the farm's history without them.

Pod pausing: one of the three neighbours leaves, the pod drops below 3 members
and pauses, and the others are told.
"""
import requests

import hh
from seed import FARMS, customer_email
from shop import fill_cart, products

r = hh.Report("account")
farm_a, farm_c = hh.User(FARMS[0]["email"]), hh.User(FARMS[2]["email"])


def expect_refused(label, fn, status=None, contains=None):
    try:
        fn()
        r.check(label, False, "it was allowed")
    except hh.ApiError as e:
        r.check(label, (status is None or e.status == status) and (contains is None or contains.lower() in str(e.detail).lower()), e)


def place_order(customer, farm, lines):
    fill_cart(customer, lines)
    created = customer.post("/orders", {"groups": [{"farmer_id": farm.id, "fulfillment_method": "pickup"}], "payment_method": "cash_on_pickup"})
    oid = created["order"]["id"]
    so = created["order"]["store_orders"][0]["id"]
    return oid, so


# --- Saved places ------------------------------------------------------------------------
print("\n== Saved places")
c6 = hh.User(customer_email(6))
for p in c6.get("/customers/me/places")["places"]:
    c6.call("DELETE", f"/customers/me/places/{p['id']}")
c6.call("PUT", "/customers/me/places/active", {"place_id": None})
home_feed = {f["farm_name"]: f["distance_km"] for f in c6.get("/farmers/feed", params={"limit": 50})["items"] if f["farm_name"].startswith("ZZ")}
work = c6.post("/customers/me/places", {"name": "Work", "address_street": "1101 Wilson Blvd", "address_city": "Arlington",
                                        "address_state": "VA", "address_zip": "22209"})
places = c6.get("/customers/me/places")
work_id = next(p["id"] for p in places["places"] if p["name"] == "Work")
r.check("customer 6 saved 'Work' in Arlington", work_id is not None and places["max_places"] >= 1, places)
c6.call("PUT", "/customers/me/places/active", {"place_id": work_id})
work_feed = {f["farm_name"]: f["distance_km"] for f in c6.get("/farmers/feed", params={"limit": 50})["items"] if f["farm_name"].startswith("ZZ")}
r.check("browsing from Work: Farm C (Arlington) is now much closer",
        work_feed.get("ZZ Autotest Farm C", 99) < home_feed.get("ZZ Autotest Farm C", 0), (home_feed, work_feed))
c6.call("PUT", "/customers/me/places/active", {"place_id": None})
back = {f["farm_name"]: f["distance_km"] for f in c6.get("/farmers/feed", params={"limit": 50})["items"] if f["farm_name"].startswith("ZZ")}
r.check("back to Home, the distances are back", back == home_feed, (home_feed, back))
extra = []
for i in range(10):
    try:
        extra.append(c6.post("/customers/me/places", {"name": f"Spot {i}", "address_street": "400 King St", "address_city": "Alexandria",
                                                       "address_state": "VA", "address_zip": "22314"}))
    except hh.ApiError as e:
        r.check(f"saved places stop at the limit ({places['max_places']})", len(c6.get("/customers/me/places")["places"]) == places["max_places"], e)
        break
else:
    r.check("saved places stop at a limit", False, "10 more were allowed")
for p in c6.get("/customers/me/places")["places"]:
    c6.call("DELETE", f"/customers/me/places/{p['id']}")
r.check("places can be deleted", c6.get("/customers/me/places")["places"] == [])

# --- Ratings ------------------------------------------------------------------------------
print("\n== Ratings")
c7 = hh.User(customer_email(7))
oid, so = place_order(c7, farm_c, [("ZZ Honey", 1)])
expect_refused("an order not yet picked up can't be rated",
               lambda: c7.post(f"/orders/{oid}/store/{so}/rating", {"rating": 5}), 409, "completed")
farm_c.post(f"/farmers/me/orders/{so}/ready")
c7.post(f"/orders/{oid}/store/{so}/complete")
c7.post(f"/orders/{oid}/store/{so}/rating", {"rating": 3, "comment": "Autotest: fine"})
c7.post(f"/orders/{oid}/store/{so}/rating", {"rating": 5, "comment": "Autotest: great honey"})
rows = hh.q("select rating, comment from farmer_ratings where store_order_id = %(s)s", s=so)
r.check("rating again revises it, no duplicate", len(rows) == 1 and rows[0]["rating"] == 5, rows)
mine = farm_c.get("/farmers/me/ratings")
r.check("the farmer sees the rating and comment", any(x.get("comment") == "Autotest: great honey" for x in mine.get("ratings", mine.get("items", []))) or mine.get("count", 0) >= 1, mine)
spot = {f["farm_name"]: f for f in c7.get("/farmers/spotlight", params={"limit": 20})["items"]}
card = spot.get("ZZ Autotest Farm C")
r.check("the farm's spotlight card shows an average rating", card and card["average_rating"] is not None and card["rating_count"] >= 1, card)
expect_refused("ratings must be 1 to 5", lambda: c7.post(f"/orders/{oid}/store/{so}/rating", {"rating": 6}), 422)

# --- Deleting an account --------------------------------------------------------------------
print("\n== Deleting an account")
email = "autotest-delete-me@example.com"
hh.ensure_user(email, {"role": "customer", "full_name": "Autotest Delete Me", "phone": "2025550199",
                       "address_street": "2000 14th St NW", "address_city": "Washington", "address_state": "DC", "address_zip": "20009",
                       "dietary_preferences": [], "produce_interests": [], "referral_source": "other"})
leaver = hh.User(email)
leaver.call("PUT", "/notifications/settings", {"sms_enabled": False, "email_enabled": False})
oid, so = place_order(leaver, farm_a, [("ZZ Kale", 1)])
check = leaver.get("/account/deletion-check")
r.check("with an order in progress, deleting is blocked with a clear reason", not check["can_delete"] and "in progress" in " ".join(check["blockers"]), check)
expect_refused("and the delete itself is refused", lambda: leaver.call("DELETE", "/account"), 409)
farm_a.post(f"/farmers/me/orders/{so}/ready")
leaver.post(f"/orders/{oid}/store/{so}/complete")
r.check("once it's picked up, deleting is allowed", leaver.get("/account/deletion-check")["can_delete"])
uid = leaver.id
leaver.call("DELETE", "/account")
r.check("the login is gone", hh.user_id_for(email) is None)
login = requests.post(f"{hh.SUPABASE}/auth/v1/token?grant_type=password", headers={"apikey": hh.ANON_KEY},
                      json={"email": email, "password": hh.PASSWORD}, timeout=30)
r.check("they can't log in again", login.status_code in (400, 401), login.status_code)
prof = hh.q1("select full_name, phone from profiles where id = %(u)s", u=uid)
r.check("their name and phone are gone", prof is None or (prof["full_name"] in (None, "", "Deleted user") and not prof["phone"]), prof)
kept = hh.q1("select s.status, s.total::float as total from store_orders s where s.id = %(s)s", s=so)
r.check("the farm keeps the order in its history (amounts, items)", kept is not None and kept["status"] == "completed", kept)
r.check("the farm's ledger entry is kept", hh.q1("select 1 from farmer_ledger_entries where store_order_id = %(s)s", s=so) is not None)

# --- A pod pausing ------------------------------------------------------------------------
print("\n== A pod pausing when a member leaves")
host, second, third = (hh.User(customer_email(n)) for n in (11, 12, 13))
pods = host.get("/pods")["pods"]
pod = next((p for p in pods if p["name"] == "ZZ Autotest Pod" and p["status"] == "active"), None)
if not r.check("the pod from test_pods.py is active", pod is not None, pods):
    r.save()
    raise SystemExit
third.post(f"/pods/{pod['id']}/leave")
hh.run_jobs()
after = host.get(f"/pods/{pod['id']}")
r.check("with 2 members left, the pod pauses and shows when it would end", after["status"] == "paused" and after["grace_ends_at"], (after["status"], after["grace_ends_at"]))
r.check("the others are told", hh.wait_for(lambda: hh.q(
    "select 1 from notifications where profile_id = %(p)s and kind like 'pod_%%' and created_at > now() - interval '10 minutes'", p=host.id), timeout=20))
r.check("third neighbour is no longer a member", not any(p["id"] == pod["id"] for p in third.get("/pods")["pods"]))

r.save()
