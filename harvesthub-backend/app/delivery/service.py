"""Farm delivery — the farm drives its own orders (0032_farm_delivery.sql).

  * Settings: a farm chooses whether it delivers, its fee (kept in full),
    radius from the farm, weekly windows (America/New_York wall-clock) and
    how long before a window orders close.
  * Options: which windows a customer can book from a farm — their saved,
    precisely-located address must be inside the radius.
  * Runs: once a delivery order is paid it becomes a stop on its window's
    run. The farmer starts the run (customers are told it's on the way, in
    route order), then marks each stop delivered — optionally with a photo
    of where it was left — which completes the order and its ledger entry.
    A stop that can't be delivered is cancelled and refunded through the
    farmer-cancel path in app/orders/service.py, which calls release_stop().
  * Live tracking (0033): while a run is in progress the farmer's phone
    reports its position; the customer whose stop is next sees it on a map
    with a rough arrival estimate. Only the latest point is kept, and it's
    cleared when the run completes.

Nothing here imports app/orders/service.py (it imports us).
"""
import logging
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core import supabase_admin
from app.core.geo import haversine_km
from app.core.geocoding import ZIP
from app.core.localtime import LOCAL_TZ, to_local, window_label
from app.core.models import Profile
from app.customers.models import CustomerProfile
from app.delivery.models import DeliveryRun, DeliveryStop, FarmDeliverySettings, FarmDeliveryWindow
from app.farmers.models import FarmerProfile
from app.notifications.service import Notice, notify_many
from app.orders.models import Order, StoreOrder, StoreOrderItem
from app.payouts import service as payouts_service

logger = logging.getLogger(__name__)

KM_PER_MILE = 1.609344
BOOKING_HORIZON_DAYS = 14
PHOTO_BUCKET = "delivery-photos"
PHOTO_RETENTION = timedelta(days=30)
_PHOTO_EXTENSIONS = ("jpg", "jpeg", "png", "heic")
_MAX_WINDOWS = 21

# Live tracking. A position older than this is shown as "last updated …".
LOCATION_STALE_AFTER = timedelta(minutes=3)
# Arrival estimate without a routing service: straight-line distance times a
# typical road-network detour, at a typical suburban driving speed. Rough —
# the app says "about".
_ROAD_FACTOR = 1.35
_AVERAGE_SPEED_KMH = 35.0

# Defaults for a farm that hasn't saved settings yet (match 0032's).
DEFAULT_FEE = 5.00
DEFAULT_RADIUS_MILES = 10.0
DEFAULT_CUTOFF_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _money(value) -> float:
    return round(float(value or 0), 2)


# --- Settings (the farmer's Delivery settings screen) ------------------------------------


def _windows(db: Session, farmer_id) -> list[FarmDeliveryWindow]:
    return (
        db.query(FarmDeliveryWindow)
        .filter(FarmDeliveryWindow.farmer_id == farmer_id)
        .order_by(FarmDeliveryWindow.weekday, FarmDeliveryWindow.start_time)
        .all()
    )


def get_settings(db: Session, farmer_id) -> dict:
    s = db.get(FarmDeliverySettings, farmer_id)
    farmer = db.get(FarmerProfile, farmer_id)
    return {
        "offers_delivery": bool(s and s.offers_delivery),
        "delivery_fee": _money(s.delivery_fee) if s else DEFAULT_FEE,
        "radius_miles": float(s.radius_miles) if s else DEFAULT_RADIUS_MILES,
        "cutoff_hours": s.cutoff_hours if s else DEFAULT_CUTOFF_HOURS,
        "windows": [
            {"weekday": w.weekday, "start_time": w.start_time.strftime("%H:%M"), "end_time": w.end_time.strftime("%H:%M")}
            for w in _windows(db, farmer_id)
        ],
        # Radius checks are measured from the farm, so it must be on the map.
        "farm_located": farmer is not None and farmer.latitude is not None,
    }


