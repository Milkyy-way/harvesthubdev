"""Neighborhood Pods — see 0035_neighborhood_pods.sql for what a pod is and how
this differs from the spec.

Lifecycle: draft -> pending (first invite out) -> active (host + 2 accepted),
paused when it falls below that or loses its drop point, then back to active
or dissolved after a week. A pending pod that doesn't reach the minimum in 7
days expires.

Everything time-based happens in _advance(): invites running out, departures
coming due, grace periods ending. The scheduled job runs it for every live pod,
and reading a pod runs it for that pod, so a screen is right even if the job is
late. It's safe to run any number of times.

Departures never disturb a delivery: a member who's leaving stays on the books
until their open order is delivered.

Charging is in app/pods/charging.py: a pod order is charged once, at the farm's
cutoff, with the fee split among the households that ordered.

The drop point (decided with the user 2026-10-31): the host can move it, within
the range of the farms with orders there, and orders that haven't left move
with it. Once everyone has ordered for a delivery date it's locked: it can't
change until those orders are done, and they're delivered there.

Delivering to a pod (cart options, checkout, the shared stop on a run) is in
app/delivery/service.py.
"""
import logging
import secrets
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.geo import haversine_km
from app.core.geocoding import REFRESH_AFTER, ZIP, geocode_address
from app.core.localtime import LOCAL_TZ, to_local
from app.core.models import Profile
from app.customers.models import CustomerProfile
from app.delivery import service as delivery_service
from app.delivery.service import KM_PER_MILE
from app.membership.service import has_member_benefits
from app.notifications.service import Notice, notify_many
from app.orders.models import Order, StoreOrder
from app.payments.models import POD_PLACED_STATUSES, Payment
from app.pods import charging
from app.pods.models import Pod, PodInvite, PodMember
from app.pods.schemas import DropPointIn

logger = logging.getLogger(__name__)

# The spec's "defaults to tune".
MIN_MEMBERS = 3  # the host + 2
SIZE_CAP = 8
INVITE_TTL = timedelta(hours=72)
POD_EXPIRY = timedelta(days=7)
RADIUS_MILES = 0.5
REINVITE_COOLDOWN = timedelta(days=30)
GRACE_PERIOD = timedelta(days=7)  # one weekly delivery cycle

# Enough for a pod to fill up, not enough to spam from.
_MAX_OPEN_INVITES = 20
# No 0/O/1/I, so a code can be read out or typed. legal/router.py's /invite
# page accepts the same characters.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 8

_ENDED = ("expired", "dissolved")
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
# What a departure waits for and what the lock counts: paid and on its way to
# a drop point, or placed and waiting for the cutoff charge.
_OPEN_ORDER_STATUSES = ("paid", "out_for_delivery")
_IS_OPEN_ORDER = or_(
    StoreOrder.status.in_(_OPEN_ORDER_STATUSES),
    and_(StoreOrder.status == "pending_payment", Payment.status.in_(POD_PLACED_STATUSES)),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _first_name(db: Session, customer_id) -> str:
    name = db.query(Profile.full_name).filter(Profile.id == customer_id).scalar()
    return (name or "").strip().split(" ")[0] or "A neighbor"


def _address_line(pod: Pod) -> str | None:
    if not pod.address_street:
        return None
    return ", ".join(
        p for p in (pod.address_street, pod.address_city, f"{pod.address_state or ''} {pod.address_zip or ''}".strip()) if p
    )


def cycle_end(weekday: int, now: datetime) -> datetime:
    """The end of the next delivery day (today counts): when "the end of the
    current cycle" arrives."""
    today = to_local(now).date()
    day = today + timedelta(days=(weekday - today.weekday()) % 7)
    return datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=LOCAL_TZ)


def _miles(a_lat, a_lng, b_lat, b_lng) -> float:
    return haversine_km(a_lat, a_lng, b_lat, b_lng) / KM_PER_MILE


def _distance_problem(customer: CustomerProfile | None, pod: Pod) -> str | None:
    """Why this customer's home doesn't qualify for this drop point. Refuses
    a ZIP-level guess instead of trusting it (app/core/geocoding.py)."""
    if customer is None or customer.latitude is None or customer.location_precision == ZIP:
        return "We couldn't pinpoint your address. Check it in Edit Profile, then try again."
    if pod.latitude is None:
        return "This pod is choosing a new drop point. Try again once it has one."
    if _miles(customer.latitude, customer.longitude, pod.latitude, pod.longitude) > RADIUS_MILES:
        return f"You need to live within {RADIUS_MILES:g} miles of the pod's drop point to join."
    return None


# --- The drop point lock ----------------------------------------------------------------


