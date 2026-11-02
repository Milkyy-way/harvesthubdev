"""Group deals, the customer's side: seeing a deal, joining with a saved card,
withdrawing, and the regular-price offer if a deal misses. Nobody is charged
here: see closing.py for what happens at the deadline.

Joining has two steps. join() starts saving a card, and confirm_join() counts the
household once the card is saved. The rules are checked again then, under the
deal's row lock, because that's what makes the last share safe.
"""
import logging
import math
import uuid
from datetime import date, datetime, timedelta

import stripe
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.geo import KM_PER_MILE, MAX_BROWSE_MILES, haversine_km
from app.core.localtime import LOCAL_TZ
from app.core.pricing import MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL, SERVICE_FEE_RATE
from app.core.tax import compute_item_tax
from app.customers.models import CustomerProfile
from app.customers.places import browse_point
from app.deals import service
from app.deals.household import household_key
from app.deals.models import (
    ACTIVE,
    CLAIMED,
    LEFT,
    NOT_CHARGED,
    OFFERED,
    OPEN_STATUSES,
    ORDERED,
    PENDING_CARD,
    WAITING,
    WITHDRAWN,
    FarmFollow,
    GroupCommit,
    GroupDeal,
    GroupWaitlist,
)
from app.deals.schemas import DealJoinIn, DealQuoteIn
from app.delivery import service as delivery_service
from app.delivery.models import FarmDeliverySettings
from app.farmers.models import FarmerProfile
from app.membership import service as membership_service
from app.notifications.service import Notice, notify_many
from app.orders.models import StoreOrder
from app.payments import stripe_client
from app.pods.models import Pod, PodMember
from app.products.models import Product

logger = logging.getLogger(__name__)

WITHDRAW_LOCK = timedelta(hours=12)
JOIN_PURPOSE = "group_deal_join"
# Far enough for a pickup trip. A deal further away than this isn't listed.
MAX_LISTING_MILES = MAX_BROWSE_MILES
# A finished deal stays on the customer's list this long, so they can see how it went.
_RESULT_DAYS = 7
_MILESTONES = ((1.0, "goal"), (0.8, "80"), (0.5, "50"))


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def deal_or_404(db: Session, deal_id: str, lock: bool = False) -> GroupDeal:
    try:
        did = uuid.UUID(deal_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    query = db.query(GroupDeal).filter(GroupDeal.id == did, GroupDeal.status != "draft")
    deal = (query.with_for_update() if lock else query).first()
    if deal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    return deal


def _my_commit(db: Session, deal_id, customer_id) -> GroupCommit | None:
    """Their latest join on this deal, whatever became of it."""
    return (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal_id, GroupCommit.customer_id == customer_id)
        .order_by(GroupCommit.created_at.desc())
        .first()
    )


# --- What it costs -------------------------------------------------------------------------


def price_order(
    deal: GroupDeal, product: Product, farmer: FarmerProfile, units: int, delivery_fee: float, is_member: bool, unit_price=None
) -> dict:
    """The same sums as a regular checkout (app/checkout/service.py): the service
    fee, the Harvest Pass waiver at $25 of items, and tax by the farm's state."""
    per_unit = service.dec(deal.deal_price if unit_price is None else unit_price)
    share_price = service.money(per_unit * service.dec(deal.share_size))
    subtotal = float(service.money(share_price * units))
    full_service_fee = round(subtotal * SERVICE_FEE_RATE, 2)
    member_savings = full_service_fee if is_member and subtotal >= MEMBER_FREE_SERVICE_FEE_MIN_SUBTOTAL else 0.0
    service_fee = round(full_service_fee - member_savings, 2)
    tax = round(compute_item_tax(farmer.address_state, product.tax_category, subtotal), 2)
    return {
        "share_price": float(share_price),
        "subtotal": subtotal,
        "service_fee": service_fee,
        "member_savings": member_savings,
        "delivery_fee": round(float(delivery_fee), 2),
        "tax": tax,
        "total": round(subtotal + service_fee + round(float(delivery_fee), 2) + tax, 2),
    }