def _parse_time(value: str) -> time:
    if not re.fullmatch(r"\d{2}:\d{2}", value or ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{value}' isn't a time like 16:00.")
    hour, minute = int(value[:2]), int(value[3:])
    if hour > 23 or minute > 59:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{value}' isn't a time like 16:00.")
    return time(hour, minute)


def update_settings(
    db: Session,
    farmer_id,
    offers_delivery: bool,
    delivery_fee: float,
    radius_miles: float,
    cutoff_hours: int,
    windows: list[dict],
) -> dict:
    """Saves the whole Delivery settings screen at once; windows replace the
    old ones. Runs keep the times they were booked for, so changing windows
    never moves an order that's already placed."""
    parsed: list[tuple[int, time, time]] = []
    for w in windows:
        start, end = _parse_time(w["start_time"]), _parse_time(w["end_time"])
        if end <= start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each delivery window must end after it starts.")
        parsed.append((int(w["weekday"]), start, end))
    parsed = sorted(set(parsed))
    if len(parsed) > _MAX_WINDOWS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Up to {_MAX_WINDOWS} delivery windows.")
    for (day_a, start_a, end_a), (day_b, start_b, _) in zip(parsed, parsed[1:]):
        if day_a == day_b and start_b < end_a:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two delivery windows on the same day overlap.")

    if offers_delivery:
        if not parsed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add at least one delivery window to offer delivery.")
        farmer = db.get(FarmerProfile, farmer_id)
        if farmer is None or farmer.latitude is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="We couldn't place your farm's address on the map yet. Check it in your farm profile, then try again.",
            )

    s = db.get(FarmDeliverySettings, farmer_id)
    if s is None:
        s = FarmDeliverySettings(farmer_id=farmer_id)
        db.add(s)
    s.offers_delivery = offers_delivery
    s.delivery_fee = round(delivery_fee, 2)
    s.radius_miles = round(radius_miles, 1)
    s.cutoff_hours = cutoff_hours

    db.query(FarmDeliveryWindow).filter(FarmDeliveryWindow.farmer_id == farmer_id).delete()
    for weekday, start, end in parsed:
        db.add(FarmDeliveryWindow(id=uuid.uuid4(), farmer_id=farmer_id, weekday=weekday, start_time=start, end_time=end))
    db.commit()
    return get_settings(db, farmer_id)


# --- What a customer can book ------------------------------------------------------------


def _upcoming_slots(windows: list[FarmDeliveryWindow], cutoff_hours: int, now: datetime) -> list[tuple[datetime, datetime]]:
    """Window occurrences in the next two weeks that still take orders."""
    today = to_local(now).date()
    slots = []
    for offset in range(BOOKING_HORIZON_DAYS + 1):
        day: date = today + timedelta(days=offset)
        for w in windows:
            if w.weekday != day.weekday():
                continue
            starts_at = datetime.combine(day, w.start_time, tzinfo=LOCAL_TZ)
            ends_at = datetime.combine(day, w.end_time, tzinfo=LOCAL_TZ)
            if starts_at - timedelta(hours=cutoff_hours) > now:
                slots.append((starts_at, ends_at))
    return sorted(slots)


def _address_line(street, city, state, zip_code) -> str:
    return ", ".join(p for p in (street, city, f"{state or ''} {zip_code or ''}".strip()) if p)


def _unavailable_reason(farmer: FarmerProfile | None, s: FarmDeliverySettings | None, customer: CustomerProfile | None) -> str | None:
    if farmer is None or s is None or not s.offers_delivery or farmer.latitude is None:
        return "This farm doesn't deliver yet."
    if customer is None or customer.latitude is None or customer.location_precision == ZIP:
        return "We couldn't pinpoint your address for delivery. Check it in Edit Profile."
    miles = haversine_km(farmer.latitude, farmer.longitude, customer.latitude, customer.longitude) / KM_PER_MILE
    if miles > float(s.radius_miles):
        return f"Your address is outside {farmer.farm_name}'s {float(s.radius_miles):g}-mile delivery area."
    return None