def _refresh_drop_lock(db: Session, pod: Pod) -> None:
    """Everyone staying in the pod has an order for one delivery date: lock.
    The lock sticks until that date's orders are done, even if someone joins
    or cancels meanwhile. Does NOT commit."""
    rows = (
        db.query(Order.customer_id, StoreOrder.delivery_window_starts_at)
        .join(StoreOrder, StoreOrder.order_id == Order.id)
        .join(Payment, Payment.order_id == Order.id)
        .filter(StoreOrder.pod_id == pod.id, _IS_OPEN_ORDER)
        .all()
    )
    customers_by_date: dict = {}
    for customer_id, starts_at in rows:
        customers_by_date.setdefault(to_local(starts_at).date(), set()).add(customer_id)
    if pod.drop_locked_date is not None and pod.drop_locked_date not in customers_by_date:
        pod.drop_locked_date = None
    if pod.drop_locked_date is None:
        staying = {m.customer_id for m in _members(db, pod.id) if m.leave_at is None}
        for day in sorted(customers_by_date):
            if staying and staying <= customers_by_date[day]:
                pod.drop_locked_date = day
                break


def _on_its_way(db: Session, pod_id) -> bool:
    return (
        db.query(StoreOrder.id).filter(StoreOrder.pod_id == pod_id, StoreOrder.status == "out_for_delivery").first() is not None
    )


# --- Members ---------------------------------------------------------------------------


def _members(db: Session, pod_id) -> list[PodMember]:
    return (
        db.query(PodMember)
        .filter(PodMember.pod_id == pod_id, PodMember.status == "active")
        .order_by(PodMember.joined_at, PodMember.id)
        .all()
    )


def _member_of(db: Session, pod_id, customer_id) -> PodMember | None:
    return (
        db.query(PodMember)
        .filter(PodMember.pod_id == pod_id, PodMember.customer_id == customer_id, PodMember.status == "active")
        .first()
    )


def _has_open_order(db: Session, pod_id, customer_id) -> bool:
    return (
        db.query(StoreOrder.id)
        .join(Order, Order.id == StoreOrder.order_id)
        .join(Payment, Payment.order_id == Order.id)
        .filter(StoreOrder.pod_id == pod_id, Order.customer_id == customer_id, _IS_OPEN_ORDER)
        .first()
        is not None
    )


def _pod_has_open_orders(db: Session, pod_id) -> bool:
    return (
        db.query(StoreOrder.id)
        .join(Payment, Payment.order_id == StoreOrder.order_id)
        .filter(StoreOrder.pod_id == pod_id, _IS_OPEN_ORDER)
        .first()
        is not None
    )


def _notices(members: list[PodMember], kind: str, ctx: dict, key: str, skip=None) -> list[Notice]:
    return [Notice(m.customer_id, kind, ctx, f"{key}:{m.customer_id}") for m in members if m.customer_id != skip]


def _ctx(pod: Pod) -> dict:
    return {"pod_id": str(pod.id), "pod_name": pod.name, "delivery_day": _WEEKDAYS[pod.delivery_weekday]}


def _schedule_departure(db: Session, pod: Pod, member: PodMember, when: datetime, reason: str) -> list[Notice]:
    """Decides a departure. Everyone else hears, factually, how many the pod
    will have. Does NOT commit."""
    member.leave_at, member.leave_reason = when, reason
    db.flush()
    members = _members(db, pod.id)
    staying = sum(1 for m in members if m.leave_at is None)
    return _notices(
        members,
        "pod_member_leaving",
        {**_ctx(pod), "count": staying},
        f"pod_member_leaving:{member.id}:{when.isoformat()}",
        skip=member.customer_id,
    )


def _clear_drop_point(pod: Pod) -> None:
    pod.drop_kind = pod.address_street = pod.address_city = pod.address_state = pod.address_zip = None
    pod.latitude = pod.longitude = pod.location_precision = pod.geocoded_at = None
    pod.access_notes = pod.shelter_note = pod.permission_attested_at = None


def _hand_over(db: Session, pod: Pod, new_host: PodMember) -> list[Notice]:
    """A home drop point was the old host's: the new host chooses another and
    everyone re-approves it. Until then the pod can't take orders."""
    needs_drop_point = pod.drop_kind == "home"
    pod.host_id = new_host.customer_id
    if needs_drop_point:
        _clear_drop_point(pod)
    first_name = _first_name(db, new_host.customer_id)
    key = f"pod_new_host:{pod.id}:{new_host.customer_id}:{pod.drop_version}"
    return _notices(
        _members(db, pod.id), "pod_new_host", {**_ctx(pod), "you": False, "first_name": first_name}, key, skip=new_host.customer_id
    ) + [
        Notice(
            new_host.customer_id,
            "pod_new_host",
            {**_ctx(pod), "you": True, "needs_drop_point": needs_drop_point},
            f"{key}:{new_host.customer_id}",
        )
    ]


def _end(db: Session, pod: Pod, new_status: str, now: datetime) -> list[Notice]:
    """The pod is over: expired, or dissolved. Orders already placed are still
    delivered. Does NOT commit."""
    members = _members(db, pod.id)
    notices = _notices(members, "pod_ended", {**_ctx(pod), "reason": new_status}, f"pod_ended:{pod.id}")
    for m in members:
        m.status, m.left_at = "left", now
    db.query(PodInvite).filter(PodInvite.pod_id == pod.id, PodInvite.status == "sent").update({"status": "revoked"})
    pod.status, pod.ended_at = new_status, now
    pod.grace_ends_at = None
    _scrub_if_finished(db, pod)
    return notices


