"""The farmer's Transactions and statements (asked for 2026-11-21; agreed
2026-11-22), the way delivery apps give restaurants a merchant statement.

* transactions(): every money line, newest first: sales, refunds, charges,
  and the weekly payouts.
* order_statement(): one order's statement: the items and prices, the
  farm's promo, sales, commission, the delivery fee the farm keeps, cash
  collected, any refund or charge, and which payout it's in.
* weekly statement: a printable page, and a spreadsheet (CSV), for one pay
  week, opened in the phone's browser through a short-lived signed link
  (the browser can't send the app's sign-in). For the farm's bookkeeping.

What the farm sees is its own money. Not shown: the customer's card, their
email or home address, the service fee and Harvest Pass savings (HarvestHub's,
not the farm's) and Stripe's fee. Customers are "First L." here.
"""
import base64
import csv
import hashlib
import hmac
import html
import io
import time
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.localtime import LOCAL_TZ
from app.core.models import Profile
from app.farmers.models import FarmerProfile
from app.orders.models import Order, OrderCancellation, StoreOrder, StoreOrderItem
from app.orders.service import FARM_NOT_READY_REASON
from app.payments.models import Payment
from app.payouts.models import LedgerEntry, Payout
from app.problems.models import ProblemReport

PAGE_SIZE = 40
LINK_LIFETIME = 30 * 60  # seconds
KINDS = ("all", "sales", "adjustments", "payouts")
_PROBLEM_REASONS = {
    "missing_item": "missing",
    "damaged": "damaged",
    "wrong_item": "wrong item",
    "quality": "poor quality",
    "farm_closed": "couldn't collect it",
    "other": "other",
}


def _money(value) -> float:
    return round(float(value or 0), 2)


def _minus(value) -> float:
    """-amount, without a "-0.00" for nothing."""
    return -_money(value) or 0.0


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def short_name(full_name: str | None) -> str:
    """'Jane Doe' -> 'Jane D.' (how delivery apps show a customer to the shop)."""
    parts = (full_name or "").split()
    if not parts:
        return "A customer"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0].upper()}."


def order_ref(store_order_id) -> str:
    """A short order number for statements: the first 8 characters of the id."""
    return str(store_order_id).replace("-", "")[:8].upper()


def _period_label(start: date, end: date) -> str:
    if start.month == end.month:
        return f"{start:%b} {start.day}–{end.day}, {end.year}"
    return f"{start:%b} {start.day} – {end:%b} {end.day}, {end.year}"


def _payout_state(payout: Payout | None) -> dict:
    """Where a week's money stands, for the app and the statements."""
    if payout is None:
        return {"status": "open", "label": "In this week's payout (not prepared yet)", "paid_on": None}
    net = _money(payout.net_total)
    if payout.status == "paid":
        if net < 0:
            return {"status": "settled", "label": "Settled", "paid_on": _iso(payout.disbursed_at)}
        paid_on = _aware(payout.disbursed_at)
        local = paid_on.astimezone(LOCAL_TZ) if paid_on else None
        return {
            "status": "paid",
            "label": f"Paid {local:%b} {local.day}" if local else "Paid",
            "paid_on": _iso(payout.disbursed_at),
        }
    if payout.status == "carried_forward":
        return {"status": "carried", "label": "Owed · came off a later payout", "paid_on": None}
    if net < 0:
        return {"status": "owed", "label": "Owed · comes off your next payout", "paid_on": None}
    return {"status": "pending", "label": "Being sent by bank transfer", "paid_on": None}


# --- Order context, shared by the list and the statements -----------------------------------


def _orders_context(db: Session, store_order_ids: set) -> dict:
    """For each store order: its order, customer name, payment method,
    item count, problem report and cancellation."""
    if not store_order_ids:
        return {}
    rows = (
        db.query(StoreOrder, Order, Profile.full_name, Payment.payment_method)
        .join(Order, Order.id == StoreOrder.order_id)
        .outerjoin(Profile, Profile.id == Order.customer_id)
        .outerjoin(Payment, Payment.order_id == Order.id)
        .filter(StoreOrder.id.in_(store_order_ids))
        .all()
    )
    items: dict = {}
    for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id.in_(store_order_ids)):
        items.setdefault(item.store_order_id, []).append(item)
    reports = {r.store_order_id: r for r in db.query(ProblemReport).filter(ProblemReport.store_order_id.in_(store_order_ids))}
    cancels = {c.store_order_id: c for c in db.query(OrderCancellation).filter(OrderCancellation.store_order_id.in_(store_order_ids))}
    out = {}
    for so, order, name, method in rows:
        out[so.id] = {
            "so": so,
            "order": order,
            "customer": short_name(name),
            "method": method,
            "items": sorted(items.get(so.id, []), key=lambda i: i.created_at or datetime.min),
            "report": reports.get(so.id),
            "cancel": cancels.get(so.id),
        }
    return out