def delivery_options(db: Session, customer_id, farmer_ids: list[str]) -> list[dict]:
    """For the cart: per farm, can this customer get delivery, for how much,
    and in which windows."""
    customer = db.get(CustomerProfile, customer_id)
    now = _now()
    out = []
    for farmer_id in dict.fromkeys(farmer_ids):  # unique, in order
        try:
            fid = uuid.UUID(farmer_id)
        except ValueError:
            continue
        farmer = db.get(FarmerProfile, fid)
        s = db.get(FarmDeliverySettings, fid)
        reason = _unavailable_reason(farmer, s, customer)
        slots = [] if reason else _upcoming_slots(_windows(db, fid), s.cutoff_hours, now)
        if not reason and not slots:
            reason = "No delivery times in the next two weeks."
        out.append(
            {
                "farmer_id": farmer_id,
                "offers_delivery": bool(s and s.offers_delivery),
                "available": reason is None,
                "reason": reason,
                "delivery_fee": _money(s.delivery_fee) if s else 0.0,
                "address_line": _address_line(
                    customer.address_street, customer.address_city, customer.address_state, customer.address_zip
                )
                if customer
                else "",
                "slots": [
                    {"starts_at": a.isoformat(), "ends_at": b.isoformat(), "label": window_label(a, b)} for a, b in slots[:12]
                ],
            }
        )
    return out


def check_slot(db: Session, farmer_id: str, customer_id, starts_at: str | None) -> dict:
    """Checkout's validation of a chosen window. Returns the window and fee,
    or an 'error' for the customer — never raises, so one farm's problem
    doesn't break the whole preview (create_order refuses it instead)."""
    try:
        fid = uuid.UUID(farmer_id)
    except ValueError:
        return {"error": "This farm doesn't deliver yet."}
    farmer = db.get(FarmerProfile, fid)
    s = db.get(FarmDeliverySettings, fid)
    customer = db.get(CustomerProfile, customer_id)
    reason = _unavailable_reason(farmer, s, customer)
    if reason:
        return {"error": reason}
    if not starts_at:
        return {"error": "Choose a delivery time.", "delivery_fee": _money(s.delivery_fee)}
    try:
        wanted = datetime.fromisoformat(starts_at)
    except ValueError:
        wanted = None
    for a, b in _upcoming_slots(_windows(db, fid), s.cutoff_hours, _now()):
        if wanted is not None and wanted.tzinfo is not None and a == wanted:
            return {
                "starts_at": a,
                "ends_at": b,
                "label": window_label(a, b),
                "delivery_fee": _money(s.delivery_fee),
                "address_line": _address_line(
                    customer.address_street, customer.address_city, customer.address_state, customer.address_zip
                ),
            }
    return {"error": "That delivery time isn't available anymore. Pick another one.", "delivery_fee": _money(s.delivery_fee)}


# --- Runs and stops ------------------------------------------------------------------------


def attach_to_run(db: Session, store_order: StoreOrder, customer_id) -> None:
    """Once a delivery order is paid: add it to its window's run as a stop.
    Does NOT commit (runs inside the payment-success transaction)."""
    if store_order.fulfillment_method != "delivery" or store_order.delivery_stop_id or not store_order.delivery_window_starts_at:
        return
    db.execute(
        pg_insert(DeliveryRun)
        .values(
            id=uuid.uuid4(),
            farmer_id=store_order.farmer_id,
            provider="farm",
            window_starts_at=store_order.delivery_window_starts_at,
            window_ends_at=store_order.delivery_window_ends_at,
            status="scheduled",
        )
        .on_conflict_do_nothing(index_elements=["farmer_id", "window_starts_at"])
    )
    run = (
        db.query(DeliveryRun)
        .filter(DeliveryRun.farmer_id == store_order.farmer_id, DeliveryRun.window_starts_at == store_order.delivery_window_starts_at)
        .with_for_update()
        .one()
    )
    customer = db.get(CustomerProfile, customer_id)
    stop = DeliveryStop(
        id=uuid.uuid4(),
        run_id=run.id,
        kind="home",
        latitude=customer.latitude if customer else None,
        longitude=customer.longitude if customer else None,
        status="pending",
    )
    # Rare: paid just as (or after) the farm set off — join the run en route,
    # at the end of the route.
    if run.status in ("in_progress", "completed"):
        run.status, run.completed_at = "in_progress", None
        last = db.query(func.max(DeliveryStop.sequence)).filter(DeliveryStop.run_id == run.id).scalar() or 0
        stop.status, stop.sequence = "en_route", last + 1
        store_order.status = "out_for_delivery"
    db.add(stop)
    db.flush()
    store_order.delivery_stop_id = stop.id


