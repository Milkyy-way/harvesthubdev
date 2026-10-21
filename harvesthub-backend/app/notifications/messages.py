"""What each notification says, per channel. One function per kind; each
takes the context dict its caller passes to notify() and returns a Message.

Which channels a kind uses is decided here (Message.channels); the user's
own settings can then turn push/email/SMS off. Text messages are kept to the
time-sensitive order updates — they cost money per message.
"""
import html
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

PUSH, EMAIL, SMS = "push", "email", "sms"

# Dates in messages are shown in US Eastern (the DC/MD/VA launch market).
# A fixed offset, not zoneinfo — a date-only label doesn't need DST, and the
# server image has no time zone database.
_EASTERN = timezone(timedelta(hours=-5))


@dataclass
class Message:
    title: str  # push title and email subject
    body: str  # push body — one or two short sentences
    channels: tuple[str, ...]
    url: str | None = None  # app screen a tap on the push opens
    email_paragraphs: list[str] = field(default_factory=list)  # plain text, escaped when rendered
    email_rows: list[tuple[str, str]] = field(default_factory=list)  # label/value table, e.g. a receipt
    sms: str | None = None


def _money(amount) -> str:
    return f"${float(amount or 0):,.2f}"


def _date(value: datetime | date | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if not isinstance(value, datetime):  # a plain date, e.g. a pay period
        return f"{value:%b} {value.day}"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    local = value.astimezone(_EASTERN)
    return f"{local:%b} {local.day}"


def _items(count: int) -> str:
    return f"{count} item" if count == 1 else f"{count} items"


def _sms(text: str) -> str:
    return f"HarvestHub: {text} Reply STOP to opt out."


# --- Customers ---------------------------------------------------------------------


def order_placed(ctx: dict) -> Message:
    """ctx: the order as build_order_out() returns it."""
    order = ctx["order"]
    rows: list[tuple[str, str]] = []
    for so in order["store_orders"]:
        rows.append((so["farm_name"], ""))
        for item in so["items"]:
            rows.append((f"  {item['quantity']} × {item['product_name']}", _money(item["line_total"])))
        if so["promo_discount"]:
            rows.append(("  Promo", f"−{_money(so['promo_discount'])}"))
        if so["service_fee"]:
            rows.append(("  Service fee", _money(so["service_fee"])))
        if so["delivery_fee"]:
            rows.append(("  Delivery", _money(so["delivery_fee"])))
        if so["tax"]:
            rows.append(("  Tax", _money(so["tax"])))
    rows.append(("Total", _money(order["grand_total"])))

    cash = (order.get("payment") or {}).get("payment_method") == "cash_on_pickup"
    paragraphs = [
        "Thanks for your order! Here's your receipt.",
        "Pay in cash when you pick up." if cash else "Paid by card.",
        "We'll let you know as soon as each farm has your order ready for pickup.",
    ]
    for so in order["store_orders"]:
        address = ", ".join(
            p for p in (so["pickup_address_street"], so["pickup_address_city"], so["pickup_address_state"]) if p
        )
        if address:
            paragraphs.append(f"Pickup at {so['farm_name']}: {address}")
    return Message(
        title="Your HarvestHub order",
        body="Thanks for your order! Your receipt is in your email.",
        channels=(EMAIL,),
        url=f"/(customer)/orders/{order['id']}",
        email_paragraphs=paragraphs,
        email_rows=rows,
    )


def order_ready(ctx: dict) -> Message:
    """ctx: farm_name, order_id, pickup_address, cash_total (None for card)."""
    farm = ctx["farm_name"]
    cash = ctx.get("cash_total")
    pay = f" Bring {_money(cash)} in cash." if cash else ""
    where = f" at {ctx['pickup_address']}" if ctx.get("pickup_address") else ""
    return Message(
        title="Your order is ready for pickup",
        body=f"{farm} has your order ready.{pay}",
        channels=(PUSH, EMAIL, SMS),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"Good news — {farm} has your order packed and ready for pickup{where}.",
            *([f"Please bring {_money(cash)} in cash."] if cash else []),
            "Once you have it, tap “Mark as received” on the order in the app.",
        ],
        sms=_sms(f"Your order from {farm} is ready for pickup{where}.{pay}"),
    )