def _what_happened(ctx: dict) -> str:
    so = ctx["so"]
    if so.status == "not_picked":
        return "Not picked up"
    if so.status == "cancelled":
        return "Cancelled"
    if so.status == "completed":
        return "Delivered" if so.fulfillment_method == "delivery" else "Picked up"
    return "In progress"


def _payment_word(ctx: dict) -> str:
    return "Cash" if ctx and ctx["method"] == "cash_on_pickup" else "Card"


def _refund_detail(ctx: dict) -> str:
    report = ctx["report"] if ctx else None
    if report is not None and report.status == "refunded":
        items = ", ".join(f"{i['quantity']} × {i['product_name']}" for i in report.items or [])
        reason = _PROBLEM_REASONS.get(report.reason, report.reason)
        return f"Problem reported: {items + ' · ' if items else ''}{reason}"
    return "Refunded after it was paid out"


def _charge_detail(ctx: dict) -> str:
    cancel = ctx["cancel"] if ctx else None
    if cancel is not None and cancel.reason == FARM_NOT_READY_REASON:
        return "Not packed within 24 hours, so the customer cancelled"
    return "You cancelled a paid order"


def _entry_row(e: LedgerEntry, ctx: dict | None) -> dict:
    name = ctx["customer"] if ctx else "A customer"
    if e.entry_type == "order":
        n = sum(i.quantity for i in ctx["items"]) if ctx else 0
        kind, title = "sale", f"{name} · {n} item{'' if n == 1 else 's'}"
        detail = f"{_what_happened(ctx)} · {_payment_word(ctx)}" if ctx else "Sale"
        if ctx and ctx["method"] == "cash_on_pickup":
            detail += f" · you collected ${_money(e.cash_collected):.2f}"
    elif e.entry_type == "refund_adjustment":
        kind, title, detail = "refund", f"Refund · {name}", _refund_detail(ctx)
    else:
        kind, title, detail = "charge", f"Cancellation charge · {name}", _charge_detail(ctx)
    return {
        "id": str(e.id),
        "kind": kind,
        "at": _iso(e.created_at),
        "title": title,
        "detail": detail,
        "amount": _money(e.net_amount),
        "store_order_id": str(e.store_order_id),
        "order_ref": order_ref(e.store_order_id),
        "period_start": e.pay_period_start.isoformat(),
        "payout_status": None,
    }


def _payout_row(p: Payout) -> dict:
    state = _payout_state(p)
    return {
        "id": str(p.id),
        "kind": "payout",
        "at": _iso(p.disbursed_at or p.created_at),
        "title": f"Payout · {_period_label(p.pay_period_start, p.pay_period_end)}",
        "detail": state["label"],
        "amount": _money(p.net_total),
        "store_order_id": None,
        "order_ref": None,
        "period_start": p.pay_period_start.isoformat(),
        "payout_status": state["status"],
    }