def _owned_run(db: Session, farmer_id, run_id: str, lock: bool = False) -> DeliveryRun:
    try:
        rid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery run not found")
    q = db.query(DeliveryRun).filter(DeliveryRun.id == rid, DeliveryRun.farmer_id == farmer_id)
    run = (q.with_for_update() if lock else q).first()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery run not found")
    return run


def _stops(db: Session, run_id) -> list[DeliveryStop]:
    return (
        db.query(DeliveryStop)
        .filter(DeliveryStop.run_id == run_id)
        .order_by(DeliveryStop.sequence.asc().nullslast(), DeliveryStop.created_at)
        .all()
    )


def _can_start(run: DeliveryRun, stops: list[DeliveryStop]) -> bool:
    """From the morning of delivery day, once there's somewhere to go."""
    return (
        run.status == "scheduled"
        and to_local(_now()).date() >= to_local(run.window_starts_at).date()
        and any(s.status == "pending" for s in stops)
    )


def _run_summary(run: DeliveryRun, stops: list[DeliveryStop]) -> dict:
    live = [s for s in stops if s.status != "cancelled"]
    return {
        "id": str(run.id),
        "label": window_label(run.window_starts_at, run.window_ends_at),
        "starts_at": run.window_starts_at.isoformat(),
        "ends_at": run.window_ends_at.isoformat(),
        "status": run.status,
        "stop_count": len(live),
        "delivered_count": sum(1 for s in live if s.status == "delivered"),
        "can_start": _can_start(run, stops),
    }


def list_runs(db: Session, farmer_id) -> dict:
    """The farmer's Deliveries screen: what's coming up, and the last week."""
    week_ago = _now() - timedelta(days=7)
    runs = (
        db.query(DeliveryRun)
        .filter(
            DeliveryRun.farmer_id == farmer_id,
            (DeliveryRun.status != "completed") | (DeliveryRun.window_starts_at >= week_ago),
        )
        .order_by(DeliveryRun.window_starts_at)
        .all()
    )
    upcoming, recent = [], []
    for run in runs:
        summary = _run_summary(run, _stops(db, run.id))
        if summary["stop_count"] == 0 and run.status == "scheduled":
            continue  # every order on it was cancelled — nothing to drive to
        (recent if run.status == "completed" else upcoming).append(summary)
    recent.reverse()
    return {"upcoming": upcoming, "recent": recent}


def _orders_by_stop(db: Session, stop_ids: list) -> dict:
    if not stop_ids:
        return {}
    rows = (
        db.query(StoreOrder, Order, Profile)
        .join(Order, Order.id == StoreOrder.order_id)
        .join(Profile, Profile.id == Order.customer_id)
        .filter(StoreOrder.delivery_stop_id.in_(stop_ids))
        .all()
    )
    items: dict = {}
    for item in db.query(StoreOrderItem).filter(StoreOrderItem.store_order_id.in_([so.id for so, _, _ in rows])).all():
        items.setdefault(item.store_order_id, []).append(item)
    out: dict = {}
    for so, order, customer in rows:
        out.setdefault(so.delivery_stop_id, []).append((so, order, customer, items.get(so.id, [])))
    return out


def get_run(db: Session, farmer_id, run_id: str) -> dict:
    run = _owned_run(db, farmer_id, run_id)
    stops = _stops(db, run.id)
    orders = _orders_by_stop(db, [s.id for s in stops])
    out_stops = []
    for s in stops:
        entries = orders.get(s.id, [])
        first = entries[0][0] if entries else None
        active = s.status in ("pending", "en_route")
        out_stops.append(
            {
                "id": str(s.id),
                "sequence": s.sequence,
                "status": s.status,
                # Where to go — only while there's still a delivery to make.
                "address_line": _address_line(
                    first.delivery_address_street, first.delivery_address_city, first.delivery_address_state, first.delivery_address_zip
                )
                if first and active
                else None,
                "latitude": s.latitude if active else None,
                "longitude": s.longitude if active else None,
                "delivered_at": s.delivered_at.isoformat() if s.delivered_at else None,
                "has_photo": bool(s.photo_path),
                "note": s.note,
                "orders": [
                    {
                        "store_order_id": str(so.id),
                        "status": so.status,
                        "customer_name": customer.full_name,
                        # Only while there's still a delivery to coordinate.
                        "customer_phone": customer.phone if active else None,
                        "items": [{"product_name": i.product_name, "quantity": i.quantity, "unit": i.unit} for i in its],
                        "total": _money(so.total),
                        "service_fee": _money(so.service_fee),
                    }
                    for so, _, customer, its in entries
                ],
            }
        )
    return {**_run_summary(run, stops), "stops": out_stops}