def _others_to_pod(db: Session, deal_id, pod_id, customer_id) -> int:
    return (
        db.query(GroupCommit.id)
        .filter(
            GroupCommit.deal_id == deal_id,
            GroupCommit.pod_id == pod_id,
            GroupCommit.customer_id != customer_id,
            GroupCommit.status == ACTIVE,
        )
        .count()
    )


def _pod_choices(db: Session, deal: GroupDeal, customer: CustomerProfile) -> tuple[list[dict], str | None]:
    """Their pods' drop points this deal can go to, and a note if they're in a
    pod it can't: the farm must deliver to pods, reach the drop point, and the
    pod's delivery day must be the deal's day."""
    day: date | None = deal.fulfillment_date
    memberships = delivery_service.pods_of(db, customer.id)
    if not day or not memberships:
        return [], None
    farmer = db.get(FarmerProfile, deal.farmer_id)
    s = db.get(FarmDeliverySettings, deal.farmer_id)
    windows = [w for w in delivery_service.windows_of(db, deal.farmer_id) if w.weekday == day.weekday()]
    choices = []
    for pod, member in memberships:
        if pod.delivery_weekday != day.weekday() or not delivery_service.farm_reaches_pod(farmer, s, pod):
            continue
        slots = []
        for w in windows:
            a = datetime.combine(day, w.start_time, tzinfo=LOCAL_TZ)
            b = datetime.combine(day, w.end_time, tzinfo=LOCAL_TZ)
            # Someone on their way out of the pod can only get what comes first.
            if member.leave_at is None or a < member.leave_at:
                slots.append({"starts_at": a.isoformat(), "ends_at": b.isoformat(), "label": delivery_service.window_label(a, b)})
        if slots:
            full_fee = round(float(s.pod_delivery_fee), 2)
            choices.append(
                {
                    "pod_id": str(pod.id),
                    "pod_name": pod.name,
                    "drop_address_line": delivery_service.pod_address_line(pod),
                    "full_fee": full_fee,
                    "share_now": delivery_service.pod_share(full_fee, _others_to_pod(db, deal.id, pod.id, customer.id) + 1),
                    "slots": sorted(slots, key=lambda slot: slot["starts_at"]),
                }
            )
    note = None
    if not choices:
        note = f"Your pod can't get this deal at its drop point: it would need this farm to deliver there on {day:%A}s."
    return choices, note


def _my_pod(db: Session, deal: GroupDeal, customer_id) -> dict | None:
    """"Your Pod: 5 households": whoever's in the deal and in their pod right now.
    Leaving a pod mid-deal keeps the join, and just stops counting here."""
    pods = (
        db.query(Pod)
        .join(PodMember, PodMember.pod_id == Pod.id)
        .filter(PodMember.customer_id == customer_id, PodMember.status == "active", Pod.status.in_(("active", "paused", "pending")))
        .all()
    )
    best = None
    for pod in pods:
        members = db.query(PodMember.customer_id).filter(PodMember.pod_id == pod.id, PodMember.status == "active")
        joined = (
            db.query(GroupCommit.id)
            .filter(
                GroupCommit.deal_id == deal.id,
                GroupCommit.status.in_((ACTIVE, ORDERED, NOT_CHARGED)),
                GroupCommit.customer_id.in_(members),
            )
            .count()
        )
        if joined and (best is None or joined > best["households"]):
            best = {"pod_id": str(pod.id), "pod_name": pod.name, "households": joined}
    return best


