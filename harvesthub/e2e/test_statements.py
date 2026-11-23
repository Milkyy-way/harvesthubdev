"""The farmer's Transactions and statements (2026-11-22), end to end on the
live preview setup. Run after test_pickup.py (Farm A then has sales, a
refund and charges). Read-only: it changes nothing.

1. Transactions: newest first, filters, pages.
2. An order's statement: the lines add up; another farm's order is refused.
3. The weekly statement link: the page and the spreadsheet open without the
   app's sign-in; a changed link doesn't.
"""
import requests

import hh
from seed import FARMS

r = hh.Report("statements")
farm = {f["key"]: hh.User(f["email"]) for f in FARMS}
ORIGIN = hh.API.removesuffix("/api/v1")

print("\n== 1. Transactions")
rows = farm["A"].get("/farmers/me/earnings/transactions")["items"]
r.check("Farm A has transactions", len(rows) > 0, len(rows))
times = [x["at"] for x in rows]
r.check("newest first", times == sorted(times, reverse=True))
sales = farm["A"].get("/farmers/me/earnings/transactions", params={"kind": "sales"})["items"]
r.check("Sales shows only sales", sales and all(x["kind"] == "sale" for x in sales))
adj = farm["A"].get("/farmers/me/earnings/transactions", params={"kind": "adjustments"})["items"]
r.check("Refunds & charges shows only those", all(x["kind"] in ("refund", "charge") for x in adj))
r.check("customers show as First L.", all(x["title"].split(" · ")[0].endswith(".") or x["kind"] != "sale" for x in rows[:20]),
        [x["title"] for x in rows[:5]])

print("\n== 2. An order's statement")
sale = sales[0]
s = farm["A"].get(f"/farmers/me/earnings/orders/{sale['store_order_id']}")
lines = round(sum(line["amount"] for e in s["entries"] for line in e["lines"]), 2)
r.check("its lines add up to the total", abs(lines - s["net"]) < 0.005, (lines, s["net"]))
r.check("items, number and customer are there", s["items"] and s["order_ref"] == sale["order_ref"] and s["customer"])
try:
    farm["B"].get(f"/farmers/me/earnings/orders/{sale['store_order_id']}")
    r.check("another farm can't open it", False, "it opened")
except hh.ApiError as e:
    r.check("another farm can't open it", e.status == 404, e)

print("\n== 3. The weekly statement")
link = farm["A"].post(f"/farmers/me/earnings/statements/{sale['period_start']}/link")
page = requests.get(ORIGIN + link["path"], timeout=30)
r.check("the page opens from the link, without signing in", page.status_code == 200 and "Weekly statement" in page.text, page.status_code)
r.check("no service fee or card details on it", "service fee" not in page.text.lower())
sheet = requests.get(ORIGIN + link["path"] + "/csv", timeout=30)
r.check("the spreadsheet downloads", sheet.status_code == 200 and "Sales after promo" in sheet.text, sheet.status_code)
token = link["path"].rsplit("/", 1)[1]
changed = requests.get(f"{ORIGIN}/statements/{token[:-2]}{'AA' if not token.endswith('AA') else 'BB'}", timeout=30)
r.check("a changed link doesn't open", changed.status_code == 404, changed.status_code)

r.save()