def order_cancelled_by_farm(ctx: dict) -> Message:
    """ctx: farm_name, order_id, reason, refund_amount (0 for cash/unpaid)."""
    farm = ctx["farm_name"]
    refund = ctx.get("refund_amount") or 0
    refund_line = f"We've refunded {_money(refund)} to your card." if refund else "You haven't been charged for it."
    return Message(
        title="A farm cancelled your order",
        body=f"{farm} can't fill your order. {refund_line}",
        channels=(PUSH, EMAIL, SMS),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"Sorry — {farm} had to cancel your order.",
            *([f"Their reason: {ctx['reason']}"] if ctx.get("reason") else []),
            refund_line + (" It can take 5–10 business days to appear." if refund else ""),
        ],
        sms=_sms(f"{farm} cancelled your order. {refund_line}"),
    )


def free_period_ending(ctx: dict) -> Message:
    """ctx: ends_at, joined (bool), first_charge (amount, when joined)."""
    when = _date(ctx["ends_at"])
    if ctx.get("joined"):
        return Message(
            title="Your Harvest Pass continues soon",
            body=f"Your free month ends {when}. Your plan starts then — {_money(ctx.get('first_charge'))}.",
            channels=(PUSH, EMAIL),
            url="/(customer)/harvest-pass",
            email_paragraphs=[
                f"Your free month of Harvest Pass ends on {when}.",
                f"You've already chosen a plan, so it simply continues: {_money(ctx.get('first_charge'))} "
                f"will be charged to your card on {when}.",
                "Changed your mind? Cancel any time before then in the app (Account → Harvest Pass) and you won't be charged.",
            ],
        )
    return Message(
        title="Your free Harvest Pass ends soon",
        body=f"Your free month ends {when}. Join to keep skipping service fees.",
        channels=(PUSH, EMAIL),
        url="/(customer)/harvest-pass",
        email_paragraphs=[
            f"Your free month of Harvest Pass ends on {when}.",
            "To keep skipping the service fee on your orders, join Harvest Pass in the app (Account → Harvest Pass) "
            "before then. Nothing is charged until your free month is over.",
        ],
    )


def free_period_ended(ctx: dict) -> Message:
    return Message(
        title="Your free Harvest Pass has ended",
        body="Join Harvest Pass to keep skipping service fees.",
        channels=(PUSH, EMAIL),
        url="/(customer)/harvest-pass",
        email_paragraphs=[
            "Your free month of Harvest Pass is over — we hope you enjoyed it.",
            "You can join any time in the app (Account → Harvest Pass) to keep skipping the service fee on your orders.",
        ],
    )


def membership_payment_failed(ctx: dict) -> Message:
    """ctx: amount."""
    return Message(
        title="Harvest Pass payment didn't go through",
        body="Please update your card to keep your Harvest Pass benefits.",
        channels=(PUSH, EMAIL),
        url="/(customer)/harvest-pass",
        email_paragraphs=[
            f"We couldn't charge {_money(ctx.get('amount'))} for your Harvest Pass.",
            "We'll try again over the next few days. To keep your benefits, update your card in the app "
            "(Account → Harvest Pass → Update card).",
        ],
    )


# --- Farmers -------------------------------------------------------------------------


def new_order(ctx: dict) -> Message:
    """ctx: item_count, total, cash (bool)."""
    summary = f"{_items(ctx['item_count'])} · {_money(ctx['total'])}"
    paid = " (cash at pickup)" if ctx.get("cash") else ""
    return Message(
        title="New order",
        body=f"{summary}{paid}. Pack it and mark it ready in the app.",
        channels=(PUSH, EMAIL, SMS),
        url="/(farmer)/(tabs)/orders",
        email_paragraphs=[
            f"You have a new order: {summary}{paid}.",
            "Open the HarvestHub app to see the items and the customer's details, then tap “Mark ready” "
            "once it's packed so they know to come by.",
        ],
        sms=_sms(f"New order — {summary}{paid}. Open the app to pack it."),
    )


def order_cancelled_by_customer(ctx: dict) -> Message:
    """ctx: item_count, total."""
    summary = f"{_items(ctx['item_count'])} · {_money(ctx['total'])}"
    return Message(
        title="An order was cancelled",
        body=f"The customer cancelled an order ({summary}). No need to pack it.",
        channels=(PUSH, EMAIL),
        url="/(farmer)/(tabs)/orders",
        email_paragraphs=[
            f"A customer cancelled their order ({summary}), so there's no need to pack it.",
            "Any stock it had reserved has been put back on your products.",
        ],
    )