def transactions(db: Session, farmer_id, kind: str = "all", before: str | None = None, limit: int = PAGE_SIZE) -> dict:
    if kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown filter.")
    limit = max(1, min(limit, 100))
    cutoff = None
    if before:
        try:
            cutoff = datetime.fromisoformat(before)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad page.")
        cutoff = _aware(cutoff)

    entries: list[LedgerEntry] = []
    if kind != "payouts":
        q = db.query(LedgerEntry).filter(LedgerEntry.farmer_id == farmer_id)
        if kind == "sales":
            q = q.filter(LedgerEntry.entry_type == "order")
        elif kind == "adjustments":
            q = q.filter(LedgerEntry.entry_type.in_(("refund_adjustment", "cancellation_fee")))
        if cutoff is not None:
            q = q.filter(LedgerEntry.created_at < cutoff)
        entries = q.order_by(LedgerEntry.created_at.desc()).limit(limit + 1).all()

    payouts: list[Payout] = []
    if kind in ("all", "payouts"):
        # A payout's moment is when it was sent, or prepared if not yet.
        # About 52 a year, so sorted here.
        rows = db.query(Payout).filter(Payout.farmer_id == farmer_id).all()
        if cutoff is not None:
            rows = [p for p in rows if _aware(p.disbursed_at or p.created_at) < cutoff]
        payouts = sorted(rows, key=lambda p: _aware(p.disbursed_at or p.created_at), reverse=True)[: limit + 1]

    context = _orders_context(db, {e.store_order_id for e in entries})
    merged = [(_aware(e.created_at), _entry_row(e, context.get(e.store_order_id))) for e in entries]
    merged += [(_aware(p.disbursed_at or p.created_at), _payout_row(p)) for p in payouts]
    merged.sort(key=lambda pair: pair[0], reverse=True)
    page = merged[:limit]
    more = len(merged) > limit
    return {
        "items": [row for _, row in page],
        "next_before": page[-1][0].isoformat() if more and page else None,
    }


# --- One order's statement ----------------------------------------------------------------