def _delivery_choice(db: Session, deal: GroupDeal, customer: CustomerProfile | None) -> dict:
    """Home delivery for this deal: only in the farm's windows on its delivery day."""
    farmer = db.get(FarmerProfile, deal.farmer_id)
    s = db.get(FarmDeliverySettings, deal.farmer_id)
    reason = delivery_service.unavailable_reason(farmer, s, customer)
    day: date | None = deal.fulfillment_date
    slots = []
    if not reason and day:
        for w in delivery_service.windows_of(db, deal.farmer_id):
            if w.weekday == day.weekday():
                a = datetime.combine(day, w.start_time, tzinfo=LOCAL_TZ)
                b = datetime.combine(day, w.end_time, tzinfo=LOCAL_TZ)
                slots.append({"starts_at": a.isoformat(), "ends_at": b.isoformat(), "label": delivery_service.window_label(a, b)})
        if not slots:
            reason = "This farm doesn't deliver on that day, so this deal is pickup only."
    return {
        "available": not reason,
        "reason": reason,
        "fee": round(float(s.delivery_fee), 2) if s else 0.0,
        "slots": sorted(slots, key=lambda slot: slot["starts_at"]),
        "address_line": delivery_service.address_line_of(customer) if customer else "",
    }


# --- Whether they can join ------------------------------------------------------------------


def _household_taken(db: Session, deal: GroupDeal, customer: CustomerProfile) -> str | None:
    key = household_key(customer.address_street, customer.address_unit, customer.address_zip)
    taken = (
        db.query(GroupCommit.customer_id)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.household_key == key, GroupCommit.status.in_((ACTIVE, ORDERED)))
        .first()
    )
    if not taken:
        return None
    if taken[0] == customer.id:
        return "You've already joined this deal."
    return "Someone at your address has already joined this deal. If you live in a different unit, add your apartment in Edit Profile."


def _refusal(db: Session, deal: GroupDeal, customer: CustomerProfile, units: int, now: datetime, is_member: bool) -> str | None:
    """Why this customer can't join right now, in their words. None if they can."""
    phase = service.current_status(deal, now)
    if phase == "scheduled":
        return "This deal hasn't opened yet."
    if phase not in ("early_access", "live"):
        return "This deal has closed."
    if phase == "early_access" and not is_member:
        return "Harvest Pass members get the first 24 hours of this deal."
    if not 1 <= units <= deal.max_units:
        return f"Each household can claim up to {deal.max_units}."

    taken = _household_taken(db, deal, customer)
    if taken:
        return taken

    households, shares = service.counts(db, deal.id)
    # A held share is theirs, whoever else is waiting. Everyone else stands behind the line.
    place = _waitlist_place(db, deal.id, customer.id, now)
    holding = place is not None and place["status"] == OFFERED
    left = deal.capacity - shares - service.spoken_for(db, deal.id, now, except_customer=customer.id, offers_only=holding)
    if left <= 0:
        return "All the shares have been claimed."
    if units > left:
        return f"Only {left} left."
    # With more than one share per household, big claims could use up the cap
    # before the goal is reached: leave one share for each household still needed.
    if max(deal.goal - households - 1, 0) > left - units:
        return f"Only {max(left - max(deal.goal - households - 1, 0), 1)} can be claimed right now, so enough households can join."
    return None


def _full(deal: GroupDeal, shares: int, spoken_for: int) -> bool:
    return shares + spoken_for >= deal.capacity


def _display_status(deal: GroupDeal, households: int, shares: int, spoken_for: int, now) -> str:
    phase = service.current_status(deal, now)
    if phase in ("early_access", "live"):
        if _full(deal, shares, spoken_for):
            return "full"
        if households >= deal.goal:
            return "goal_met"
    return phase


# --- Reading deals ---------------------------------------------------------------------------


def _card(deal: GroupDeal, product: Product, farmer: FarmerProfile, households: int, shares: int, spoken_for: int, now: datetime) -> dict:
    payout = service.payout_of(deal)
    return {
        "id": str(deal.id),
        "status": _display_status(deal, households, shares, spoken_for, now),
        "farmer_id": str(deal.farmer_id),
        "farm_name": farmer.farm_name,
        "farm_city": farmer.address_city,
        "farm_state": farmer.address_state,
        "product_name": product.name,
        "image_url": product.image_url,
        "unit": deal.unit,
        "share_label": service.share_label(deal.share_size, deal.unit),
        "regular_price": float(deal.regular_price),
        "deal_price": float(deal.deal_price),
        "share_price": payout["share_price"],
        "regular_share_price": payout["regular_share_price"],
        "discount_percent": payout["discount_percent"],
        "goal": deal.goal,
        "capacity": deal.capacity,
        "households": households,
        "shares_claimed": shares,
        "public_opens_at": deal.public_opens_at.isoformat(),
        "deadline_at": deal.deadline_at.isoformat(),
    }