def farmer_approved(ctx: dict) -> Message:
    return Message(
        title="You're approved!",
        body="Your farm is live on HarvestHub. Add your products to start selling.",
        channels=(PUSH, EMAIL),
        url="/(farmer)/(tabs)",
        email_paragraphs=[
            f"Welcome aboard — {ctx.get('farm_name') or 'your farm'} is approved and live on HarvestHub.",
            "Open the app and add your products so nearby customers can start ordering.",
        ],
    )


def farmer_rejected(ctx: dict) -> Message:
    """ctx: farm_name, reviewer_notes."""
    return Message(
        title="Update on your HarvestHub application",
        body="We couldn't approve your application yet. Open the app to see why.",
        channels=(PUSH, EMAIL),
        url="/(farmer)/(tabs)",
        email_paragraphs=[
            "Thanks for applying to sell on HarvestHub. We couldn't approve your application as it is.",
            *([f"Our reviewer's notes: {ctx['reviewer_notes']}"] if ctx.get("reviewer_notes") else []),
            "You can update your application and send it again from the app.",
        ],
    )


def payout_sent(ctx: dict) -> Message:
    """ctx: amount, period_start, period_end."""
    period = f"{_date(ctx['period_start'])} – {_date(ctx['period_end'])}"
    return Message(
        title="Payout sent",
        body=f"{_money(ctx['amount'])} for {period} is on its way to your bank.",
        channels=(PUSH, EMAIL),
        url="/(farmer)/earnings",
        email_paragraphs=[
            f"We've sent your payout of {_money(ctx['amount'])} for {period} to your bank account.",
            "Bank transfers usually arrive within 1–3 business days. You can see the details under Earnings in the app.",
        ],
    )


BUILDERS = {
    "order_placed": order_placed,
    "order_ready": order_ready,
    "order_cancelled_by_farm": order_cancelled_by_farm,
    "free_period_ending": free_period_ending,
    "free_period_ended": free_period_ended,
    "membership_payment_failed": membership_payment_failed,
    "new_order": new_order,
    "order_cancelled_by_customer": order_cancelled_by_customer,
    "farmer_approved": farmer_approved,
    "farmer_rejected": farmer_rejected,
    "payout_sent": payout_sent,
}


# --- Email rendering -------------------------------------------------------------------


def render_email(message: Message, first_name: str | None) -> tuple[str, str]:
    """(html, plain text) — a simple layout in the app's colors that reads
    fine in any mail client, images off."""
    greeting = f"Hi {first_name}," if first_name else "Hi,"
    text_lines = [greeting, ""]
    for p in message.email_paragraphs:
        text_lines += [p, ""]
    for label, value in message.email_rows:
        text_lines.append(f"{label}  {value}".rstrip())
    footer = (
        "You're getting this because you have a HarvestHub account. "
        "Choose which emails you get in the app's notification settings."
    )
    text_lines += ["", footer]

    def esc(value: str) -> str:
        return html.escape(value, quote=True)

    paragraphs_html = "".join(
        f'<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#23291F;">{esc(p)}</p>'
        for p in message.email_paragraphs
    )
    rows_html = ""
    if message.email_rows:
        cells = []
        for label, value in message.email_rows:
            heading = not value and not label.startswith(" ")
            weight = "700" if heading or label == "Total" else "400"
            top = "border-top:1px solid #E7E2D3;" if label == "Total" else ""
            cells.append(
                f'<tr><td style="padding:4px 0;font-size:14px;font-weight:{weight};color:#23291F;{top}">'
                f"{esc(label.strip())}</td>"
                f'<td style="padding:4px 0;font-size:14px;font-weight:{weight};color:#23291F;text-align:right;{top}">'
                f"{esc(value)}</td></tr>"
            )
        rows_html = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;">'
            + "".join(cells)
            + "</table>"
        )
    body_html = f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#F6F2E7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F2E7;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding-bottom:18px;font-size:20px;font-weight:800;color:#2F4F3B;">HarvestHub</td></tr>
<tr><td style="padding-bottom:12px;font-family:Georgia,serif;font-size:24px;line-height:30px;color:#1E3324;">{esc(message.title)}</td></tr>
<tr><td><p style="margin:0 0 14px;font-size:15px;color:#23291F;">{esc(greeting)}</p>{paragraphs_html}{rows_html}</td></tr>
<tr><td style="padding-top:18px;font-size:12px;line-height:18px;color:#767C6A;">{esc(footer)}</td></tr>
</table></td></tr></table></body></html>"""
    return body_html, "\n".join(text_lines)
