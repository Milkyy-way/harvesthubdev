"""What each notification says, per channel. One function per kind; each
takes the context dict its caller passes to notify() and returns a Message.

Which channels a kind uses is decided here (Message.channels); the user's
own settings can then turn push/email/SMS off. Text messages are kept to the
time-sensitive order updates — they cost money per message.
"""
import html
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from app.core.localtime import LOCAL_TZ  # dates are shown in US Eastern

PUSH, EMAIL, SMS = "push", "email", "sms"


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
    local = value.astimezone(LOCAL_TZ)
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
        "We'll let you know as soon as each farm has your order ready.",
    ]
    for so in order["store_orders"]:
        if so["fulfillment_method"] == "delivery" and so.get("delivery"):
            paragraphs.append(
                f"Delivery from {so['farm_name']}: {so['delivery']['window_label']}, to "
                f"{so['delivery_address_street']}. We'll tell you when it's on the way."
            )
            continue
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


def out_for_delivery(ctx: dict) -> Message:
    """ctx: farm_name, order_id, stops_before (deliveries ahead of this one)."""
    farm, ahead = ctx["farm_name"], ctx.get("stops_before") or 0
    ahead_text = f"{ahead} stop{'s' if ahead != 1 else ''} before yours"
    return Message(
        title="Your order is on the way",
        body=f"{farm} is out delivering — {ahead_text}.",
        channels=(PUSH, SMS),
        url=f"/(customer)/orders/{ctx['order_id']}",
        sms=_sms(f"{farm} is out delivering your order — {ahead_text}."),
    )


def delivery_next(ctx: dict) -> Message:
    """ctx: farm_name, order_id, to_pod."""
    farm = ctx["farm_name"]
    where = "your pod's drop point" if ctx.get("to_pod") else "you"
    return Message(
        title="You're next!",
        body=f"{farm} is heading to {where} now.",
        channels=(PUSH, SMS),
        url=f"/(customer)/orders/{ctx['order_id']}",
        sms=_sms(f"You're next! {farm} is heading to {where} now with your order."),
    )


def delivered(ctx: dict) -> Message:
    """ctx: farm_name, order_id, has_photo, note; for a pod order also
    to_pod, drop_address and cold_hours (None without cold items)."""
    farm = ctx["farm_name"]
    photo = " There's a photo of where it was left in the app." if ctx.get("has_photo") else ""
    note = f" Note from the farm: {ctx['note']}" if ctx.get("note") else ""
    place = ""
    if ctx.get("to_pod"):
        address = f" at {ctx['drop_address']}" if ctx.get("drop_address") else ""
        place = f" It's at your pod's drop point{address}."
        if ctx.get("cold_hours"):
            place += f" It has cold items, so please collect it within {ctx['cold_hours']} hours."
    return Message(
        title="Your order was delivered",
        body=f"{farm} delivered your order.{place or photo}",
        channels=(PUSH, EMAIL),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"{farm} delivered your order.{place}{photo}{note}",
            "Something not right? Open the order in the app to let us know.",
        ],
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
            *(
                ["Neighborhood Pods are for Harvest Pass members, so without it you'll leave your pod at the end of that delivery cycle."]
                if ctx.get("in_pod")
                else []
            ),
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


# --- Neighborhood Pods -------------------------------------------------------------


def _pod_url(ctx: dict) -> str:
    return f"/(customer)/pods/{ctx['pod_id']}"


def _members_text(count: int) -> str:
    return f"{count} member" if count == 1 else f"{count} members"


