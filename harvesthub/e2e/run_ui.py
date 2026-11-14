"""Runs the Maestro screen tests on the Android emulator, each with the setup it
needs before and the database and Stripe checks after.

    harvesthub-backend/venv/Scripts/python harvesthub/e2e/run_ui.py            # all of them, in order
    harvesthub-backend/venv/Scripts/python harvesthub/e2e/run_ui.py signup     # only journeys whose name contains "signup"

Needs: the emulator running with the HarvestHub preview app installed, Maestro
in %USERPROFILE%\\.maestro, and Android Studio's Java (or JAVA_HOME set).
Each run signs up a new customer and a new farm (named with the date and time),
and suspends the test farms that earlier runs signed up, so customers don't see
a pile of them.
"""
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import stripe

import hh
from seed import FARMS, customer_email
from shop import products

APP = hh.ROOT / "harvesthub" / "app"
MAESTRO = Path(os.environ["USERPROFILE"]) / ".maestro" / "maestro" / "bin" / "maestro.bat"
JAVA_HOME = os.environ.get("JAVA_HOME") or r"C:\Program Files\Android\Android Studio\jbr"
ADB_DIR = Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk" / "platform-tools"
PHOTO = Path(__file__).resolve().parent / "autotest-photo.png"

STAMP = datetime.now().strftime("%m%d%H%M")
UI_CUSTOMER = f"autotest-ui-customer-{STAMP}@example.com"
UI_FARMER = f"autotest-ui-farm-{STAMP}@example.com"
UI_FARM = f"ZZ Autotest UI Farm {STAMP}"
UI_PRODUCT = f"ZZ UI Peppers {STAMP}"
UI_CODE = f"UI{STAMP}"


def adb(*args):
    return subprocess.run([str(ADB_DIR / "adb.exe"), *args], capture_output=True, text=True).stdout


def maestro(flow: str, **env) -> bool:
    environ = dict(os.environ, JAVA_HOME=JAVA_HOME, MAESTRO_CLI_NO_ANALYTICS="1",
                   MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED="true",
                   PATH=f"{JAVA_HOME}\\bin;{ADB_DIR};{os.environ['PATH']}")
    args = [str(MAESTRO), "test", flow, "--format", "junit", "--output", str(hh.RESULTS_DIR / f"{Path(flow).stem}.xml"),
            "--test-output-dir", str(hh.RESULTS_DIR / "maestro")]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    hh.RESULTS_DIR.mkdir(exist_ok=True)
    print(f"\n-- maestro {flow}", flush=True)
    return subprocess.run(args, cwd=APP / ".maestro", env=environ).returncode == 0


def paid_order(customer: hh.User, farmer_id: str, lines) -> tuple[str, str]:
    hh.q("delete from cart_items where customer_id = %(c)s", c=customer.id)
    for product_id, qty in lines:
        for _ in range(qty):
            customer.post(f"/cart/items/{product_id}/increment")
    created = customer.post("/orders", {"groups": [{"farmer_id": farmer_id, "fulfillment_method": "pickup"}], "payment_method": "card"})
    hh.pay(created["client_secret"])
    oid = created["order"]["id"]
    hh.wait_for(lambda: (hh.q1("select status from payments where order_id = %(o)s", o=oid) or {}).get("status") == "succeeded", timeout=45) \
        or customer.post(f"/orders/{oid}/sync-payment-status")
    return oid, created["order"]["store_orders"][0]["id"]


# --- The journeys --------------------------------------------------------------------------

def customer_promo_order(r):
    cust = hh.User(customer_email(8))
    farm_a = hh.User(FARMS[0]["email"])
    hh.q("delete from cart_items where customer_id = %(c)s", c=cust.id)
    if "ZZTEST10" not in {c["code"] for c in farm_a.get("/farmers/me/promo-codes")}:
        farm_a.post("/farmers/me/promo-codes", {"code": "ZZTEST10", "discount_type": "percentage", "discount_value": 10, "show_on_farm_page": True})
    started = hh.q1("select now() as t")["t"]
    r.check("promo order, screens: saw the promo, applied it and paid $14.97", maestro("customer_promo_order.yaml", EMAIL=cust.email, PASSWORD=hh.PASSWORD))
    order = hh.q1("select o.id::text as id, y.status, y.stripe_payment_intent_id as pi from orders o join payments y on y.order_id = o.id "
                  "where o.customer_id = %(c)s and o.created_at >= %(t)s order by o.created_at desc limit 1", c=cust.id, t=started)
    if not r.check("promo order, database: the order exists", order is not None):
        return
    so = hh.q1("select status, promo_code, total::float as total from store_orders where order_id = %(o)s", o=order["id"])
    r.check("promo order, database: paid $14.97 with ZZTEST10", order["status"] == "succeeded" and so["promo_code"] == "ZZTEST10" and so["total"] == 14.97, (order, so))
    pi = stripe.PaymentIntent.retrieve(order["pi"])
    r.check("promo order, Stripe: $14.97 charged", pi.status == "succeeded" and pi.amount_received == 1497)