def list_deals(db: Session, customer: CustomerProfile, farmer_id: str | None = None) -> list[dict]:
    now = service.now()
    mine = {
        deal_id
        for (deal_id,) in db.query(GroupCommit.deal_id).filter(
            GroupCommit.customer_id == customer.id, GroupCommit.status.in_((ACTIVE, ORDERED, NOT_CHARGED))
        )
    }
    query = (
        db.query(GroupDeal, Product, FarmerProfile)
        .join(Product, Product.id == GroupDeal.product_id)
        .join(FarmerProfile, FarmerProfile.id == GroupDeal.farmer_id)
        .filter(GroupDeal.status != "draft", GroupDeal.deadline_at.isnot(None))
    )
    if farmer_id:
        try:
            query = query.filter(GroupDeal.farmer_id == uuid.UUID(farmer_id))
        except ValueError:
            return []

    point = browse_point(db, customer)
    out = []
    for deal, product, farmer in query.order_by(GroupDeal.deadline_at).all():
        phase = service.current_status(deal, now)
        joined = deal.id in mine
        if phase in ("early_access", "live"):
            if not joined and not _within_reach(point, farmer):
                continue
        elif not (joined and deal.closed_at and now - deal.closed_at < timedelta(days=_RESULT_DAYS)) and not (joined and phase == "closing"):
            continue
        households, shares = service.counts(db, deal.id)
        spoken_for = service.spoken_for(db, deal.id, now)
        out.append({**_card(deal, product, farmer, households, shares, spoken_for, now), "joined": joined})
    out.sort(key=lambda d: not d["joined"])
    return out


def _within_reach(point: tuple, farmer: FarmerProfile) -> bool:
    if point[0] is None or farmer.latitude is None:
        return True
    return haversine_km(point[0], point[1], farmer.latitude, farmer.longitude) / KM_PER_MILE <= MAX_LISTING_MILES


def _commit_out(db: Session, deal: GroupDeal, commit: GroupCommit, now: datetime) -> dict:
    order_status = None
    if commit.order_id:
        order_status = (db.query(StoreOrder.status).filter(StoreOrder.order_id == commit.order_id).first() or (None,))[0]
    pod = db.get(Pod, commit.pod_id) if commit.pod_id else None
    return {
        "status": commit.status,
        "units": commit.units,
        "fulfillment_method": commit.fulfillment_method,
        "delivery_label": (
            delivery_service.window_label(commit.delivery_starts_at, commit.delivery_ends_at) if commit.delivery_starts_at else None
        ),
        "delivery_fee": float(commit.delivery_fee),
        "pod_name": pod.name if pod else None,
        "pod_share_now": (
            delivery_service.pod_share(commit.pod_full_fee, _others_to_pod(db, deal.id, commit.pod_id, commit.customer_id) + 1)
            if pod and commit.pod_full_fee is not None and commit.status == ACTIVE
            else None
        ),
        "can_withdraw": commit.status == ACTIVE and now < deal.deadline_at - WITHDRAW_LOCK,
        "order_id": str(commit.order_id) if commit.order_id else None,
        "order_status": order_status,
    }


