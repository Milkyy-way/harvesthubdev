"""Decide "Report a problem" reports (app/problems/service.py).

Run from harvesthub-backend, with the backend's .env (database and Stripe keys):

  venv/Scripts/python scripts/problems.py list
  venv/Scripts/python scripts/problems.py show <report id>
  venv/Scripts/python scripts/problems.py refund <report id> [--items <item id>=<qty>,...] [--everything] [--note "..."]
  venv/Scripts/python scripts/problems.py decline <report id> --note "Why, for the customer"
  venv/Scripts/python scripts/problems.py handled <report id> [--note "..."]

refund with no --items refunds the items the customer chose; --everything
refunds whatever is left of that farm's part (for "I came, but couldn't
collect it"). Each step asks before it does anything.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal  # noqa: E402
from app.core.models import Profile  # noqa: E402
from app.orders.models import Order, StoreOrder, StoreOrderItem  # noqa: E402
from app.payments.models import Payment  # noqa: E402
from app.problems import service  # noqa: E402
from app.problems.models import ProblemReport  # noqa: E402


def _report(db, report_id: str) -> ProblemReport:
    report = db.query(ProblemReport).filter(ProblemReport.id == report_id).first()
    if report is None:
        sys.exit("No report with that id.")
    return report


def _confirm(question: str) -> bool:
    return input(f"{question} [y/N] ").strip().lower() == "y"


def cmd_list(db, _args) -> None:
    reports = db.query(ProblemReport).filter(ProblemReport.status == "open").order_by(ProblemReport.created_at).all()
    if not reports:
        print("No open reports.")
    for r in reports:
        so = db.get(StoreOrder, r.store_order_id)
        print(f"{r.id}  {r.created_at:%Y-%m-%d %H:%M}  {so.farm_name:<28}  {service.REASONS.get(r.reason, r.reason)}")


def cmd_show(db, args) -> None:
    r = _report(db, args.id)
    so = db.get(StoreOrder, r.store_order_id)
    order = db.get(Order, so.order_id)
    customer = db.get(Profile, order.customer_id)
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    print(f"Report {r.id} ({r.status}), {r.created_at:%Y-%m-%d %H:%M}")
    print(f"Customer: {customer.full_name if customer else '?'}   Farm: {so.farm_name}")
    print(f"Paid: {payment.payment_method if payment else '?'}   Part total: ${float(so.total):.2f}   Status: {so.status}")
    print(f"What went wrong: {service.REASONS.get(r.reason, r.reason)}")
    if r.details:
        print(f"They wrote: {r.details}")
    print("Items on this part (id, quantity, name, price):")
    for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id == so.id):
        chosen = next((c["quantity"] for c in r.items or [] if c["item_id"] == str(item.id)), 0)
        mark = f"  <- reported {chosen}" if chosen else ""
        print(f"  {item.id}  {item.quantity} × {item.product_name}  ${float(item.line_total):.2f}{mark}")
    preview = service.refund_amounts(db, r)
    print(f"Refunding the reported items would be ${preview['amount']:.2f}.")
    everything = service.refund_amounts(db, r, everything=True)
    print(f"Refunding everything left would be ${everything['amount']:.2f}.")


def _parse_items(text: str | None) -> dict | None:
    if not text:
        return None
    out = {}
    for part in text.split(","):
        item_id, _, qty = part.partition("=")
        out[item_id.strip()] = int(qty or 1)
    return out


def cmd_refund(db, args) -> None:
    r = _report(db, args.id)
    items = _parse_items(args.items)
    preview = service.refund_amounts(db, r, items, args.everything)
    print(f"Refund ${preview['amount']:.2f} for: {', '.join(preview['lines']) or 'nothing'}")
    if not _confirm("Send this refund to the customer's card?"):
        return
    try:
        result = service.refund_report(db, args.id, items, args.everything, args.note)
    except ValueError as e:
        sys.exit(str(e))
    print(f"Refunded ${result['refunded']:.2f}. ${result['farm_share']:.2f} comes off the farm's next payout.")


def cmd_decline(db, args) -> None:
    if not _confirm("Decline this report and email the customer your note?"):
        return
    try:
        service.decline_report(db, args.id, args.note)
    except ValueError as e:
        sys.exit(str(e))
    print("Declined.")


def cmd_handled(db, args) -> None:
    try:
        service.mark_handled(db, args.id, args.note)
    except ValueError as e:
        sys.exit(str(e))
    print("Marked handled.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    for name in ("show", "refund", "decline", "handled"):
        p = sub.add_parser(name)
        p.add_argument("id")
        if name == "refund":
            p.add_argument("--items")
            p.add_argument("--everything", action="store_true")
        if name in ("refund", "decline", "handled"):
            p.add_argument("--note", required=name == "decline")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        {"list": cmd_list, "show": cmd_show, "refund": cmd_refund, "decline": cmd_decline, "handled": cmd_handled}[args.command](db, args)
    finally:
        db.close()


if __name__ == "__main__":
    main()