def customer_signup(r):
    r.check("customer sign-up, screens: signed up and reached Home", maestro("customer_signup.yaml", EMAIL=UI_CUSTOMER, PASSWORD=hh.PASSWORD))
    row = hh.q1("select p.role, p.status, p.full_name, c.address_street, c.address_city, c.address_state, c.address_zip, c.produce_interests, "
                "c.referral_source from auth.users u join profiles p on p.id = u.id join customer_profiles c on c.id = u.id where u.email = %(e)s", e=UI_CUSTOMER)
    r.check("customer sign-up, database: an active customer with the address from the suggestion",
            row and (row["role"], row["status"], row["address_street"], row["address_city"], row["address_state"], row["address_zip"])
            == ("customer", "active", "1600 Rhode Island Ave NW", "Washington", "DC", "20036"), row)
    # "Other" with nothing typed after it: optional really is optional (fix list item 7).
    r.check("customer sign-up, database: interests and how they heard", row and row["produce_interests"] == ["herbs"] and row["referral_source"] == "other", row)


def farmer_signup_application(r):
    # Farms signed up by earlier runs: out of customers' sight.
    hh.q("update profiles set status = 'suspended' where id in (select id from farmer_profiles where farm_name like 'ZZ Autotest UI Farm %%') and status = 'active'")
    if "autotest-photo.png" not in adb("shell", "ls", "/sdcard/Download/"):
        adb("push", str(PHOTO), "/sdcard/Download/autotest-photo.png")
        adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Download/autotest-photo.png")
    r.check("farmer application, screens: signed up, farm details, 4 documents, submitted",
            maestro("farmer_signup_application.yaml", EMAIL=UI_FARMER, PASSWORD=hh.PASSWORD, FARM=UI_FARM))
    uid = hh.user_id_for(UI_FARMER)
    if not r.check("farmer application, database: the farmer account exists", uid is not None):
        return
    v = hh.q1("select status, submitted_at is not null as submitted, business_license_number, insurance_expiration_date::text as expires, "
              "business_license_file_path, insurance_file_path, gov_id_file_path, land_proof_file_path from farmer_verification where id = %(u)s", u=uid)
    f = hh.q1("select farm_name, address_street, address_zip, farm_types, years_in_operation from farmer_profiles where id = %(u)s", u=uid)
    r.check("farmer application, database: submitted, with the license number, expiry and farm details",
            v["submitted"] and v["business_license_number"] == "BL-UI-0001" and v["expires"] == "2027-06-30"
            and f["address_street"] == "4200 Wisconsin Ave NW" and f["farm_types"] == ["produce"] and f["years_in_operation"] == 7, (v, f))
    paths = [v[k] for k in ("business_license_file_path", "insurance_file_path", "gov_id_file_path", "land_proof_file_path")]
    stored = hh.q("select name from storage.objects where bucket_id = 'farmer-verification-docs' and name = any(%(p)s)", p=paths)
    r.check("farmer application, storage: all 4 documents uploaded privately", all(paths) and len(stored) == 4, stored)
    # Approval, as the test owner does in Supabase Studio.
    hh.q("update farmer_verification set status = 'approved', reviewed_at = now(), reviewer_notes = 'Approved by the automated tests' where id = %(u)s", u=uid)
    hh.q("update profiles set status = 'active' where id = %(u)s", u=uid)


def farmer_product_promo(r):
    uid = hh.user_id_for(UI_FARMER)
    if not uid:
        r.check("product and promo: needs the farm from the application journey", False)
        return
    r.check("product and promo, screens: approved farm adds a product with a photo, makes, pauses and resumes a code",
            maestro("farmer_product_promo.yaml", EMAIL=UI_FARMER, PASSWORD=hh.PASSWORD, FARM=UI_FARM, PRODUCT=UI_PRODUCT, CODE=UI_CODE))
    p = hh.q1("select price::float as price, unit, quantity_available as stock, image_url is not null as photo from products where farmer_id = %(u)s and name = %(n)s",
              u=uid, n=UI_PRODUCT)
    r.check("product and promo, database: $3.25/lb, 40 in stock, with a photo", p and (p["price"], p["unit"], p["stock"], p["photo"]) == (3.25, "lb", 40, True), p)
    c = hh.q1("select discount_value::float as value, is_active, show_on_farm_page, expires_at is not null as ends from promo_codes where farmer_id = %(u)s and code = %(c)s",
              u=uid, c=UI_CODE)
    r.check("product and promo, database: the code is 15% off, live, on the farm page, with an end date", c and (c["value"], c["is_active"], c["show_on_farm_page"], c["ends"]) == (15.0, True, True, True), c)
    shown = hh.User(customer_email(1)).get(f"/farmers/{uid}")["promotions"]
    r.check("product and promo: a customer sees it on the farm page", any(x["code"] == UI_CODE for x in shown), shown)