def fallback_offer(db: Session, deal: GroupDeal, commit: GroupCommit | None, product, farmer, is_member: bool, now: datetime) -> dict | None:
    """Members who joined a deal that missed can still buy at the regular price."""
    if (
        commit is None
        or commit.status != NOT_CHARGED
        or deal.status != "expired"
        or not deal.fallback_ends_at
        or now >= deal.fallback_ends_at
        or not is_member
    ):
        return None
    if deal.reserved_quantity < stock_for(deal, commit.units):
        return None
    priced = price_order(deal, product, farmer, commit.units, float(commit.delivery_fee), is_member, unit_price=deal.regular_price)
    return {"ends_at": deal.fallback_ends_at.isoformat(), "share_price": priced["share_price"], "total": priced["total"]}


def stock_for(deal: GroupDeal, units: int) -> int:
    return math.ceil(service.dec(deal.share_size) * units)


def get_deal(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    now = service.now()
    deal = deal_or_404(db, deal_id)
    product = db.get(Product, deal.product_id)
    farmer = db.get(FarmerProfile, deal.farmer_id)
    households, shares = service.counts(db, deal.id)
    is_member = membership_service.has_member_benefits(db, customer.id)
    commit = _my_commit(db, deal.id, customer.id)
    shown = commit if commit and commit.status in (ACTIVE, ORDERED, NOT_CHARGED) else None
    blocked = _refusal(db, deal, customer, 1, now, is_member)
    spoken_for = service.spoken_for(db, deal.id, now)
    place = _waitlist_place(db, deal.id, customer.id, now)
    full = _full(deal, shares, spoken_for)
    pods, pod_note = _pod_choices(db, deal, customer)
    return {
        **_card(deal, product, farmer, households, shares, spoken_for, now),
        "description": product.description,
        "max_units": deal.max_units,
        "member_opens_at": deal.member_opens_at.isoformat(),
        "withdraw_locks_at": (deal.deadline_at - WITHDRAW_LOCK).isoformat(),
        "fulfillment_date": deal.fulfillment_date,
        "filled_by_members": full and now < deal.public_opens_at,
        "joined": shown is not None,
        "is_member": is_member,
        "free_month_available": membership_service.free_month_available(db, customer.id),
        "can_join": blocked is None,
        "join_blocked_reason": blocked,
        "my_commit": _commit_out(db, deal, shown, now) if shown else None,
        "fallback": fallback_offer(db, deal, shown, product, farmer, is_member, now),
        "pickup_address": ", ".join(p for p in (farmer.address_street, farmer.address_city, farmer.address_state) if p),
        "delivery": _delivery_choice(db, deal, customer),
        "pods": pods,
        "pod_note": pod_note,
        "my_pod": _my_pod(db, deal, customer.id),
        "waitlist": place,
        "can_waitlist": full and place is None and shown is None and service.current_status(deal, now) in ("early_access", "live")
        and (service.current_status(deal, now) != "early_access" or is_member)
        and _household_taken(db, deal, customer) is None,
        "following_farm": is_following(db, customer.id, str(deal.farmer_id)),
    }


def quote(db: Session, customer: CustomerProfile, deal_id: str, payload: DealQuoteIn) -> dict:
    deal = deal_or_404(db, deal_id)
    fee = 0.0
    share_now = None
    if payload.fulfillment_method == "delivery" and payload.pod_id:
        choice = _pod_choice(db, deal, customer, payload.pod_id)
        fee, share_now = choice["full_fee"], choice["share_now"]
    elif payload.fulfillment_method == "delivery":
        choice = _delivery_choice(db, deal, customer)
        if not choice["available"]:
            raise _bad_request(choice["reason"])
        fee = choice["fee"]
    priced = price_order(
        deal,
        db.get(Product, deal.product_id),
        db.get(FarmerProfile, deal.farmer_id),
        payload.units,
        fee,
        membership_service.has_member_benefits(db, customer.id),
    )
    return {**priced, "pod_share_now": share_now}


def _pod_choice(db: Session, deal: GroupDeal, customer: CustomerProfile, pod_id: str) -> dict:
    choices, _ = _pod_choices(db, deal, customer)
    choice = next((c for c in choices if c["pod_id"] == pod_id), None)
    if choice is None:
        raise _bad_request("This deal can't go to that pod's drop point.")
    return choice


# --- Joining and withdrawing -------------------------------------------------------------------


def _chosen_window(db: Session, deal: GroupDeal, customer: CustomerProfile, payload: DealJoinIn) -> tuple:
    """(starts, ends, fee, pod id, pod fee) for what they picked; nothing for pickup."""
    if payload.fulfillment_method != "delivery":
        return None, None, 0.0, None, None
    if payload.pod_id:
        choice = _pod_choice(db, deal, customer, payload.pod_id)
        fee, pod_id, pod_fee = choice["full_fee"], uuid.UUID(choice["pod_id"]), choice["full_fee"]
    else:
        choice = _delivery_choice(db, deal, customer)
        if not choice["available"]:
            raise _bad_request(choice["reason"])
        fee, pod_id, pod_fee = choice["fee"], None, None
    slot = next((s for s in choice["slots"] if s["starts_at"] == payload.delivery_starts_at), None)
    if slot is None:
        raise _bad_request("Pick a delivery time.")
    return datetime.fromisoformat(slot["starts_at"]), datetime.fromisoformat(slot["ends_at"]), fee, pod_id, pod_fee


def join(db: Session, customer: CustomerProfile, deal_id: str, payload: DealJoinIn) -> dict:
    now = service.now()
    deal = deal_or_404(db, deal_id)
    is_member = membership_service.has_member_benefits(db, customer.id)
    refusal = _refusal(db, deal, customer, payload.units, now, is_member)
    if refusal:
        raise _conflict(refusal)
    starts, ends, fee, pod_id, pod_fee = _chosen_window(db, deal, customer, payload)

    stripe_customer = membership_service.get_or_create_stripe_customer(db, customer.id)
    commit = (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.customer_id == customer.id, GroupCommit.status == PENDING_CARD)
        .first()
    )
    if commit is None:
        commit = GroupCommit(id=uuid.uuid4(), deal_id=deal.id, customer_id=customer.id, status=PENDING_CARD)
        db.add(commit)
    commit.household_key = household_key(customer.address_street, customer.address_unit, customer.address_zip)
    commit.units = payload.units
    commit.fulfillment_method = payload.fulfillment_method
    commit.delivery_starts_at = starts
    commit.delivery_ends_at = ends
    commit.delivery_fee = fee
    commit.pod_id = pod_id
    commit.pod_full_fee = pod_fee
    db.flush()
    try:
        intent = stripe_client.create_setup_intent(
            stripe_customer, {"purpose": JOIN_PURPOSE, "profile_id": str(customer.id), "commit_id": str(commit.id)}
        )
    except stripe.error.StripeError as e:
        logger.error("Could not start saving a card for a deal: %s", e)
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="We couldn't reach our payment provider. Please try again.")
    commit.stripe_setup_intent_id = intent.id
    db.commit()
    return {"setup_intent_client_secret": intent.client_secret}