def _scrub_if_finished(db: Session, pod: Pod) -> None:
    """An ended pod has no use for the address, once nothing is on its way there."""
    if pod.status in _ENDED and pod.address_street and not _pod_has_open_orders(db, pod.id):
        _clear_drop_point(pod)


# --- The state machine -----------------------------------------------------------------


def _advance(db: Session, pod: Pod, now: datetime | None = None) -> list[Notice]:
    """Brings one pod up to date. Does NOT commit; returns what to announce
    after the caller has."""
    now = now or _now()
    notices: list[Notice] = []
    if pod.status in _ENDED:
        _scrub_if_finished(db, pod)
        return notices

    db.query(PodInvite).filter(
        PodInvite.pod_id == pod.id, PodInvite.status == "sent", PodInvite.expires_at <= now
    ).update({"status": "expired"}, synchronize_session=False)

    if pod.status == "pending" and pod.first_invite_at and pod.first_invite_at + POD_EXPIRY <= now:
        return notices + _end(db, pod, "expired", now)

    members = _members(db, pod.id)

    # Harvest Pass lapsed: out at the end of the cycle, unless they come back.
    for m in members:
        benefits = has_member_benefits(db, m.customer_id)
        if not benefits and m.leave_at is None:
            when = cycle_end(pod.delivery_weekday, now)
            notices.append(
                Notice(
                    m.customer_id,
                    "pod_membership_lapsing",
                    {**_ctx(pod), "leave_at": when},
                    f"pod_membership_lapsing:{m.id}:{when.isoformat()}",
                )
            )
            notices += _schedule_departure(db, pod, m, when, "lapsed")
        elif benefits and m.leave_reason == "lapsed":
            m.leave_at = m.leave_reason = None

    # Drop point not re-approved in time.
    if pod.reapprove_by and pod.reapprove_by <= now:
        for m in members:
            if m.approved_drop_version < pod.drop_version and m.leave_at is None:
                notices += _schedule_departure(db, pod, m, now, "no_reapproval")
        pod.reapprove_by = None

    # Departures that are due. The host goes last: they may need to hand over.
    host = next((m for m in members if m.customer_id == pod.host_id), None)
    for m in members:
        due = m.leave_at is not None and m.leave_at <= now and not _has_open_order(db, pod.id, m.customer_id)
        if due and m is not host:
            m.status, m.left_at = "left", now
    db.flush()  # autoflush is off — the queries below must see these
    if host and host.leave_at is not None and host.leave_at <= now and not _has_open_order(db, pod.id, host.customer_id):
        successor = next(
            (m for m in _members(db, pod.id) if m is not host and m.leave_at is None and has_member_benefits(db, m.customer_id)),
            None,
        )
        if successor is None:
            return notices + _end(db, pod, "dissolved", now)
        notices += _hand_over(db, pod, successor)
        host.status, host.left_at = "left", now
        db.flush()

    current = _members(db, pod.id)
    if not current:
        return notices + _end(db, pod, "dissolved", now)
    _refresh_drop_lock(db, pod)

    # Someone on their way out still counts until they've gone, but doesn't
    # count towards going live or recovering.
    staying = sum(1 for m in current if m.leave_at is None)
    has_drop = pod.latitude is not None
    healthy = staying >= MIN_MEMBERS and has_drop
    if pod.status == "pending" and healthy:
        pod.status, pod.activated_at = "active", now
        notices += _notices(current, "pod_active", _ctx(pod), f"pod_active:{pod.id}")
    elif pod.status == "active" and (len(current) < MIN_MEMBERS or not has_drop):
        pod.status, pod.paused_at, pod.grace_ends_at = "paused", now, now + GRACE_PERIOD
        notices += _notices(
            current,
            "pod_paused",
            {**_ctx(pod), "grace_ends_at": pod.grace_ends_at, "needs_drop_point": not has_drop},
            f"pod_paused:{pod.id}:{now.isoformat()}",
        )
    elif pod.status == "paused":
        if healthy:
            pod.status, pod.paused_at, pod.grace_ends_at = "active", None, None
            notices += _notices(current, "pod_resumed", _ctx(pod), f"pod_resumed:{pod.id}:{now.isoformat()}")
        elif pod.grace_ends_at and pod.grace_ends_at <= now:
            return notices + _end(db, pod, "dissolved", now)
    return notices


def _commit_and_announce(db: Session, notices: list[Notice]) -> None:
    db.commit()
    notify_many(db, notices)


