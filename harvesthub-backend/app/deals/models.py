from datetime import datetime

from sqlalchemy import Boolean, Column, Date, Integer, Numeric, SmallInteger, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

# A deal customers can see, or will soon. Its stock is set aside (0036).
OPEN_STATUSES = ("scheduled", "early_access", "live")


class GroupDeal(Base):
    """A lower price that unlocks if enough households join by the deadline.
    Prices are per the listing's unit; a share is share_size of those units,
    so "2.5 lb bags at $1.80/lb" is share_size 2.5, unit lb, deal_price 1.80."""

    __tablename__ = "group_deals"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    product_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String, nullable=False, default="draft")

    # Copied from the listing, and frozen once the deal is published.
    unit = Column(String, nullable=False)
    regular_price = Column(Numeric(10, 2), nullable=False)

    share_size = Column(Numeric(8, 2), nullable=False, default=1)
    deal_price = Column(Numeric(10, 2), nullable=False)
    goal = Column(Integer, nullable=False)  # households
    capacity = Column(Integer, nullable=False)  # shares
    max_units = Column(SmallInteger, nullable=False, default=1)  # shares one household may claim
    subscriber_fallback = Column(Boolean, nullable=False, default=True)

    # None = open to members as soon as it's published.
    public_start_date = Column(Date, nullable=True)
    window_days = Column(SmallInteger, nullable=False, default=5)
    fulfillment_date = Column(Date, nullable=True)

    # Worked out when it's published.
    member_opens_at = Column(TIMESTAMP(timezone=True), nullable=True)
    public_opens_at = Column(TIMESTAMP(timezone=True), nullable=True)
    deadline_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # Listing units taken out of stock for this deal; 0 once they've gone back.
    reserved_quantity = Column(Integer, nullable=False, default=0)

    published_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cancelled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cancel_reason = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