def _activate(db: Session, commit: GroupCommit, now: datetime) -> None:
    """The card is saved: count them, if the rules still allow it. Commits."""
    intent = stripe_client.retrieve_setup_intent(commit.stripe_setup_intent_id)
    method = intent.get("payment_method")
    if intent.get("status") != "succeeded" or not method or (intent.get("metadata") or {}).get("commit_id") != str(commit.id):
        raise _conflict("Your card wasn't saved, so you haven't joined yet.")

    deal = db.query(GroupDeal).filter(GroupDeal.id == commit.deal_id).with_for_update().one()
    customer = db.get(CustomerProfile, commit.customer_id)
    is_member = membership_service.has_member_benefits(db, commit.customer_id)
    refusal = _refusal(db, deal, customer, commit.units, now, is_member)
    if refusal:
        commit.status = WITHDRAWN
        commit.withdrawn_at = now
        db.commit()
        raise _conflict(f"{refusal} You haven't been charged.")

    commit.stripe_payment_method_id = method["id"] if isinstance(method, dict) else method
    commit.member_at_join = is_member
    commit.household_key = household_key(customer.address_street, customer.address_unit, customer.address_zip)
    commit.status = ACTIVE
    commit.joined_at = now
    # Joining is what claims a place on the waitlist.
    db.query(GroupWaitlist).filter(
        GroupWaitlist.deal_id == deal.id, GroupWaitlist.customer_id == commit.customer_id, GroupWaitlist.status.in_((WAITING, OFFERED))
    ).update({"status": CLAIMED}, synchronize_session=False)
    try:
        db.commit()
    except IntegrityError:
        # The unique indexes (0037): another account at this address got there first.
        db.rollback()
        raise _conflict("Someone at your address has already joined this deal.")
    _announce_join(db, commit.deal_id, commit.customer_id)


