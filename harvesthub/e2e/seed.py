"""Creates (or refreshes) the test cast: 3 farms and 10 customers, all named
"ZZ Autotest", on @example.com addresses. Safe to run again: it reuses what is
already there and resets stock and prices to the values below.

- Accounts are made through Supabase's sign-up with the same details the app
  sends, so the database builds their profiles exactly as it does for people.
- Farms get their address, farm type and application filled in, then are
  approved (what the test owner does in Supabase Studio).
- Text messages are off for everyone; email is on only for customer 1.
- Products are added through the farmer API, as the Products screen does.
"""
from datetime import date, timedelta

import hh

FARMS = [
    {"key": "A", "email": "autotest-farm-a@example.com", "farm": "ZZ Autotest Farm A", "owner": "Autotest Farmer A",
     "phone": "2025550101", "street": "3101 Wisconsin Ave NW", "city": "Washington", "state": "DC", "zip": "20016"},
    {"key": "B", "email": "autotest-farm-b@example.com", "farm": "ZZ Autotest Farm B", "owner": "Autotest Farmer B",
     "phone": "2025550102", "street": "4511 Knox Rd", "city": "College Park", "state": "MD", "zip": "20740"},
    {"key": "C", "email": "autotest-farm-c@example.com", "farm": "ZZ Autotest Farm C", "owner": "Autotest Farmer C",
     "phone": "2025550103", "street": "2100 Clarendon Blvd", "city": "Arlington", "state": "VA", "zip": "22201"},
]

CUSTOMERS = [
    ("1600 Rhode Island Ave NW", "Washington", "DC", "20036"),
    ("700 Pennsylvania Ave SE", "Washington", "DC", "20003"),
    ("1100 4th St SW", "Washington", "DC", "20024"),
    ("2000 14th St NW", "Washington", "DC", "20009"),
    ("3050 K St NW", "Washington", "DC", "20007"),
    ("8661 Colesville Rd", "Silver Spring", "MD", "20910"),
    ("6400 Baltimore Ave", "Riverdale", "MD", "20737"),
    ("1101 Wilson Blvd", "Arlington", "VA", "22209"),
    ("400 King St", "Alexandria", "VA", "22314"),
    ("7000 Columbia Pike", "Annandale", "VA", "22003"),
]

# name, category, price, unit, stock, tax type, keep cold
PRODUCTS = {
    "A": [("ZZ Tomatoes", "vegetables", 4.00, "lb", 200, "raw", False),
          ("ZZ Kale", "vegetables", 3.50, "bunch", 200, "raw", False),
          ("ZZ Strawberry Jam", "fruits", 8.00, "jar", 100, "prepared", False)],
    "B": [("ZZ Eggs", "eggs", 6.00, "dozen", 200, "raw", True),
          ("ZZ Apples", "fruits", 2.40, "lb", 300, "raw", False)],
    "C": [("ZZ Basil", "herbs", 3.00, "bunch", 200, "raw", False),
          ("ZZ Honey", "honey", 12.00, "jar", 100, "raw", False)],
}


# Customers 11-13: neighbours in one building, for Neighborhood Pods (members
# must live within half a mile of the drop point).
NEIGHBOURS = [
    ("1500 Massachusetts Ave NW", "101", "Washington", "DC", "20005"),
    ("1500 Massachusetts Ave NW", "202", "Washington", "DC", "20005"),
    ("1500 Massachusetts Ave NW", "303", "Washington", "DC", "20005"),
]


def seed_neighbours(report: hh.Report) -> list:
    people = []
    for n, (street, unit, city, state, zip_) in enumerate(NEIGHBOURS, start=11):
        email = customer_email(n)
        hh.ensure_user(email, {
            "role": "customer", "full_name": f"Autotest Neighbour {n:02d}", "phone": f"20255501{10 + n:02d}",
            "address_street": street, "address_unit": unit, "address_city": city, "address_state": state, "address_zip": zip_,
            "dietary_preferences": [], "produce_interests": [], "referral_source": "other", "referral_source_other": "automated test",
        })
        person = hh.User(email)
        person.call("PUT", "/notifications/settings", {"sms_enabled": False, "email_enabled": False, "push_enabled": True})
        people.append(person)
    report.check("3 neighbours in one building exist", all(p.id for p in people))
    return people


