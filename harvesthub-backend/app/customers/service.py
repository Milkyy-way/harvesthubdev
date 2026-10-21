from sqlalchemy.orm import Session
from datetime import datetime
from fastapi import Depends, HTTPException, status
from app.customers.models import CustomerProfile
from app.core.database import get_db
from app.core.geocoding import REFRESH_AFTER, geocode_address, needs_geocode
from app.core.security import get_current_user
from app.core.models import Profile

def _geocode(db: Session, profile: CustomerProfile) -> None:
    result = geocode_address(profile.address_street, profile.address_city, profile.address_state, profile.address_zip)
    if result is not None:
        profile.latitude, profile.longitude = result.latitude, result.longitude
        profile.location_precision = result.precision
    profile.geocoded_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)


def get_or_geocode_profile(db: Session, user_id: str) -> CustomerProfile:
    profile = db.query(CustomerProfile).filter(CustomerProfile.id == user_id).first()
    if not profile:
        raise ValueError("Customer profile not found")

    # geocoded_at (not latitude) is the "have we tried yet" marker — an
    # address that no geocoder can place still gets geocoded_at set, so it's
    # attempted once (and again monthly), not on every request. Changing the
    # address clears it (a trigger — see 0031_precise_locations.sql); so does
    # age: Google's coordinates may only be kept 30 days (app/core/geocoding.py).
    if needs_geocode(profile.geocoded_at):
        _geocode(db, profile)
    return profile


def refresh_stale_locations(db: Session, limit: int = 100) -> int:
    """Scheduled job: re-geocode homes before their coordinates turn 30 days
    old, oldest first — whether or not the customer has been back."""
    cutoff = datetime.utcnow() - REFRESH_AFTER
    profiles = (
        db.query(CustomerProfile)
        .filter(CustomerProfile.geocoded_at < cutoff)
        .order_by(CustomerProfile.geocoded_at)
        .limit(limit)
        .all()
    )
    for profile in profiles:
        _geocode(db, profile)
    return len(profiles)

def get_current_customer(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> CustomerProfile:
    profile = db.query(Profile).filter(Profile.id == user["id"]).first()
    if not profile or profile.role != "customer" or profile.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Customer account required")
    return get_or_geocode_profile(db, user["id"])