def confirm_join(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    deal = deal_or_404(db, deal_id)
    commit = (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.customer_id == customer.id, GroupCommit.status == PENDING_CARD)
        .first()
    )
    if commit is not None:
        try:
            _activate(db, commit, service.now())
        except stripe.error.StripeError as e:
            logger.warning("Could not read a deal's SetupIntent: %s", e)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="We couldn't reach our payment provider. Please try again.")
    return get_deal(db, customer, deal_id)


def deal_context(db: Session, deal: GroupDeal) -> dict:
    product = db.get(Product, deal.product_id)
    farmer = db.get(FarmerProfile, deal.farmer_id)
    return {
        "deal_id": str(deal.id),
        "product_name": product.name,
        "farm_name": farmer.farm_name,
        "goal": deal.goal,
        "deadline_at": deal.deadline_at,
    }


def _announce_join(db: Session, deal_id, customer_id) -> None:
    deal = db.get(GroupDeal, deal_id)
    households, _ = service.counts(db, deal.id)
    context = {**deal_context(db, deal), "households": households}
    notices = [Notice(customer_id, "deal_joined", context, f"deal_joined:{deal.id}:{customer_id}")]
    # Crossing a milestone: everyone who's in hears it, at most once a day per
    # deal, and the farmer hears each one.
    for share, label in _MILESTONES:
        needed = math.ceil(deal.goal * share)
        if households >= needed and households - 1 < needed:
            today = service.now().astimezone(LOCAL_TZ).date().isoformat()
            others = (
                db.query(GroupCommit.customer_id)
                .filter(GroupCommit.deal_id == deal.id, GroupCommit.status == ACTIVE, GroupCommit.customer_id != customer_id)
                .all()
            )
            for (other,) in others:
                notices.append(Notice(other, "deal_progress", {**context, "milestone": label}, f"deal_progress:{deal.id}:{other}:{today}"))
            notices.append(Notice(deal.farmer_id, "deal_farmer_progress", {**context, "milestone": label}, f"deal_farmer_progress:{deal.id}:{label}"))
            break
    notify_many(db, notices)


