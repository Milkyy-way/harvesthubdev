import uuid
from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ratings.models import FarmerRating
from app.ratings.schemas import SubmitRatingRequest


def get_rating_for_store_order(db: Session, store_order_id) -> FarmerRating | None:
    return db.query(FarmerRating).filter(FarmerRating.store_order_id == store_order_id).first()


def submit_rating(
    db: Session, customer_id, farmer_id, store_order_id, payload: SubmitRatingRequest
) -> FarmerRating:
    """Upserts by store_order_id — a customer can revise their rating on
    the same transaction rather than accumulating duplicates. Does NOT
    commit — the caller (app/orders/service.py) commits once."""
    existing = get_rating_for_store_order(db, store_order_id)
    if existing:
        existing.rating = payload.rating
        # Changing the stars without a comment keeps the comment already given.
        if "comment" in payload.model_fields_set:
            existing.comment = payload.comment
        existing.updated_at = datetime.utcnow()
        return existing

    rating = FarmerRating(
        id=uuid.uuid4(),
        customer_id=customer_id,
        farmer_id=farmer_id,
        store_order_id=store_order_id,
        rating=payload.rating,
        comment=payload.comment,
    )
    db.add(rating)
    return rating


def get_rating_summaries(db: Session, farmer_ids: list) -> dict:
    """One grouped query for many farmers at once — used by the spotlight
    ranking, which needs every candidate's summary, not one farmer's."""
    if not farmer_ids:
        return {}
    rows = (
        db.query(FarmerRating.farmer_id, func.avg(FarmerRating.rating), func.count(FarmerRating.id))
        .filter(FarmerRating.farmer_id.in_(farmer_ids))
        .group_by(FarmerRating.farmer_id)
        .all()
    )
    return {farmer_id: (round(float(avg), 1), count) for farmer_id, avg, count in rows}


def get_farmer_rating_summary(db: Session, farmer_id) -> tuple[float | None, int]:
    summaries = get_rating_summaries(db, [farmer_id])
    return summaries.get(farmer_id, (None, 0))
