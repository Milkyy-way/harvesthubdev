from collections import defaultdict
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, status
from sqlalchemy import and_, exists
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.geo import haversine_km
from app.core.geocoding import REFRESH_AFTER, geocode_address, needs_geocode
from app.core.models import Profile
from app.farmers.models import FarmerProfile, FarmerCertification
from app.products.models import Product
from app.categories.models import Category
from app.ratings import service as ratings_service

# Spotlight ranking weights — a placeholder blend, not a researched
# formula: rating matters slightly more than raw proximity (a spotlight is
# meant to showcase good farms, not just the nearest ones), but nothing
# here is tuned against real usage yet. Adjust freely.
_SPOTLIGHT_RATING_WEIGHT = 0.6
_SPOTLIGHT_PROXIMITY_WEIGHT = 0.4
# A farmer with zero ratings yet gets this neutral score (slightly above
# the 1-5 midpoint) rather than being penalized for simply being new —
# distance ends up doing most of the ranking work until real ratings
# accumulate.
_SPOTLIGHT_NEUTRAL_RATING = 3.5
# Smooths proximity into a 0-1 score with no hard cutoff radius — a farm
# 10km away still gets half credit rather than being excluded outright.
_SPOTLIGHT_PROXIMITY_DECAY_KM = 10.0