def _route(origin: tuple[float, float] | None, stops: list[DeliveryStop]) -> list[DeliveryStop]:
    """Nearest-next ordering from the farm — a sensible route for a handful
    of stops without a routing service. Stops without coordinates go last."""
    remaining = [s for s in stops if s.latitude is not None and s.longitude is not None]
    unplaced = [s for s in stops if s.latitude is None or s.longitude is None]
    ordered: list[DeliveryStop] = []
    here = origin
    while remaining:
        if here is None:
            nxt = remaining[0]
        else:
            nxt = min(remaining, key=lambda s: haversine_km(here[0], here[1], s.latitude, s.longitude))
        ordered.append(nxt)
        remaining.remove(nxt)
        here = (nxt.latitude, nxt.longitude)
    return ordered + unplaced


def _customer_of(db: Session, store_order: StoreOrder):
    return db.query(Order.customer_id).filter(Order.id == store_order.order_id).scalar()


def _next_stop_notices(db: Session, run: DeliveryRun) -> list[Notice]:
    """'You're next' for the customer(s) at the first stop still to visit."""
    if run.status != "in_progress":
        return []
    nxt = (
        db.query(DeliveryStop)
        .filter(DeliveryStop.run_id == run.id, DeliveryStop.status == "en_route")
        .order_by(DeliveryStop.sequence.asc().nullslast())
        .first()
    )
    if not nxt:
        return []
    notices = []
    for so in db.query(StoreOrder).filter(StoreOrder.delivery_stop_id == nxt.id, StoreOrder.status == "out_for_delivery"):
        notices.append(
            Notice(
                _customer_of(db, so),
                "delivery_next",
                {"farm_name": so.farm_name, "order_id": str(so.order_id)},
                f"delivery_next:{so.id}",
            )
        )
    return notices


def start_run(db: Session, farmer_id, run_id: str) -> dict:
    run = _owned_run(db, farmer_id, run_id, lock=True)
    stops = _stops(db, run.id)
    if not _can_start(run, stops):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This run can't start yet — runs start on their delivery day."
            if run.status == "scheduled"
            else "This run has already started.",
        )
    farmer = db.get(FarmerProfile, farmer_id)
    origin = (farmer.latitude, farmer.longitude) if farmer and farmer.latitude is not None else None
    route = _route(origin, [s for s in stops if s.status == "pending"])
    for position, stop in enumerate(route, start=1):
        stop.sequence, stop.status = position, "en_route"
    stop_ids = [s.id for s in route]
    on_run = (
        db.query(StoreOrder).filter(StoreOrder.delivery_stop_id.in_(stop_ids), StoreOrder.status == "paid").all()
        if stop_ids
        else []
    )
    for so in on_run:
        so.status = "out_for_delivery"
    run.status, run.started_at = "in_progress", _now()
    db.commit()

    position_by_stop = {s.id: s.sequence for s in route}
    notices = [
        Notice(
            _customer_of(db, so),
            "out_for_delivery",
            {"farm_name": so.farm_name, "order_id": str(so.order_id), "stops_before": position_by_stop[so.delivery_stop_id] - 1},
            f"out_for_delivery:{so.id}",
        )
        for so in on_run
        if position_by_stop.get(so.delivery_stop_id, 1) > 1
    ]
    notify_many(db, notices + _next_stop_notices(db, run))
    return get_run(db, farmer_id, run_id)


def _finish_if_done(db: Session, run: DeliveryRun) -> None:
    db.flush()  # autoflush is off — the caller's stop change must count below
    left = (
        db.query(func.count(DeliveryStop.id))
        .filter(DeliveryStop.run_id == run.id, DeliveryStop.status.in_(("pending", "en_route")))
        .scalar()
    )
    if run.status == "in_progress" and not left:
        run.status, run.completed_at = "completed", _now()
        _clear_location(run)