def withdraw(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    now = service.now()
    deal = deal_or_404(db, deal_id, lock=True)
    commit = (
        db.query(GroupCommit)
        .filter(GroupCommit.deal_id == deal.id, GroupCommit.customer_id == customer.id, GroupCommit.status.in_((ACTIVE, PENDING_CARD)))
        .with_for_update()
        .first()
    )
    if commit is None:
        db.commit()
        raise _conflict("You haven't joined this deal.")
    if commit.status == ACTIVE and (deal.status not in OPEN_STATUSES or now >= deal.deadline_at - WITHDRAW_LOCK):
        db.commit()
        raise _conflict("It's too late to withdraw: the deal closes in less than 12 hours.")
    was_counted = commit.status == ACTIVE
    commit.status = WITHDRAWN
    commit.withdrawn_at = now
    db.flush()
    offers = service.offer_next(db, deal, now) if was_counted else []
    db.commit()
    notify_many(db, offers)
    return get_deal(db, customer, deal_id)


# --- The waitlist ------------------------------------------------------------------------------


def _waitlist_place(db: Session, deal_id, customer_id, now: datetime) -> dict | None:
    row = (
        db.query(GroupWaitlist)
        .filter(GroupWaitlist.deal_id == deal_id, GroupWaitlist.customer_id == customer_id, GroupWaitlist.status.in_((WAITING, OFFERED)))
        .first()
    )
    if row is None or (row.status == OFFERED and row.offer_expires_at <= now):
        return None
    position = None
    if row.status == WAITING:
        position = 1 + (
            db.query(GroupWaitlist.id)
            .filter(GroupWaitlist.deal_id == deal_id, GroupWaitlist.status == WAITING, GroupWaitlist.created_at < row.created_at)
            .count()
        )
    return {
        "status": row.status,
        "position": position,
        "offer_expires_at": row.offer_expires_at.isoformat() if row.status == OFFERED else None,
    }


def join_waitlist(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    now = service.now()
    deal = deal_or_404(db, deal_id, lock=True)
    phase = service.current_status(deal, now)
    if phase not in ("early_access", "live"):
        db.commit()
        raise _conflict("This deal has closed.")
    if phase == "early_access" and not membership_service.has_member_benefits(db, customer.id):
        db.commit()
        raise _conflict("Harvest Pass members get the first 24 hours of this deal.")
    _, shares = service.counts(db, deal.id)
    if not _full(deal, shares, service.spoken_for(db, deal.id, now)):
        db.commit()
        raise _conflict("There are shares left, so you can join the deal itself.")
    taken = _household_taken(db, deal, customer)
    if taken:
        db.commit()
        raise _conflict(taken)
    db.add(
        GroupWaitlist(
            id=uuid.uuid4(),
            deal_id=deal.id,
            customer_id=customer.id,
            household_key=household_key(customer.address_street, customer.address_unit, customer.address_zip),
            status=WAITING,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # The unique indexes (0038): they, or someone at their address, already have a place.
        db.rollback()
        raise _conflict("Your household is already on the waitlist.")
    return get_deal(db, customer, deal_id)


def leave_waitlist(db: Session, customer: CustomerProfile, deal_id: str) -> dict:
    now = service.now()
    deal = deal_or_404(db, deal_id, lock=True)
    db.query(GroupWaitlist).filter(
        GroupWaitlist.deal_id == deal.id, GroupWaitlist.customer_id == customer.id, GroupWaitlist.status.in_((WAITING, OFFERED))
    ).update({"status": LEFT}, synchronize_session=False)
    db.flush()
    offers = service.offer_next(db, deal, now)
    db.commit()
    notify_many(db, offers)
    return get_deal(db, customer, deal_id)


# --- Following a farm --------------------------------------------------------------------------


def _farm_id(farmer_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(farmer_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farm not found")


def is_following(db: Session, customer_id, farmer_id: str) -> bool:
    return db.get(FarmFollow, (customer_id, _farm_id(farmer_id))) is not None


def set_following(db: Session, customer_id, farmer_id: str, following: bool) -> bool:
    fid = _farm_id(farmer_id)
    if db.get(FarmerProfile, fid) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farm not found")
    row = db.get(FarmFollow, (customer_id, fid))
    if following and row is None:
        db.add(FarmFollow(customer_id=customer_id, farmer_id=fid))
    elif not following and row is not None:
        db.delete(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # a second tap got there first, and the answer's the same
    return following


def adopt_pending(db: Session, now: datetime) -> int:
    """The app closed between saving a card and telling us."""
    rows = (
        db.query(GroupCommit)
        .join(GroupDeal, GroupDeal.id == GroupCommit.deal_id)
        .filter(
            GroupCommit.status == PENDING_CARD,
            GroupCommit.stripe_setup_intent_id.isnot(None),
            GroupCommit.created_at > now - timedelta(hours=2),
            GroupDeal.status.in_(OPEN_STATUSES),
        )
        .limit(50)
        .all()
    )
    adopted = 0
    for commit in rows:
        try:
            _activate(db, commit, now)
            adopted += 1
        except (HTTPException, stripe.error.StripeError):
            db.rollback()
    return adopted