def _locked_pod(db: Session, pod_id: str) -> Pod:
    try:
        pid = uuid.UUID(pod_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pod not found")
    pod = db.query(Pod).filter(Pod.id == pid).with_for_update().first()
    if pod is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pod not found")
    return pod


def _pod_i_am_in(db: Session, pod_id: str, customer_id) -> tuple[Pod, PodMember]:
    """Locked and up to date. A pod you aren't in doesn't exist, as far as you can tell."""
    pod = _locked_pod(db, pod_id)
    notices = _advance(db, pod)
    if notices:
        _commit_and_announce(db, notices)
        pod = _locked_pod(db, pod_id)
    member = _member_of(db, pod.id, customer_id)
    if member is None:
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pod not found")
    return pod, member


def _pod_i_host(db: Session, pod_id: str, customer_id) -> tuple[Pod, PodMember]:
    pod, member = _pod_i_am_in(db, pod_id, customer_id)
    if pod.host_id != customer_id:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the pod's host can do that.")
    return pod, member


# --- Choosing a drop point --------------------------------------------------------------


def _resolve_drop(customer: CustomerProfile, payload: DropPointIn) -> dict:
    """Where the drop point is, checked but not saved. A home is always the
    host's saved address."""
    if payload.drop_kind == "home":
        if customer.latitude is None or customer.location_precision == ZIP:
            raise _bad_request("We couldn't pinpoint your address. Check it in Edit Profile, then try again.")
        return {
            "drop_kind": "home",
            "address_street": customer.address_street,
            "address_city": customer.address_city,
            "address_state": customer.address_state,
            "address_zip": customer.address_zip,
            "latitude": customer.latitude,
            "longitude": customer.longitude,
            "location_precision": customer.location_precision,
        }
    street, city = (payload.address_street or "").strip(), (payload.address_city or "").strip()
    state, zip_code = (payload.address_state or "").strip().upper(), (payload.address_zip or "").strip()
    if not (street and city and state and zip_code):
        raise _bad_request("Enter the drop point's full address.")
    result = geocode_address(street, city, state, zip_code)
    if result is None or result.precision == ZIP:
        raise _bad_request("We couldn't find that address on the map. Check it and try again.")
    return {
        "drop_kind": "neutral",
        "address_street": street,
        "address_city": city,
        "address_state": state,
        "address_zip": zip_code,
        "latitude": result.latitude,
        "longitude": result.longitude,
        "location_precision": result.precision,
    }


def _check_drop_rules(customer: CustomerProfile, drop: dict, payload: DropPointIn) -> None:
    """The spec's table: home vs. neutral. The host must live near it too."""
    if drop["drop_kind"] == "neutral":
        if not payload.permission_attested:
            raise _bad_request("Please confirm you have permission to use this location.")
        if not (payload.shelter_note or "").strip():
            raise _bad_request("Say where the covered or shaded spot is, so orders aren't left in the sun or rain.")
    if customer.latitude is None or customer.location_precision == ZIP:
        raise _bad_request("We couldn't pinpoint your address. Check it in Edit Profile, then try again.")
    if _miles(customer.latitude, customer.longitude, drop["latitude"], drop["longitude"]) > RADIUS_MILES:
        raise _bad_request(f"The drop point must be within {RADIUS_MILES:g} miles of your home.")


def _apply_drop(pod: Pod, drop: dict, payload: DropPointIn, now: datetime) -> None:
    for field, value in drop.items():
        setattr(pod, field, value)
    pod.geocoded_at = now
    pod.access_notes = (payload.access_notes or "").strip() or None
    pod.shelter_note = (payload.shelter_note or "").strip() or None
    pod.permission_attested_at = now if drop["drop_kind"] == "neutral" else None


def _farms_out(farms: list[dict]) -> list[dict]:
    return [{k: f[k] for k in ("farmer_id", "farm_name", "pod_delivery_fee", "share", "savings")} for f in farms]


def drop_options(db: Session, customer: CustomerProfile, payload: DropPointIn) -> dict:
    """Which days have a farm delivering to this drop point: what the host
    chooses a day from. Shares are for a pod at the minimum size, with every
    household ordering."""
    drop = _resolve_drop(customer, payload)
    farms = delivery_service.pod_farms_near(db, drop["latitude"], drop["longitude"], households=MIN_MEMBERS)
    days = []
    for weekday, label in enumerate(_WEEKDAYS):
        serving = [f for f in farms if weekday in f["weekdays"]]
        if serving:
            days.append({"weekday": weekday, "label": label, "farms": _farms_out(serving)})
    address = ", ".join(
        p for p in (drop["address_street"], drop["address_city"], f"{drop['address_state']} {drop['address_zip']}") if p
    )
    return {"address_line": address, "days": days}


def _require_benefits(db: Session, customer_id, doing: str) -> None:
    if not has_member_benefits(db, customer_id):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=f"Join Harvest Pass to {doing}.")