def customer_email(n: int) -> str:
    return f"autotest-customer-{n:02d}@example.com"


def seed_farms(report: hh.Report) -> dict:
    farms = {}
    for f in FARMS:
        uid = hh.ensure_user(f["email"], {"role": "farmer", "full_name": f["owner"], "phone": f["phone"], "farm_name": f["farm"]})
        hh.q(
            """update farmer_profiles set farm_name = %(farm)s, address_street = %(street)s, address_city = %(city)s,
                   address_state = %(state)s, address_zip = %(zip)s, farm_types = array['produce'], years_in_operation = 5,
                   bio = 'A test farm used by the automated tests. Not a real farm.'
               where id = %(id)s""",
            id=uid, **f,
        )
        hh.q(
            """update farmer_verification set business_license_number = 'AUTOTEST-0001',
                   business_license_file_path = 'autotest/license.pdf', insurance_file_path = 'autotest/insurance.pdf',
                   insurance_expiration_date = %(exp)s, gov_id_file_path = 'autotest/id.pdf', land_proof_file_path = 'autotest/land.pdf',
                   submitted_at = coalesce(submitted_at, now()), status = 'approved', reviewed_at = coalesce(reviewed_at, now()),
                   reviewer_notes = 'Approved by the automated tests'
               where id = %(id)s""",
            id=uid, exp=date.today() + timedelta(days=365),
        )
        hh.q("update profiles set status = 'active' where id = %(id)s", id=uid)
        farms[f["key"]] = hh.User(f["email"])
        report.check(f"{f['farm']} exists and is approved", hh.q1(
            "select 1 from profiles p join farmer_verification v on v.id = p.id where p.id = %(id)s and p.status = 'active' and v.status = 'approved'",
            id=uid) is not None)
    return farms


def seed_customers(report: hh.Report) -> list:
    customers = []
    for n, (street, city, state, zip_) in enumerate(CUSTOMERS, start=1):
        email = customer_email(n)
        hh.ensure_user(email, {
            "role": "customer", "full_name": f"Autotest Customer {n:02d}", "phone": f"20255501{10 + n:02d}",
            "address_street": street, "address_city": city, "address_state": state, "address_zip": zip_,
            "dietary_preferences": [], "produce_interests": [], "referral_source": "other", "referral_source_other": "automated test",
        })
        customers.append(hh.User(email))
    report.check("10 test customers exist", len(customers) == 10 and all(c.id for c in customers))
    return customers


def quiet_messages(users: list, email_on: set, report: hh.Report) -> None:
    for u in users:
        u.call("PUT", "/notifications/settings", {"sms_enabled": False, "email_enabled": u.email in email_on, "push_enabled": True})
    off = hh.q1(
        "select count(*) as n from notification_settings s join auth.users u on u.id = s.profile_id "
        "where u.email like 'autotest-%%@example.com' and s.sms_enabled",
    )
    report.check("text messages are off for every test account", off is None or off["n"] == 0, off)


def seed_products(farms: dict, report: hh.Report) -> dict:
    products = {}
    for key, items in PRODUCTS.items():
        farmer = farms[key]
        mine = {p["name"]: p for p in farmer.get("/farmers/me/products")}
        for name, category, price, unit, stock, tax, cold in items:
            body = {"name": name, "category_slug": category, "price": price, "unit": unit, "quantity_available": stock,
                    "tax_category": tax, "keep_cold": cold, "is_active": True}
            if name in mine:
                product = farmer.call("PATCH", f"/farmers/me/products/{mine[name]['id']}", body)[1]
            else:
                product = farmer.post("/farmers/me/products", body)
            products[name] = product["id"]
        report.check(f"Farm {key}'s products are listed", len(farmer.get("/farmers/me/products")) >= len(items))
    return products


if __name__ == "__main__":
    report = hh.Report("seed")
    farms = seed_farms(report)
    customers = seed_customers(report)
    quiet_messages(list(farms.values()) + customers, {customer_email(1)}, report)
    seed_products(farms, report)
    feed = customers[0].get("/farmers/feed", params={"limit": 50})
    names = {f["farm_name"] for f in feed["items"]}
    report.check("customer 1 (downtown DC) sees all three test farms", {f["farm"] for f in FARMS} <= names, sorted(names))
    report.save()