def farmer_mark_ready(r):
    uid = hh.user_id_for(UI_FARMER)
    product = hh.q1("select id::text as id from products where farmer_id = %(u)s and name = %(n)s", u=uid, n=UI_PRODUCT) if uid else None
    if not product:
        r.check("mark ready: needs the product from the previous journey", False)
        return
    cust = hh.User(customer_email(3))
    oid, so = paid_order(cust, uid, [(product["id"], 2)])  # 2 lb at $3.25 = $6.50; earnings $5.85
    ok = maestro("farmer_mark_ready.yaml", EMAIL=UI_FARMER, PASSWORD=hh.PASSWORD, CUSTOMER="Autotest Customer 03", EARNINGS="\\$5\\.85")
    r.check("mark ready, screens: the farmer saw the order, its earnings at 10%, and marked it ready", ok)
    r.check("mark ready, database: ready for pickup", hh.q1("select status from store_orders where id = %(s)s", s=so)["status"] == "ready_for_pickup")


def customer_pickup_rate(r):
    uid = hh.user_id_for(UI_FARMER)
    cust = hh.User(customer_email(3))
    so = hh.q1("select s.id::text as id from store_orders s join orders o on o.id = s.order_id where s.farmer_id = %(f)s and o.customer_id = %(c)s "
               "and s.status = 'ready_for_pickup' order by s.created_at desc limit 1", f=uid, c=cust.id) if uid else None
    if not so:
        r.check("pickup and rating: needs the ready order from the previous journey", False)
        return
    r.check("pickup and rating, screens: marked received and rated 4 stars", maestro("customer_pickup_rate.yaml", EMAIL=cust.email, PASSWORD=hh.PASSWORD, FARM=UI_FARM))
    time.sleep(2)
    r.check("pickup and rating, database: completed", hh.q1("select status from store_orders where id = %(s)s", s=so["id"])["status"] == "completed")
    rating = hh.q1("select rating, comment from farmer_ratings where store_order_id = %(s)s", s=so["id"])
    r.check("pickup and rating, database: 4 stars", rating and rating["rating"] == 4, rating)
    r.check("pickup and rating, database: the comment was saved", rating and rating["comment"] == "Autotest: great peppers", rating)
    e = hh.q1("select gross_amount::float as gross, commission_amount::float as commission from farmer_ledger_entries where store_order_id = %(s)s", s=so["id"])
    r.check("pickup and rating, ledger: $6.50 sales, $0.65 commission", e and (e["gross"], e["commission"]) == (6.5, 0.65), e)


def customer_cancel(r):
    cust = hh.User(customer_email(3))
    farm_a = hh.User(FARMS[0]["email"])
    oid, so = paid_order(cust, farm_a.id, [(products["ZZ Kale"]["id"], 1)])
    total = hh.q1("select total::float as t from store_orders where id = %(s)s", s=so)["t"]
    r.check("cancelling, screens: cancelled a paid order and saw it refunded", maestro("customer_cancel.yaml", EMAIL=cust.email, PASSWORD=hh.PASSWORD, FARM="ZZ Autotest Farm A"))
    refund = hh.q1("select amount::float as amount, stripe_refund_id from refunds where store_order_id = %(s)s", s=so)
    r.check("cancelling, database: cancelled and refunded in full",
            hh.q1("select status from store_orders where id = %(s)s", s=so)["status"] == "cancelled" and refund and refund["amount"] == total, refund)
    if refund:
        r.check("cancelling, Stripe: the refund went through", stripe.Refund.retrieve(refund["stripe_refund_id"]).status in ("succeeded", "pending"))


JOURNEYS = [customer_promo_order, customer_signup, farmer_signup_application, farmer_product_promo,
            farmer_mark_ready, customer_pickup_rate, customer_cancel]

if __name__ == "__main__":
    wanted = sys.argv[1:]
    report = hh.Report("ui")
    report.note(f"This run's sign-ups: {UI_CUSTOMER}, {UI_FARMER} ({UI_FARM})")
    for journey in JOURNEYS:
        if not wanted or any(w in journey.__name__ for w in wanted):
            try:
                journey(report)
            except Exception as e:  # one journey failing shouldn't stop the rest
                report.check(f"{journey.__name__} ran without errors", False, repr(e))
    report.save()