def create_pod(db: Session, customer: CustomerProfile, payload) -> dict:
    _require_benefits(db, customer.id, "start a pod")
    drop = _resolve_drop(customer, payload)
    _check_drop_rules(customer, drop, payload)
    if not delivery_service.pod_farms_near(db, drop["latitude"], drop["longitude"], payload.delivery_weekday):
        raise _bad_request(f"No farm delivers to pods at this location on {_WEEKDAYS[payload.delivery_weekday]}s yet.")

    now = _now()
    pod = Pod(
        id=uuid.uuid4(),
        host_id=customer.id,
        name=payload.name.strip(),
        status="draft",
        delivery_weekday=payload.delivery_weekday,
    )
    _apply_drop(pod, drop, payload, now)
    db.add(pod)
    db.flush()
    db.add(
        PodMember(id=uuid.uuid4(), pod_id=pod.id, customer_id=customer.id, delivery_weekday=pod.delivery_weekday, joined_at=now)
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(f"You're already in a pod that delivers on {_WEEKDAYS[payload.delivery_weekday]}s.")
    return get_pod(db, customer.id, str(pod.id))


# --- Reading ------------------------------------------------------------------------------


def _summary(db: Session, pod: Pod, member: PodMember) -> dict:
    count = db.query(func.count(PodMember.id)).filter(PodMember.pod_id == pod.id, PodMember.status == "active").scalar()
    return {
        "id": str(pod.id),
        "name": pod.name,
        "status": pod.status,
        "is_host": pod.host_id == member.customer_id,
        "delivery_day": _WEEKDAYS[pod.delivery_weekday],
        "address_line": _address_line(pod),
        "member_count": count,
        "needs_reapproval": member.approved_drop_version < pod.drop_version and pod.latitude is not None,
        "needs_drop_point": pod.latitude is None,
    }


def list_pods(db: Session, customer_id) -> dict:
    rows = (
        db.query(PodMember.pod_id).filter(PodMember.customer_id == customer_id, PodMember.status == "active").all()
    )
    pods = []
    for (pod_id,) in rows:
        pod = db.query(Pod).filter(Pod.id == pod_id).with_for_update().first()
        if pod is None:
            continue
        _commit_and_announce(db, _advance(db, pod))
        pod = db.get(Pod, pod_id)
        member = _member_of(db, pod_id, customer_id)
        if member is not None and pod.status not in _ENDED:
            pods.append(_summary(db, pod, member))
    return {"pods": pods}


def get_pod(db: Session, customer_id, pod_id: str) -> dict:
    pod, member = _pod_i_am_in(db, pod_id, customer_id)
    is_host = pod.host_id == customer_id
    members = _members(db, pod.id)
    names = dict(db.query(Profile.id, Profile.full_name).filter(Profile.id.in_([m.customer_id for m in members])).all())
    invites = (
        db.query(PodInvite).filter(PodInvite.pod_id == pod.id).order_by(PodInvite.created_at.desc()).limit(50).all()
        if is_host
        else []
    )
    farms = (
        delivery_service.pod_farms_near(db, pod.latitude, pod.longitude, pod.delivery_weekday, households=len(members))
        if pod.latitude is not None
        else []
    )
    home = db.get(CustomerProfile, customer_id) if is_host and pod.drop_kind == "home" else None
    out = {
        **_summary(db, pod, member),
        "delivery_weekday": pod.delivery_weekday,
        "drop_kind": pod.drop_kind,
        "shelter_note": pod.shelter_note,
        "access_notes": pod.access_notes if is_host else None,
        "min_members": MIN_MEMBERS,
        "size_cap": SIZE_CAP,
        "radius_miles": RADIUS_MILES,
        "expires_at": _iso(pod.first_invite_at + POD_EXPIRY) if pod.status == "pending" and pod.first_invite_at else None,
        "grace_ends_at": _iso(pod.grace_ends_at),
        "reapprove_by": _iso(pod.reapprove_by),
        "drop_locked_date": pod.drop_locked_date.isoformat() if pod.drop_locked_date else None,
        "drop_on_its_way": _on_its_way(db, pod.id),
        "home_address_changed": home is not None
        and (home.address_street != pod.address_street or home.address_zip != pod.address_zip),
        "my_leave_at": _iso(member.leave_at),
        "my_leave_reason": member.leave_reason,
        "members": [
            {
                "id": str(m.id),
                "first_name": (names.get(m.customer_id) or "").strip().split(" ")[0] or "Neighbor",
                "is_host": m.customer_id == pod.host_id,
                "is_me": m.customer_id == customer_id,
                "leaving": m.leave_at is not None,
                "needs_reapproval": m.approved_drop_version < pod.drop_version,
            }
            for m in members
        ],
        "invites": [
            {
                "id": str(i.id),
                "code": i.code,
                "label": i.label,
                "status": i.status,
                "expires_at": i.expires_at.isoformat(),
                "created_at": i.created_at.isoformat(),
            }
            for i in invites
        ],
        "farms": _farms_out(farms),
    }
    db.commit()
    return out


# --- Invites -------------------------------------------------------------------------------


def _new_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


def create_invite(db: Session, customer_id, pod_id: str, label: str | None) -> dict:
    pod, _ = _pod_i_host(db, pod_id, customer_id)
    now = _now()
    if pod.latitude is None:
        db.rollback()
        raise _conflict("Choose a new drop point first, so your neighbors know where to collect.")
    count = len(_members(db, pod.id))
    if count >= SIZE_CAP:
        db.rollback()
        raise _conflict(f"Your pod is full: {SIZE_CAP} members, including you.")
    open_invites = db.query(func.count(PodInvite.id)).filter(PodInvite.pod_id == pod.id, PodInvite.status == "sent").scalar()
    if open_invites >= _MAX_OPEN_INVITES:
        db.rollback()
        raise _conflict("You have a lot of invites waiting. Withdraw some, or wait for answers.")

    invite = PodInvite(
        id=uuid.uuid4(),
        pod_id=pod.id,
        code=_new_code(),
        label=(label or "").strip() or None,
        status="sent",
        expires_at=now + INVITE_TTL,
        created_at=now,
    )
    db.add(invite)
    if pod.status == "draft":
        pod.status, pod.first_invite_at = "pending", now
    db.commit()
    return {
        "id": str(invite.id),
        "code": invite.code,
        "label": invite.label,
        "status": invite.status,
        "expires_at": invite.expires_at.isoformat(),
        "created_at": invite.created_at.isoformat(),
    }


def revoke_invite(db: Session, customer_id, pod_id: str, invite_id: str) -> dict:
    pod, _ = _pod_i_host(db, pod_id, customer_id)
    try:
        iid = uuid.UUID(invite_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    invite = db.query(PodInvite).filter(PodInvite.id == iid, PodInvite.pod_id == pod.id).first()
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status != "sent":
        db.rollback()
        raise _conflict("That invite has already been answered or has run out.")
    invite.status, invite.responded_at = "revoked", _now()
    db.commit()
    return get_pod(db, customer_id, pod_id)


def _invite_by_code(db: Session, code: str, lock: bool = False) -> tuple[PodInvite, Pod]:
    invite = db.query(PodInvite).filter(PodInvite.code == code.strip().upper()).first()
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="We can't find that invite. Check the code.")
    q = db.query(Pod).filter(Pod.id == invite.pod_id)
    pod = (q.with_for_update() if lock else q).one()
    return invite, pod


def _eligibility_problem(db: Session, invite: PodInvite, pod: Pod, customer: CustomerProfile) -> str | None:
    """Checked when someone answers, not when the invite goes out: the host
    doesn't know their neighbors' accounts. Harvest Pass is reported apart."""
    if invite.status == "accepted":
        return "This invite has already been used."
    if invite.status == "revoked" or pod.status in _ENDED:
        return "This invite isn't active any more."
    if invite.status == "expired":
        return "This invite has run out. Ask your neighbor for a new one."
    if invite.status == "declined":
        return "You've already answered this invite."
    if _member_of(db, pod.id, customer.id) is not None:
        return "You're already in this pod."
    count = db.query(func.count(PodMember.id)).filter(PodMember.pod_id == pod.id, PodMember.status == "active").scalar()
    if count >= SIZE_CAP:
        return "This pod is full."
    declined = (
        db.query(PodInvite.id)
        .join(Pod, Pod.id == PodInvite.pod_id)
        .filter(
            Pod.host_id == pod.host_id,
            PodInvite.invitee_id == customer.id,
            PodInvite.status == "declined",
            PodInvite.responded_at > _now() - REINVITE_COOLDOWN,
        )
        .first()
    )
    if declined:
        return "You declined this neighbor's invite recently, so this one can't be used yet."
    in_same_day = (
        db.query(PodMember.id)
        .filter(
            PodMember.customer_id == customer.id,
            PodMember.status == "active",
            PodMember.delivery_weekday == pod.delivery_weekday,
        )
        .first()
    )
    if in_same_day:
        return f"You're already in a pod that delivers on {_WEEKDAYS[pod.delivery_weekday]}s."
    return _distance_problem(customer, pod)


def preview_invite(db: Session, customer: CustomerProfile, code: str) -> dict:
    """The accept screen. The street address only for someone within the
    radius of it: a forwarded link shouldn't tell a stranger where the host
    lives."""
    invite, pod = _invite_by_code(db, code, lock=True)
    notices = _advance(db, pod)
    _commit_and_announce(db, notices)
    invite, pod = _invite_by_code(db, code)
    problem = _eligibility_problem(db, invite, pod, customer)
    nearby = _distance_problem(customer, pod) is None
    needs_pass = not has_member_benefits(db, customer.id)
    count = db.query(func.count(PodMember.id)).filter(PodMember.pod_id == pod.id, PodMember.status == "active").scalar()
    # What they'd pay once they've joined.
    households = count if _member_of(db, pod.id, customer.id) else count + 1
    farms = (
        delivery_service.pod_farms_near(db, pod.latitude, pod.longitude, pod.delivery_weekday, households=max(households, MIN_MEMBERS))
        if pod.latitude is not None
        else []
    )
    drop_line = _address_line(pod) if nearby else None
    return {
        "status": invite.status,
        "host_first_name": _first_name(db, pod.host_id),
        "pod_name": pod.name,
        "pod_status": pod.status,
        "delivery_day": _WEEKDAYS[pod.delivery_weekday],
        "drop_line": drop_line or (f"Near {pod.address_city}, {pod.address_state}" if pod.address_city else "To be chosen"),
        "shelter_note": pod.shelter_note if nearby else None,
        "member_count": count,
        "size_cap": SIZE_CAP,
        "farms": _farms_out(farms),
        "can_accept": problem is None and not needs_pass,
        "blocker": problem,
        "needs_harvest_pass": needs_pass and problem is None,
    }


def accept_invite(db: Session, customer: CustomerProfile, code: str) -> dict:
    _require_benefits(db, customer.id, "join a pod")
    invite, pod = _invite_by_code(db, code, lock=True)
    before = _advance(db, pod)
    invite = db.query(PodInvite).filter(PodInvite.id == invite.id).populate_existing().one()
    problem = _eligibility_problem(db, invite, pod, customer)
    if problem:
        _commit_and_announce(db, before)
        raise _conflict(problem)

    now = _now()
    invite.status, invite.invitee_id, invite.responded_at = "accepted", customer.id, now
    db.add(
        PodMember(
            id=uuid.uuid4(),
            pod_id=pod.id,
            customer_id=customer.id,
            delivery_weekday=pod.delivery_weekday,
            approved_drop_version=pod.drop_version,
            joined_at=now,
        )
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _conflict(f"You're already in a pod that delivers on {_WEEKDAYS[pod.delivery_weekday]}s.")

    count = db.query(func.count(PodMember.id)).filter(PodMember.pod_id == pod.id, PodMember.status == "active").scalar()
    notices = before + [
        Notice(
            pod.host_id,
            "pod_member_joined",
            {**_ctx(pod), "first_name": _first_name(db, customer.id), "needed": max(MIN_MEMBERS - count, 0)},
            f"pod_member_joined:{invite.id}",
        )
    ]
    notices += _advance(db, pod, now)
    pod_id = str(pod.id)
    _commit_and_announce(db, notices)
    return get_pod(db, customer.id, pod_id)


def decline_invite(db: Session, customer: CustomerProfile, code: str) -> None:
    invite, pod = _invite_by_code(db, code, lock=True)
    before = _advance(db, pod)
    invite = db.query(PodInvite).filter(PodInvite.id == invite.id).populate_existing().one()
    if invite.status != "sent" or pod.status in _ENDED:
        _commit_and_announce(db, before)
        raise _conflict("This invite isn't waiting for an answer any more.")
    if customer.id == pod.host_id:
        _commit_and_announce(db, before)
        raise _conflict("This is your own pod's invite.")
    invite.status, invite.invitee_id, invite.responded_at = "declined", customer.id, _now()
    notices = before + [
        Notice(pod.host_id, "pod_invite_declined", {**_ctx(pod), "label": invite.label}, f"pod_invite_declined:{invite.id}")
    ]
    _commit_and_announce(db, notices)


# --- Membership changes --------------------------------------------------------------------


def leave_pod(db: Session, customer_id, pod_id: str) -> dict:
    """Takes effect after their open order, if they have one."""
    pod, member = _pod_i_am_in(db, pod_id, customer_id)
    if pod.host_id == customer_id:
        db.rollback()
        raise _conflict("Hand the pod to another member first, or end it.")
    now = _now()
    notices = _schedule_departure(db, pod, member, now, "left")
    notices += _advance(db, pod, now)
    _commit_and_announce(db, notices)
    return list_pods(db, customer_id)


def revoke_member(db: Session, customer_id, pod_id: str, member_id: str) -> dict:
    pod, _ = _pod_i_host(db, pod_id, customer_id)
    target = _target_member(db, pod, member_id)
    if target.customer_id == customer_id:
        db.rollback()
        raise _conflict("You can't remove yourself. Hand the pod to another member, or end it.")
    now = _now()
    notices = [Notice(target.customer_id, "pod_removed", _ctx(pod), f"pod_removed:{target.id}")]
    notices += _schedule_departure(db, pod, target, now, "revoked")
    notices += _advance(db, pod, now)
    _commit_and_announce(db, notices)
    return get_pod(db, customer_id, pod_id)


def _target_member(db: Session, pod: Pod, member_id: str) -> PodMember:
    try:
        mid = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    target = db.query(PodMember).filter(PodMember.id == mid, PodMember.pod_id == pod.id, PodMember.status == "active").first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return target


def transfer_host(db: Session, customer_id, pod_id: str, member_id: str, leave: bool) -> dict:
    pod, me = _pod_i_host(db, pod_id, customer_id)
    target = _target_member(db, pod, member_id)
    if target.customer_id == customer_id:
        db.rollback()
        raise _bad_request("Choose another member.")
    if target.leave_at is not None or not has_member_benefits(db, target.customer_id):
        db.rollback()
        raise _conflict("That member is leaving the pod. Choose someone else.")
    now = _now()
    notices = _hand_over(db, pod, target)
    if leave:
        notices += _schedule_departure(db, pod, me, now, "left")
    notices += _advance(db, pod, now)
    _commit_and_announce(db, notices)
    return list_pods(db, customer_id)


def update_drop_point(db: Session, customer: CustomerProfile, pod_id: str, payload) -> dict:
    """A new drop point changes what members agreed to, so each must approve
    it; whoever hasn't by the end of the cycle leaves. Orders that haven't left
    move with it, so it must be within range of every farm that has one. Once
    everyone has ordered for a date, or a farm has set off, it can't change.
    A pod with no drop point at all (its old host's home went with them) can
    always get a new one: orders fixed to the old address stay there."""
    pod, me = _pod_i_host(db, pod_id, customer.id)
    fixed = pod.drop_locked_date is not None or _on_its_way(db, pod.id)
    if fixed and pod.latitude is not None:
        when = f"for {pod.drop_locked_date:%b} {pod.drop_locked_date.day}" if pod.drop_locked_date else "on its way"
        db.rollback()
        raise _conflict(
            f"The drop point can't change now: orders are {'placed ' if pod.drop_locked_date else ''}{when}, "
            "and they'll be delivered there. You can change it after that."
        )
    drop = _resolve_drop(customer, payload)
    _check_drop_rules(customer, drop, payload)
    if not fixed:
        order_farms = {
            farmer_id
            for (farmer_id,) in db.query(StoreOrder.farmer_id).filter(
                StoreOrder.pod_id == pod.id, StoreOrder.status.in_(("pending_payment", "paid"))
            )
        }
        for farmer_id in order_farms:
            reachable, farm_name = delivery_service.within_delivery_radius(db, farmer_id, drop["latitude"], drop["longitude"])
            if not reachable:
                db.rollback()
                raise _bad_request(f"That's outside {farm_name}'s delivery range, and your pod has orders from them.")
    if not delivery_service.pod_farms_near(db, drop["latitude"], drop["longitude"], pod.delivery_weekday):
        db.rollback()
        raise _bad_request(f"No farm delivers to pods at this location on {_WEEKDAYS[pod.delivery_weekday]}s yet.")
    now = _now()
    _apply_drop(pod, drop, payload, now)
    pod.drop_version += 1
    me.approved_drop_version = pod.drop_version
    others = [m for m in _members(db, pod.id) if m.customer_id != customer.id]
    notices: list[Notice] = []
    if not fixed:
        for farmer_id in delivery_service.move_pod_orders(db, pod):
            notices.append(
                Notice(
                    farmer_id,
                    "pod_drop_moved",
                    {"pod_name": pod.name, "address_line": _address_line(pod)},
                    f"pod_drop_moved:{pod.id}:{pod.drop_version}:{farmer_id}",
                )
            )
    if others:
        pod.reapprove_by = cycle_end(pod.delivery_weekday, now)
        notices += _notices(
            others,
            "pod_drop_changed",
            {**_ctx(pod), "address_line": _address_line(pod), "reapprove_by": pod.reapprove_by},
            f"pod_drop_changed:{pod.id}:{pod.drop_version}",
        )
    notices += _advance(db, pod, now)
    _commit_and_announce(db, notices)
    return get_pod(db, customer.id, pod_id)


def reapprove_drop_point(db: Session, customer: CustomerProfile, pod_id: str) -> dict:
    pod, member = _pod_i_am_in(db, pod_id, customer.id)
    problem = _distance_problem(customer, pod)
    if problem:
        db.rollback()
        raise _conflict(problem)
    member.approved_drop_version = pod.drop_version
    if member.leave_reason == "no_reapproval":
        member.leave_at = member.leave_reason = None
    db.commit()
    return get_pod(db, customer.id, pod_id)


def dissolve_pod(db: Session, customer_id, pod_id: str) -> dict:
    pod, _ = _pod_i_host(db, pod_id, customer_id)
    notices = _end(db, pod, "dissolved", _now())
    _commit_and_announce(db, [n for n in notices if n.profile_id != customer_id])
    return list_pods(db, customer_id)


def leave_all_for_deletion(db: Session, customer_id) -> None:
    """Before an account is deleted. deletion_blockers has already made sure
    they have no open orders and aren't hosting anyone else."""
    now = _now()
    rows = db.query(PodMember).filter(PodMember.customer_id == customer_id, PodMember.status == "active").all()
    notices: list[Notice] = []
    for member in rows:
        pod = db.query(Pod).filter(Pod.id == member.pod_id).with_for_update().one()
        if pod.host_id == customer_id:
            notices += [n for n in _end(db, pod, "dissolved", now) if n.profile_id != customer_id]
        else:
            notices += _schedule_departure(db, pod, member, now, "left")
            member.status, member.left_at = "left", now
            db.flush()
            notices += _advance(db, pod, now)
    _commit_and_announce(db, notices)


# --- Scheduled job --------------------------------------------------------------------------


def run_jobs(db: Session) -> dict:
    now = _now()
    live_ids = [
        pod_id
        for (pod_id,) in db.query(Pod.id).filter(
            (Pod.status.notin_(_ENDED)) | (Pod.address_street.isnot(None))
        )
    ]
    advanced = 0
    for pod_id in live_ids:
        pod = db.query(Pod).filter(Pod.id == pod_id).with_for_update().first()
        if pod is None:
            continue
        _commit_and_announce(db, _advance(db, pod, now))
        advanced += 1
    return {**charging.run(db), "pods_checked": advanced, "pods_regeocoded": _refresh_stale_locations(db)}


def _refresh_stale_locations(db: Session, limit: int = 100) -> int:
    """Google's coordinates may only be kept 30 days (app/core/geocoding.py). A
    home drop point is refreshed like any address; if a lookup fails the old
    point stays for now and it's tried again on the next run's day."""
    pods = (
        db.query(Pod)
        .filter(Pod.status.notin_(_ENDED), Pod.geocoded_at < _now() - REFRESH_AFTER)
        .order_by(Pod.geocoded_at)
        .limit(limit)
        .all()
    )
    for pod in pods:
        result = geocode_address(pod.address_street, pod.address_city, pod.address_state, pod.address_zip)
        if result is not None and result.precision != ZIP:
            pod.latitude, pod.longitude, pod.location_precision = result.latitude, result.longitude, result.precision
        pod.geocoded_at = _now()
        db.commit()
    return len(pods)
