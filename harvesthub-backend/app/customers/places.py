"""Saved places, like Work: other points to browse nearby farms from.

Home is always the customer's own address, and isn't a row here. Choosing a place
changes which farms they see and how far away they read. It never changes where an
order goes: delivery always uses the address on their profile, because that's the
address its checks and the driver depend on.
"""
import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.geocoding import REFRESH_AFTER, geocode_address, needs_geocode
from app.customers.models import CustomerPlace, CustomerProfile
from app.customers.schemas import PlaceIn

MAX_PLACES = 5


def _out(place: CustomerPlace) -> dict:
    return {
        "id": str(place.id),
        "name": place.name,
        "address_line": ", ".join(
            p for p in (place.address_street, place.address_city, f"{place.address_state} {place.address_zip}") if p
        ),
    }


def _geocode(db: Session, place: CustomerPlace) -> None:
    """Google's coordinates may only be kept 30 days (app/core/geocoding.py). A
    failed refresh keeps the old point until the next try. Doesn't commit."""
    result = geocode_address(place.address_street, place.address_city, place.address_state, place.address_zip)
    if result is not None:
        place.latitude, place.longitude = result.latitude, result.longitude
    place.geocoded_at = datetime.utcnow()


def list_places(db: Session, customer: CustomerProfile) -> dict:
    places = db.query(CustomerPlace).filter(CustomerPlace.customer_id == customer.id).order_by(CustomerPlace.created_at).all()
    return {
        "active_place_id": str(customer.browse_place_id) if customer.browse_place_id else None,
        "home_city": customer.address_city,
        "max_places": MAX_PLACES,
        "places": [_out(p) for p in places],
    }


def add_place(db: Session, customer: CustomerProfile, payload: PlaceIn) -> dict:
    name = payload.name.strip()
    if name.lower() == "home":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Home is the address on your profile. You can change it in Edit Profile."
        )
    if db.query(CustomerPlace.id).filter(CustomerPlace.customer_id == customer.id).count() >= MAX_PLACES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"You can save up to {MAX_PLACES} places. Remove one first.")
    place = CustomerPlace(
        id=uuid.uuid4(),
        customer_id=customer.id,
        name=name,
        address_street=payload.address_street.strip(),
        address_city=payload.address_city.strip(),
        address_state=payload.address_state.strip(),
        address_zip=payload.address_zip.strip(),
    )
    _geocode(db, place)
    if place.latitude is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="We couldn't find that address. Check it and try again.")
    db.add(place)
    db.flush()
    customer.browse_place_id = place.id  # they just added it because they want to look there
    db.commit()
    return list_places(db, customer)


def _owned(db: Session, customer: CustomerProfile, place_id: str) -> CustomerPlace:
    try:
        pid = uuid.UUID(place_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    place = db.query(CustomerPlace).filter(CustomerPlace.id == pid, CustomerPlace.customer_id == customer.id).first()
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return place


def remove_place(db: Session, customer: CustomerProfile, place_id: str) -> dict:
    place = _owned(db, customer, place_id)
    if customer.browse_place_id == place.id:
        customer.browse_place_id = None
        db.flush()
    db.delete(place)
    db.commit()
    return list_places(db, customer)


def choose(db: Session, customer: CustomerProfile, place_id: str | None) -> dict:
    """None is Home."""
    customer.browse_place_id = _owned(db, customer, place_id).id if place_id else None
    db.commit()
    return list_places(db, customer)


def browse_point(db: Session, customer: CustomerProfile) -> tuple[float | None, float | None]:
    """Where to measure "nearby" from: the place they chose, otherwise home."""
    if customer.browse_place_id:
        place = db.get(CustomerPlace, customer.browse_place_id)
        if place is not None:
            if needs_geocode(place.geocoded_at):
                _geocode(db, place)
                db.commit()
            if place.latitude is not None:
                return place.latitude, place.longitude
    return customer.latitude, customer.longitude


def refresh_stale(db: Session, limit: int = 100) -> int:
    """Scheduled job, like homes: before the coordinates turn 30 days old."""
    cutoff = datetime.utcnow() - REFRESH_AFTER
    places = db.query(CustomerPlace).filter(CustomerPlace.geocoded_at < cutoff).order_by(CustomerPlace.geocoded_at).limit(limit).all()
    for place in places:
        _geocode(db, place)
    db.commit()
    return len(places)