def get_current_farmer(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> FarmerProfile:
    """The farmer-side twin of app/customers/service.py's
    get_current_customer: every /farmers/me/* endpoint requires an APPROVED
    farmer (profiles.status == 'active'). This is what actually enforces the
    farmer app's locked Products/Orders tabs — the app's locks are only UI."""
    profile = db.query(Profile).filter(Profile.id == user["id"]).first()
    if not profile or profile.role != "farmer" or profile.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approved farmer account required")
    farmer = db.query(FarmerProfile).filter(FarmerProfile.id == user["id"]).first()
    if not farmer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approved farmer account required")
    return farmer


def _geocode_farm(db: Session, farmer: FarmerProfile) -> None:
    result = geocode_address(farmer.address_street, farmer.address_city, farmer.address_state, farmer.address_zip)
    if result is not None:
        farmer.latitude, farmer.longitude = result.latitude, result.longitude
        farmer.location_precision = result.precision
    farmer.geocoded_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(farmer)


def get_or_geocode_farmer(db: Session, farmer_id: str) -> FarmerProfile:
    """Mirrors app/customers/service.py's get_or_geocode_profile() — same
    geocoder (app/core/geocoding.py), geocoded_at marked either way so a
    bad/ungeocodable address is attempted once (and again monthly), not on
    every feed request. A farm keeps its previous coordinates if a re-geocode
    finds nothing better."""
    farmer = db.query(FarmerProfile).filter(FarmerProfile.id == farmer_id).first()
    if farmer and needs_geocode(farmer.geocoded_at):
        _geocode_farm(db, farmer)
    return farmer


def refresh_stale_locations(db: Session, limit: int = 100) -> int:
    """Scheduled job: re-geocode farms before their coordinates turn 30 days
    old (Google's limit), oldest first — so the feed never has to."""
    cutoff = datetime.now(timezone.utc) - REFRESH_AFTER
    farms = (
        db.query(FarmerProfile)
        .filter(FarmerProfile.geocoded_at < cutoff)
        .order_by(FarmerProfile.geocoded_at)
        .limit(limit)
        .all()
    )
    for farmer in farms:
        _geocode_farm(db, farmer)
    return len(farms)


def list_farmer_feed(
    db: Session,
    customer_lat: float,
    customer_lon: float,
    category: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    q = (
        db.query(FarmerProfile)
        .join(Profile, Profile.id == FarmerProfile.id)
        .filter(Profile.role == "farmer", Profile.status == "active")
    )

    category_id = None
    if category:
        category_row = db.query(Category.id).filter(Category.slug == category).first()
        if category_row is None:
            return [], 0  # unknown slug — no matches, not a 500
        category_id = category_row.id
        q = q.filter(
            exists().where(
                and_(
                    Product.farmer_id == FarmerProfile.id,
                    Product.is_active.is_(True),
                    Product.category_id == category_id,
                )
            )
        )

    if search:
        like = f"%{search}%"
        q = q.filter(
            exists().where(
                and_(
                    Product.farmer_id == FarmerProfile.id,
                    Product.is_active.is_(True),
                    Product.name.ilike(like),
                )
            )
        )

    farmers = q.all()
    if not farmers:
        return [], 0

    # matched_categories: trivial for a category tap; for a search term,
    # the distinct category slugs among that farmer's matching active
    # products; empty when browsing with no filter (FarmerCard only
    # renders this caption when a filter is active).
    matched_by_farmer: dict = defaultdict(set)
    if search:
        farmer_ids = [f.id for f in farmers]
        rows = (
            db.query(Product.farmer_id, Category.slug)
            .join(Category, Category.id == Product.category_id)
            .filter(
                Product.farmer_id.in_(farmer_ids),
                Product.is_active.is_(True),
                Product.name.ilike(f"%{search}%"),
            )
            .distinct()
            .all()
        )
        for farmer_id, slug in rows:
            matched_by_farmer[farmer_id].add(slug)

    results = []
    for farmer in farmers:
        if needs_geocode(farmer.geocoded_at):
            farmer = get_or_geocode_farmer(db, farmer.id)
        if farmer is None or farmer.latitude is None or farmer.longitude is None:
            continue  # still ungeocoded (bad address / API down) — exclude, don't crash the feed

        distance = haversine_km(customer_lat, customer_lon, farmer.latitude, farmer.longitude)

        if category:
            matched = [category]
        elif search:
            matched = sorted(matched_by_farmer.get(farmer.id, []))
        else:
            matched = []

        results.append(
            {
                "id": str(farmer.id),
                "farm_name": farmer.farm_name,
                "photo_url": farmer.photo_url,
                "distance_km": round(distance, 2),
                "matched_categories": matched,
            }
        )

    results.sort(key=lambda r: r["distance_km"])
    total = len(results)
    return results[offset : offset + limit], total


def get_spotlight_farmers(
    db: Session, customer_lat: float, customer_lon: float, limit: int
) -> list[dict]:
    """Ranks active farmers by a blend of collective rating and distance —
    not distance alone (that's plain list_farmer_feed) and not rating
    alone (a great farm across town shouldn't bury every nearby one)."""
    farmers = (
        db.query(FarmerProfile)
        .join(Profile, Profile.id == FarmerProfile.id)
        .filter(Profile.role == "farmer", Profile.status == "active")
        .all()
    )
    if not farmers:
        return []

    summaries = ratings_service.get_rating_summaries(db, [f.id for f in farmers])

    scored = []
    for farmer in farmers:
        if needs_geocode(farmer.geocoded_at):
            farmer = get_or_geocode_farmer(db, farmer.id)
        if farmer is None or farmer.latitude is None or farmer.longitude is None:
            continue

        distance = haversine_km(customer_lat, customer_lon, farmer.latitude, farmer.longitude)
        avg_rating, rating_count = summaries.get(farmer.id, (None, 0))

        rating_score = ((avg_rating if avg_rating is not None else _SPOTLIGHT_NEUTRAL_RATING) - 1) / 4
        proximity_score = 1 / (1 + distance / _SPOTLIGHT_PROXIMITY_DECAY_KM)
        score = _SPOTLIGHT_RATING_WEIGHT * rating_score + _SPOTLIGHT_PROXIMITY_WEIGHT * proximity_score

        scored.append(
            {
                "id": str(farmer.id),
                "farm_name": farmer.farm_name,
                "photo_url": farmer.photo_url,
                "distance_km": round(distance, 2),
                "average_rating": avg_rating,
                "rating_count": rating_count,
                "_score": score,
            }
        )

    scored.sort(key=lambda r: r["_score"], reverse=True)
    for r in scored:
        del r["_score"]
    return scored[:limit]


def get_farmer_detail(
    db: Session,
    farmer_id: str,
    customer_lat: float | None,
    customer_lon: float | None,
) -> dict | None:
    """Powers the farm detail page's header (photo, location, bio,
    certifications) — visibility rule mirrors list_farmer_feed's (active
    farmers only), so a customer can't land on a suspended/unapproved
    farmer's page via a stale or hand-typed link."""
    farmer = (
        db.query(FarmerProfile)
        .join(Profile, Profile.id == FarmerProfile.id)
        .filter(FarmerProfile.id == farmer_id, Profile.role == "farmer", Profile.status == "active")
        .first()
    )
    if not farmer:
        return None

    if needs_geocode(farmer.geocoded_at):
        farmer = get_or_geocode_farmer(db, farmer.id)

    distance = None
    if farmer.latitude is not None and farmer.longitude is not None and customer_lat is not None and customer_lon is not None:
        distance = round(haversine_km(customer_lat, customer_lon, farmer.latitude, farmer.longitude), 2)

    certifications = (
        db.query(FarmerCertification).filter(FarmerCertification.farmer_id == farmer_id).all()
    )
    average_rating, rating_count = ratings_service.get_farmer_rating_summary(db, farmer.id)

    return {
        "id": str(farmer.id),
        "farm_name": farmer.farm_name,
        "photo_url": farmer.photo_url,
        "bio": farmer.bio,
        "address_city": farmer.address_city,
        "address_state": farmer.address_state,
        "distance_km": distance,
        "farm_types": farmer.farm_types or [],
        "years_in_operation": farmer.years_in_operation,
        "average_rating": average_rating,
        "rating_count": rating_count,
        "certifications": [
            {"cert_type": c.cert_type, "cert_name": c.cert_name} for c in certifications
        ],
    }