def _owned_store_order(db: Session, farmer_id, store_order_id: str) -> StoreOrder:
    try:
        sid = uuid.UUID(str(store_order_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    so = (
        db.query(StoreOrder)
        .filter(StoreOrder.id == sid, StoreOrder.farmer_id == farmer_id, StoreOrder.released_to_farmer_at.isnot(None))
        .first()
    )
    if so is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return so


def _entry_lines(e: LedgerEntry, so: StoreOrder, ctx: dict) -> list[dict]:
    """The money lines of one ledger entry, as the farm reads them."""
    if e.entry_type == "order":
        delivery = _money(so.delivery_fee) if _money(e.gross_amount) > 0 else 0.0
        sales = round(_money(e.gross_amount) - delivery, 2)
        rate = round(float(e.commission_rate or 0) * 100)
        lines = [{"label": "Sales, after your promo", "amount": sales}]
        if delivery > 0:
            lines.append({"label": "Delivery fee (yours to keep)", "amount": delivery})
        lines.append({"label": f"HarvestHub commission ({rate}%)", "amount": -_money(e.commission_amount)})
        if _money(e.cash_collected) > 0:
            lines.append({"label": "Cash you collected at pickup", "amount": -_money(e.cash_collected)})
        return lines
    if e.entry_type == "refund_adjustment":
        return [{"label": f"Refund: {_refund_detail(ctx)}", "amount": _money(e.net_amount)}]
    return [{"label": f"Cancellation charge: {_charge_detail(ctx).lower()}", "amount": _money(e.net_amount)}]


def order_statement(db: Session, farmer_id, store_order_id: str) -> dict:
    so = _owned_store_order(db, farmer_id, store_order_id)
    ctx = _orders_context(db, {so.id})[so.id]
    order = ctx["order"]
    entries = (
        db.query(LedgerEntry)
        .filter(LedgerEntry.store_order_id == so.id, LedgerEntry.farmer_id == farmer_id)
        .order_by(LedgerEntry.created_at)
        .all()
    )
    payout_ids = {e.payout_id for e in entries if e.payout_id}
    payouts = {p.id: p for p in db.query(Payout).filter(Payout.id.in_(payout_ids))} if payout_ids else {}

    cash = ctx["method"] == "cash_on_pickup"
    finished_at = so.completed_at if so.status == "completed" else so.not_picked_at if so.status == "not_picked" else None
    if so.status == "cancelled" and ctx["cancel"] is not None:
        finished_at = ctx["cancel"].created_at

    if entries:
        note = None
    elif so.status == "cancelled":
        note = "Cancelled before it was handed over, so there's no sale and nothing to pay."
    elif so.status == "not_picked" and cash:
        note = "A cash order nobody picked up: no sale, and nothing is owed."
    else:
        note = "This order is added to your statement when it's handed over."

    return {
        "store_order_id": str(so.id),
        "order_ref": order_ref(so.id),
        "customer": ctx["customer"],
        "placed_at": _iso(order.placed_at),
        "finished_at": _iso(finished_at),
        "what_happened": _what_happened(ctx),
        "fulfillment_method": so.fulfillment_method,
        "payment_method": "cash_on_pickup" if cash else "card",
        "items": [
            {
                "name": i.product_name,
                "unit": i.unit,
                "quantity": i.quantity,
                "unit_price": _money(i.unit_price),
                "line_total": _money(i.line_total),
            }
            for i in ctx["items"]
        ],
        "items_total": _money(so.subtotal),
        "promo_code": so.promo_code,
        "promo_discount": _money(so.promo_discount),
        "delivery_fee": _money(so.delivery_fee),
        "tax": _money(so.tax),
        "cash_total": _money(so.total) if cash else None,
        "entries": [
            {
                "kind": "sale" if e.entry_type == "order" else "refund" if e.entry_type == "refund_adjustment" else "charge",
                "at": _iso(e.created_at),
                "lines": _entry_lines(e, so, ctx),
                "net": _money(e.net_amount),
                "period_start": e.pay_period_start.isoformat(),
                "period_end": e.pay_period_end.isoformat(),
                "payout": _payout_state(payouts.get(e.payout_id)) if e.payout_id else _payout_state(None),
            }
            for e in entries
        ],
        "net": _money(sum(float(e.net_amount) for e in entries)),
        "note": note,
    }


# --- Weekly statement: a printable page and a spreadsheet, through a signed link -------------


def _link_key() -> bytes:
    # A key of its own, derived from a secret the backend always has.
    return hmac.new(settings.STRIPE_SECRET_KEY.encode(), b"harvesthub-farm-statements", hashlib.sha256).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def statement_token(farmer_id, period_start: date, now: float | None = None) -> str:
    expires = int((time.time() if now is None else now) + LINK_LIFETIME)
    body = f"{farmer_id}|{period_start.isoformat()}|{expires}".encode()
    sig = hmac.new(_link_key(), body, hashlib.sha256).digest()[:18]
    return f"{_b64(body)}.{_b64(sig)}"


def read_token(token: str) -> tuple[str, date]:
    gone = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This statement link has expired. Open it again from the app.")
    try:
        body_b64, sig_b64 = token.split(".", 1)
        body = _unb64(body_b64)
        if not hmac.compare_digest(hmac.new(_link_key(), body, hashlib.sha256).digest()[:18], _unb64(sig_b64)):
            raise gone
        farmer_id, start, expires = body.decode().split("|")
        if int(expires) < time.time():
            raise gone
        return farmer_id, date.fromisoformat(start)
    except HTTPException:
        raise
    except Exception:
        raise gone


def statement_link(db: Session, farmer_id, period_start: str) -> dict:
    try:
        start = date.fromisoformat(period_start)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad week.")
    has_week = (
        db.query(LedgerEntry.id).filter(LedgerEntry.farmer_id == farmer_id, LedgerEntry.pay_period_start == start).first()
        or db.query(Payout.id).filter(Payout.farmer_id == farmer_id, Payout.pay_period_start == start).first()
    )
    if not has_week:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nothing in that week yet.")
    return {"path": f"/statements/{statement_token(farmer_id, start)}", "expires_in": LINK_LIFETIME}


def weekly_statement(db: Session, farmer_id: str, period_start: date) -> dict:
    farm = db.get(FarmerProfile, farmer_id)
    entries = (
        db.query(LedgerEntry)
        .filter(LedgerEntry.farmer_id == farmer_id, LedgerEntry.pay_period_start == period_start)
        .order_by(LedgerEntry.created_at)
        .all()
    )
    payout = db.query(Payout).filter(Payout.farmer_id == farmer_id, Payout.pay_period_start == period_start).first()
    if not entries and payout is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nothing in that week.")
    period_end = payout.pay_period_end if payout else entries[0].pay_period_end
    context = _orders_context(db, {e.store_order_id for e in entries})

    rows = []
    for e in entries:
        ctx = context.get(e.store_order_id)
        so = ctx["so"] if ctx else None
        # A refund's amount (and any delivery fee given back) stays in the
        # sales column: it's what came off the farm's sales.
        delivery = _money(so.delivery_fee) if so and e.entry_type == "order" and _money(e.gross_amount) > 0 else 0.0
        row = _entry_row(e, ctx)
        rows.append(
            {
                "date": _aware(e.created_at).astimezone(LOCAL_TZ).strftime("%Y-%m-%d"),
                "order_ref": order_ref(e.store_order_id),
                "customer": ctx["customer"] if ctx else "",
                "type": {"sale": "Sale", "refund": "Refund", "charge": "Cancellation charge"}[row["kind"]],
                "detail": row["detail"],
                "payment": _payment_word(ctx) if ctx else "",
                "sales": round(_money(e.gross_amount) - delivery, 2),
                "delivery_fee": delivery,
                "commission": _minus(e.commission_amount),
                "cash_collected": _minus(e.cash_collected),
                "charges": _minus(e.fee_amount),
                "net": _money(e.net_amount),
                "tax": _money(so.tax) if so is not None and e.entry_type == "order" else 0.0,
            }
        )

    def total(key, kind=None):
        return round(sum(r[key] for r in rows if kind is None or r["type"] == kind), 2)

    carried_in = _money(payout.carried_in_total) if payout else 0.0
    # The summary shows refunds on their own line (fix list 30): sales and
    # commission come from the sales alone, and "Refunds (your share)" is what
    # refunds took off the farm's sales less the commission given back. The
    # spreadsheet's Totals row stays the plain sum of each column.
    return {
        "farm_name": farm.farm_name if farm else "",
        "farm_address": ", ".join(
            p for p in [farm.address_street, farm.address_city, " ".join(x for x in [farm.address_state, farm.address_zip] if x)] if p
        )
        if farm
        else "",
        "period_start": period_start,
        "period_end": period_end,
        "period_label": _period_label(period_start, period_end),
        "payout": _payout_state(payout),
        "rows": rows,
        "totals": {
            "sales": total("sales", "Sale"),
            "delivery_fee": total("delivery_fee"),
            "commission": total("commission", "Sale"),
            "refunds": round(total("sales", "Refund") + total("delivery_fee", "Refund") + total("commission", "Refund"), 2),
            "cash_collected": total("cash_collected"),
            "charges": total("charges"),
            "tax": total("tax"),
            "carried_in": carried_in,
            "net": round(total("net") + carried_in, 2),
            "columns": {k: total(k) for k in ("sales", "delivery_fee", "commission", "cash_collected", "charges", "net", "tax")},
        },
        "generated_at": datetime.now(LOCAL_TZ).strftime("%b %d, %Y %I:%M %p").replace(" 0", " "),
    }


_CSV_COLUMNS = [
    ("date", "Date"),
    ("order_ref", "Order"),
    ("customer", "Customer"),
    ("type", "Type"),
    ("detail", "Detail"),
    ("payment", "Paid by"),
    ("sales", "Sales after promo"),
    ("delivery_fee", "Delivery fee"),
    ("commission", "Commission"),
    ("cash_collected", "Cash you collected"),
    ("charges", "Charges"),
    ("net", "Net"),
    ("tax", "Sales tax (collected by HarvestHub)"),
]


def statement_csv(s: dict) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow([f"HarvestHub statement · {s['farm_name']} · {s['period_label']}"])
    w.writerow([])
    w.writerow([label for _, label in _CSV_COLUMNS])
    for r in s["rows"]:
        w.writerow([f"{r[k]:.2f}" if isinstance(r[k], float) else r[k] for k, _ in _CSV_COLUMNS])
    t = s["totals"]
    c = t["columns"]
    w.writerow([])
    w.writerow(["Totals", "", "", "", "", "", f"{c['sales']:.2f}", f"{c['delivery_fee']:.2f}", f"{c['commission']:.2f}",
                f"{c['cash_collected']:.2f}", f"{c['charges']:.2f}", f"{c['net']:.2f}", f"{c['tax']:.2f}"])
    if t["carried_in"]:
        w.writerow(["Owed from earlier weeks", "", "", "", "", "", "", "", "", "", "", f"{t['carried_in']:.2f}"])
    w.writerow(["Payout for the week", "", "", "", "", "", "", "", "", "", "", f"{t['net']:.2f}"])
    w.writerow(["Status", s["payout"]["label"]])
    return out.getvalue()


def _m(amount: float) -> str:
    return f"−${abs(amount):,.2f}" if amount < 0 else f"${amount:,.2f}"


def statement_html(s: dict, token: str) -> str:
    e = html.escape
    t = s["totals"]
    rows_html = "".join(
        "<tr>"
        f"<td>{e(r['date'][5:].replace('-', '/'))}</td>"
        f"<td><b>{e(r['type'])}</b> · {e(r['customer'])}<div class='sub'>#{e(r['order_ref'])} · {e(r['detail'])}</div></td>"
        f"<td class='num'>{_m(r['net'])}</td>"
        "</tr>"
        for r in s["rows"]
    ) or "<tr><td colspan='3' class='sub'>No sales, refunds or charges this week.</td></tr>"

    summary = [("Sales, after your promos", t["sales"])]
    if t["delivery_fee"]:
        summary.append(("Delivery fees (yours to keep)", t["delivery_fee"]))
    summary.append(("HarvestHub commission", t["commission"]))
    if t["refunds"]:
        summary.append(("Refunds (your share)", t["refunds"]))
    if t["cash_collected"]:
        summary.append(("Cash you collected at pickup", t["cash_collected"]))
    if t["charges"]:
        summary.append(("Cancellation charges", t["charges"]))
    if t["carried_in"]:
        summary.append(("Owed from earlier weeks", t["carried_in"]))
    summary_html = "".join(f"<tr><td>{e(label)}</td><td class='num'>{_m(v)}</td></tr>" for label, v in summary)
    net_label = "You owe" if t["net"] < 0 else "Your payout"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statement {e(s['period_label'])} · HarvestHub</title>
<style>
  :root {{ --bg:#F6F2E7; --text:#23291F; --muted:#767C6A; --primary:#2F4F3B; --border:#E7E2D3; --tint:#EAF2EC; --danger:#A33B2B; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }}
  main {{ max-width:760px; margin:0 auto; padding:24px 16px 48px; }}
  .brand {{ font-weight:700; color:var(--primary); }}
  h1 {{ font-family:Georgia,"Times New Roman",serif; font-weight:600; font-size:28px; margin:8px 0 2px; }}
  .meta, .sub {{ color:var(--muted); font-size:13px; }}
  .card {{ background:var(--tint); border-radius:16px; padding:14px 16px; margin:16px 0; }}
  table {{ width:100%; border-collapse:collapse; }}
  td {{ padding:8px 4px; border-bottom:1px solid var(--border); vertical-align:top; }}
  .card td {{ border-bottom:none; padding:3px 0; }}
  .num {{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }}
  .total td {{ font-weight:700; border-top:1px solid var(--border); padding-top:8px; }}
  .neg {{ color:var(--danger); }}
  h2 {{ font-family:Georgia,"Times New Roman",serif; font-weight:600; font-size:19px; margin:24px 0 6px; }}
  .actions {{ display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; }}
  .btn {{ display:inline-block; border-radius:999px; padding:9px 16px; font-weight:700; font-size:14px; text-decoration:none; border:1px solid var(--primary); color:var(--primary); background:transparent; cursor:pointer; }}
  .btn.primary {{ background:var(--primary); color:#fff; }}
  .notes p {{ margin:6px 0; }}
  @media print {{ body {{ background:#fff; }} .actions {{ display:none; }} .card {{ border:1px solid var(--border); }} }}
</style></head>
<body><main>
  <div class="brand">HarvestHub</div>
  <h1>Weekly statement</h1>
  <div class="meta">{e(s['farm_name'])}{(' · ' + e(s['farm_address'])) if s['farm_address'] else ''}</div>
  <div class="meta">Week of {e(s['period_label'])} (Saturday to Friday) · {e(s['payout']['label'])}</div>
  <div class="actions">
    <button class="btn primary" onclick="window.print()">Print or save as PDF</button>
    <a class="btn" href="/statements/{e(token)}/csv">Download spreadsheet (CSV)</a>
  </div>
  <div class="card"><table>
    {summary_html}
    <tr class="total"><td>{net_label}</td><td class="num{' neg' if t['net'] < 0 else ''}">{_m(abs(t['net']))}</td></tr>
  </table></div>
  <h2>Every sale, refund and charge</h2>
  <table>{rows_html}</table>
  <div class="notes sub">
    <p>Sales tax on these orders: {_m(t['tax'])}. HarvestHub collects it; it isn't part of your sales or your payout.{' For cash orders you collected it at pickup, so it is part of what you owe.' if t['cash_collected'] else ''}</p>
    <p>The commission is HarvestHub's share of your sales after your promo discounts. Delivery fees aren't charged commission.</p>{'''
    <p>Refunds (your share): what refunds took off your sales, less the commission HarvestHub gave back on them.</p>''' if t['refunds'] else ''}
    <p>Made {e(s['generated_at'])}. Questions: {e(settings.SUPPORT_EMAIL)}</p>
  </div>
</main></body></html>"""