def pod_active(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, delivery_day."""
    return Message(
        title="Your pod is live!",
        body=f"{ctx['pod_name']} is active. Order for {ctx['delivery_day']} and collect at your drop point.",
        channels=(PUSH, EMAIL),
        url=_pod_url(ctx),
        email_paragraphs=[
            f"{ctx['pod_name']} has enough neighbors and is now active.",
            f"Your delivery day is {ctx['delivery_day']}. When you check out, choose your pod for delivery. Each farm's "
            "delivery fee is split evenly among the members who order, and your card is charged once, when that "
            "farm's orders close.",
        ],
    )


def pod_member_joined(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, first_name, needed (more needed to go live)."""
    more = f" {ctx['needed']} more to go live." if ctx.get("needed") else ""
    return Message(
        title="A neighbor joined your pod",
        body=f"{ctx['first_name']} joined {ctx['pod_name']}.{more}",
        channels=(PUSH,),
        url=_pod_url(ctx),
    )


def pod_invite_declined(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, label."""
    who = ctx.get("label") or "A neighbor"
    return Message(
        title="Pod invite declined",
        body=f"{who} said no to joining {ctx['pod_name']}.",
        channels=(PUSH,),
        url=_pod_url(ctx),
    )


def _when(value) -> str:
    local = value.astimezone(LOCAL_TZ)
    hour = local.hour % 12 or 12
    minute = f":{local.minute:02d}" if local.minute else ""
    return f"{local:%b} {local.day} at {hour}{minute} {'AM' if local.hour < 12 else 'PM'}"


def pod_order_scheduled(ctx: dict) -> Message:
    """ctx: farm_name, order_id, charge_at."""
    when = _when(ctx["charge_at"])
    return Message(
        title="Your pod order is in",
        body=f"Nothing charged yet. Orders from {ctx['farm_name']} close {when}, then your card is charged once.",
        channels=(PUSH, EMAIL),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"Your order from {ctx['farm_name']} is in, and nothing has been charged yet.",
            f"Orders close on {when}. Then the delivery fee is split evenly among the members who ordered, and your "
            "saved card is charged once for your exact total. You can cancel for free until then.",
        ],
    )


def pod_order_reminder(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, farm_name, ordered, total, share, cutoff, has_ordered."""
    state = f"{ctx['ordered']} of {ctx['total']} members have ordered from {ctx['farm_name']}, so delivery is {_money(ctx['share'])} each right now."
    when = _when(ctx["cutoff"])
    ask = f"You can cancel until {when}." if ctx.get("has_ordered") else f"Order by {when} to join in and bring it down."
    return Message(
        title=f"{ctx['pod_name']}: orders close soon",
        body=f"{state} {ask}",
        channels=(PUSH,),
        url=_pod_url(ctx),
    )


def pod_charge_failed(ctx: dict) -> Message:
    """ctx: farm_name, order_id, amount."""
    return Message(
        title="Your card was declined",
        body=f"We couldn't charge {_money(ctx['amount'])} for your {ctx['farm_name']} order. Update your card to keep it.",
        channels=(PUSH, EMAIL, SMS),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"We couldn't charge {_money(ctx['amount'])} to your card for your pod order from {ctx['farm_name']}.",
            "We'll try once more soon. To keep your order, open it in the app and use a different card.",
        ],
        sms=_sms(f"Your card was declined for your {ctx['farm_name']} pod order. Open the app to update it and keep your order."),
    )


def pod_charge_cancelled(ctx: dict) -> Message:
    """ctx: farm_name, order_id."""
    return Message(
        title="Your pod order was cancelled",
        body=f"We couldn't charge your card, so your {ctx['farm_name']} order was cancelled. You haven't been charged.",
        channels=(PUSH, EMAIL),
        url=f"/(customer)/orders/{ctx['order_id']}",
        email_paragraphs=[
            f"We couldn't charge your card, so your pod order from {ctx['farm_name']} was cancelled. You haven't been charged.",
        ],
    )


def pod_paused(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, grace_ends_at, needs_drop_point."""
    when = _date(ctx["grace_ends_at"])
    why = "It needs a new drop point." if ctx.get("needs_drop_point") else "It needs more neighbors to reach the minimum."
    return Message(
        title="Your pod is paused",
        body=f"{ctx['pod_name']} can't take new orders. {why} It ends {when} otherwise.",
        channels=(PUSH, EMAIL),
        url=_pod_url(ctx),
        email_paragraphs=[
            f"{ctx['pod_name']} is paused, so it can't take new orders. Orders already placed will still be delivered.",
            f"{why} If that doesn't happen by {when}, the pod will end.",
        ],
    )


def pod_resumed(ctx: dict) -> Message:
    """ctx: pod_id, pod_name."""
    return Message(
        title="Your pod is back",
        body=f"{ctx['pod_name']} is active again. You can order for your delivery day.",
        channels=(PUSH,),
        url=_pod_url(ctx),
    )


def pod_ended(ctx: dict) -> Message:
    """ctx: pod_name, reason: 'expired' | 'dissolved'."""
    if ctx.get("reason") == "expired":
        line = f"{ctx['pod_name']} didn't reach enough neighbors in time, so it has ended."
    else:
        line = f"{ctx['pod_name']} has ended."
    return Message(
        title="Your pod has ended",
        body=line,
        channels=(PUSH, EMAIL),
        url="/(customer)/pods",
        email_paragraphs=[line, "Orders already placed will still be delivered. You can start or join another pod in the app."],
    )


def pod_member_leaving(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, count (members after the departure)."""
    return Message(
        title="Your pod is changing",
        body=f"{ctx['pod_name']} will have {_members_text(ctx['count'])} after the current delivery cycle.",
        channels=(PUSH,),
        url=_pod_url(ctx),
    )


def pod_membership_lapsing(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, leave_at."""
    when = _date(ctx["leave_at"])
    return Message(
        title="You're leaving your pod soon",
        body=f"Pods are for Harvest Pass members. Join by {when} to stay in {ctx['pod_name']}.",
        channels=(PUSH, EMAIL),
        url="/(customer)/harvest-pass",
        email_paragraphs=[
            f"Neighborhood Pods are for Harvest Pass members, and your Harvest Pass has ended. You'll leave {ctx['pod_name']} on {when}.",
            "Join Harvest Pass in the app (Account → Harvest Pass) before then to stay.",
        ],
    )


def pod_removed(ctx: dict) -> Message:
    """ctx: pod_name."""
    return Message(
        title="You've been removed from a pod",
        body=f"The host removed you from {ctx['pod_name']}. Any order you already placed will still be delivered.",
        channels=(PUSH, EMAIL),
        url="/(customer)/pods",
        email_paragraphs=[
            f"The host of {ctx['pod_name']} removed you from the pod. Any order you already placed will still be delivered.",
        ],
    )


def pod_new_host(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, you (bool), first_name, needs_drop_point."""
    if ctx.get("you"):
        ask = " Please choose a new drop point." if ctx.get("needs_drop_point") else ""
        body = f"You're now the host of {ctx['pod_name']}.{ask}"
    else:
        body = f"{ctx['first_name']} is now the host of {ctx['pod_name']}."
    return Message(title="Your pod has a new host", body=body, channels=(PUSH, EMAIL), url=_pod_url(ctx), email_paragraphs=[body])


def pod_drop_changed(ctx: dict) -> Message:
    """ctx: pod_id, pod_name, address_line, reapprove_by."""
    when = _date(ctx["reapprove_by"])
    return Message(
        title="Please approve your pod's new drop point",
        body=f"{ctx['pod_name']} is moving to {ctx['address_line']}. Approve it by {when} to stay in the pod.",
        channels=(PUSH, EMAIL),
        url=_pod_url(ctx),
        email_paragraphs=[
            f"The host of {ctx['pod_name']} changed the drop point to {ctx['address_line']}.",
            f"Open the pod in the app to approve it by {when}. If you don't, you'll leave the pod at the end of the delivery "
            "cycle. Any order of yours that hasn't left the farm now goes to the new drop point. You can cancel it in the "
            "app until the farm sets off.",
        ],
    )


# --- Farmers -------------------------------------------------------------------------


def new_order(ctx: dict) -> Message:
    """ctx: item_count, total, cash (bool), delivery_label (delivery orders)."""
    summary = f"{_items(ctx['item_count'])} · {_money(ctx['total'])}"
    paid = " (cash at pickup)" if ctx.get("cash") else ""
    if ctx.get("delivery_label"):
        paid = f" · deliver {ctx['delivery_label']}"
    return Message(
        title="New order",
        body=f"{summary}{paid}. Pack it and mark it ready in the app.",
        channels=(PUSH, EMAIL, SMS),
        url="/(farmer)/(tabs)/orders",
        email_paragraphs=[
            f"You have a new order: {summary}{paid}.",
            (
                "It joins that window's delivery run — you'll find it under Deliveries in the app."
                if ctx.get("delivery_label")
                else "Open the HarvestHub app to see the items and the customer's details, then tap “Mark ready” "
                "once it's packed so they know to come by."
            ),
        ],
        sms=_sms(f"New order — {summary}{paid}. Open the app to pack it."),
    )


def pod_drop_moved(ctx: dict) -> Message:
    """ctx: pod_name, address_line."""
    return Message(
        title="A pod's drop point moved",
        body=f"{ctx['pod_name']} moved to {ctx['address_line']}. Your orders for it now go there.",
        channels=(PUSH, EMAIL),
        url="/(farmer)/deliveries",
        email_paragraphs=[
            f"{ctx['pod_name']} changed its drop point to {ctx['address_line']}. Your orders for that pod now go there. "
            "It's within your delivery distance. You'll find the new address on the delivery run.",
        ],
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
    "out_for_delivery": out_for_delivery,
    "delivery_next": delivery_next,
    "delivered": delivered,
    "pod_active": pod_active,
    "pod_member_joined": pod_member_joined,
    "pod_invite_declined": pod_invite_declined,
    "pod_paused": pod_paused,
    "pod_resumed": pod_resumed,
    "pod_ended": pod_ended,
    "pod_member_leaving": pod_member_leaving,
    "pod_membership_lapsing": pod_membership_lapsing,
    "pod_removed": pod_removed,
    "pod_new_host": pod_new_host,
    "pod_drop_changed": pod_drop_changed,
    "pod_drop_moved": pod_drop_moved,
    "pod_order_scheduled": pod_order_scheduled,
    "pod_order_reminder": pod_order_reminder,
    "pod_charge_failed": pod_charge_failed,
    "pod_charge_cancelled": pod_charge_cancelled,
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