def _clear_location(run: DeliveryRun) -> None:
    run.current_latitude = run.current_longitude = run.current_heading = None
    run.location_updated_at = None


def record_location(db: Session, farmer_id, run_id: str, latitude: float, longitude: float, heading: float | None) -> None:
    """The farmer's phone, every ~15 s during a run (also in the background).
    Only the latest point is kept. Refused once the run isn't in progress —
    the app stops sharing when it sees that."""
    run = _owned_run(db, farmer_id, run_id)
    if run.status != "in_progress":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This run isn't in progress, so there's nothing to share.")
    run.current_latitude, run.current_longitude = latitude, longitude
    run.current_heading = heading
    run.location_updated_at = _now()
    db.commit()


def mark_delivered(db: Session, farmer_id, run_id: str, stop_id: str, photo_path: str | None, note: str | None) -> dict:
    run = _owned_run(db, farmer_id, run_id, lock=True)
    try:
        sid = uuid.UUID(stop_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stop not found")
    stop = db.query(DeliveryStop).filter(DeliveryStop.id == sid, DeliveryStop.run_id == run.id).with_for_update().first()
    if not stop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stop not found")
    if stop.status != "en_route":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Start the run before marking stops delivered.")
    if photo_path:
        # Only a photo in this farmer's own folder, named for this stop.
        prefix = f"{farmer_id}/{stop.id}."
        if not photo_path.startswith(prefix) or photo_path[len(prefix):].lower() not in _PHOTO_EXTENSIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That photo wasn't uploaded for this stop.")

    stop.status, stop.delivered_at = "delivered", _now()
    stop.photo_path = photo_path or None
    stop.note = (note or "").strip()[:300] or None
    delivered = db.query(StoreOrder).filter(StoreOrder.delivery_stop_id == stop.id, StoreOrder.status == "out_for_delivery").all()
    for so in delivered:
        so.status = "completed"
        payouts_service.create_ledger_entry_for_completion(db, so)
    _finish_if_done(db, run)
    db.commit()

    notices = [
        Notice(
            _customer_of(db, so),
            "delivered",
            {"farm_name": so.farm_name, "order_id": str(so.order_id), "has_photo": bool(stop.photo_path), "note": stop.note},
            f"delivered:{so.id}",
        )
        for so in delivered
    ]
    notify_many(db, notices + _next_stop_notices(db, run))
    return get_run(db, farmer_id, run_id)


def release_stop(db: Session, store_order: StoreOrder) -> DeliveryRun | None:
    """A delivery order was cancelled (by the customer before it left, or by
    the farm — "couldn't deliver"): its stop is off the route unless another
    order still shares it. Does NOT commit. Returns the run, for
    notify_after_release() once the caller has committed."""
    if not store_order.delivery_stop_id:
        return None
    stop = db.get(DeliveryStop, store_order.delivery_stop_id)
    if stop is None:
        return None
    db.flush()  # the caller's status change must be visible below
    others = (
        db.query(func.count(StoreOrder.id))
        .filter(StoreOrder.delivery_stop_id == stop.id, StoreOrder.status != "cancelled")
        .scalar()
    )
    if not others and stop.status in ("pending", "en_route"):
        stop.status = "cancelled"
    run = db.get(DeliveryRun, stop.run_id)
    _finish_if_done(db, run)
    return run


def notify_after_release(db: Session, run: DeliveryRun | None) -> None:
    if run is not None:
        notify_many(db, _next_stop_notices(db, run))


# --- The customer's view ------------------------------------------------------------------


def progress_for(db: Session, store_order: StoreOrder) -> dict | None:
    """Delivery details for the customer's order screen."""
    if store_order.fulfillment_method != "delivery" or not store_order.delivery_window_starts_at:
        return None
    stop = db.get(DeliveryStop, store_order.delivery_stop_id) if store_order.delivery_stop_id else None
    if store_order.status == "cancelled":
        stage = "cancelled"
    elif stop is not None and stop.status == "delivered":
        stage = "delivered"
    elif stop is not None and stop.status == "en_route":
        stage = "on_the_way"
    else:
        stage = "scheduled"
    stops_before = None
    if stage == "on_the_way" and stop.sequence is not None:
        stops_before = (
            db.query(func.count(DeliveryStop.id))
            .filter(
                DeliveryStop.run_id == stop.run_id,
                DeliveryStop.status == "en_route",
                DeliveryStop.sequence < stop.sequence,
            )
            .scalar()
        )
    return {
        "window_label": window_label(store_order.delivery_window_starts_at, store_order.delivery_window_ends_at),
        "window_starts_at": store_order.delivery_window_starts_at.isoformat(),
        "window_ends_at": store_order.delivery_window_ends_at.isoformat(),
        "stage": stage,
        "stops_before": stops_before,
        "delivered_at": stop.delivered_at.isoformat() if stop is not None and stop.delivered_at else None,
        "has_photo": bool(stop is not None and stop.photo_path),
        "note": stop.note if stop is not None else None,
    }


def tracking_for(db: Session, store_order: StoreOrder) -> dict | None:
    """What the customer's order screen polls while a delivery is on its way.
    The farmer's live position — and the arrival estimate — only for the
    customer who's NEXT: before that it's just "N stops before yours", so no
    one can watch the farmer stop at other customers' homes."""
    progress = progress_for(db, store_order)
    if progress is None:
        return None
    out = {
        "stage": progress["stage"],
        "stops_before": progress["stops_before"],
        "farmer": None,
        "destination": None,
        "eta_minutes": None,
    }
    if progress["stage"] != "on_the_way" or progress["stops_before"] != 0:
        return out
    stop = db.get(DeliveryStop, store_order.delivery_stop_id)
    run = db.get(DeliveryRun, stop.run_id)
    if run.current_latitude is None or run.location_updated_at is None:
        return out  # started, but the phone hasn't reported yet

    out["farmer"] = {
        "latitude": run.current_latitude,
        "longitude": run.current_longitude,
        "heading": run.current_heading,
        "updated_at": run.location_updated_at.isoformat(),
        "stale": _now() - run.location_updated_at > LOCATION_STALE_AFTER,
    }
    if stop.latitude is not None and stop.longitude is not None:
        # Their own stop — fine to show them.
        out["destination"] = {"latitude": stop.latitude, "longitude": stop.longitude}
        km = haversine_km(run.current_latitude, run.current_longitude, stop.latitude, stop.longitude) * _ROAD_FACTOR
        out["eta_minutes"] = max(1, round(km / _AVERAGE_SPEED_KMH * 60))
    return out


def photo_url(db: Session, store_order: StoreOrder) -> str | None:
    """A one-hour link to the proof-of-delivery photo (private bucket)."""
    stop = db.get(DeliveryStop, store_order.delivery_stop_id) if store_order.delivery_stop_id else None
    if stop is None or not stop.photo_path or not supabase_admin.is_configured():
        return None
    try:
        return supabase_admin.create_signed_url(PHOTO_BUCKET, stop.photo_path, expires_in=3600)
    except supabase_admin.SupabaseAdminError as e:
        logger.warning("Could not sign delivery photo: %s", e)
        return None


# --- Housekeeping ---------------------------------------------------------------------------


def customer_photo_paths(db: Session, customer_id) -> list[str]:
    """Photos of a customer's doorstep — deleted with their account."""
    rows = (
        db.query(DeliveryStop.photo_path)
        .join(StoreOrder, StoreOrder.delivery_stop_id == DeliveryStop.id)
        .join(Order, Order.id == StoreOrder.order_id)
        .filter(Order.customer_id == customer_id, DeliveryStop.photo_path.isnot(None))
        .all()
    )
    return [p for (p,) in rows]


def purge_old_photos(db: Session, limit: int = 100) -> int:
    """Scheduled job: delivery photos are only kept 30 days."""
    if not supabase_admin.is_configured():
        return 0
    stops = (
        db.query(DeliveryStop)
        .filter(DeliveryStop.photo_path.isnot(None), DeliveryStop.delivered_at < _now() - PHOTO_RETENTION)
        .limit(limit)
        .all()
    )
    if not stops:
        return 0
    try:
        supabase_admin.delete_storage_paths(PHOTO_BUCKET, [s.photo_path for s in stops])
    except supabase_admin.SupabaseAdminError as e:
        logger.warning("Could not delete old delivery photos: %s", e)
        return 0
    for s in stops:
        s.photo_path = None
    db.commit()
    return len(stops)
