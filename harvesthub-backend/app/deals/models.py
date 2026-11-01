from datetime import datetime

from sqlalchemy import Boolean, Column, Date, Integer, Numeric, SmallInteger, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base

# A deal customers can see, or will soon. Its stock is set aside (0036).
OPEN_STATUSES = ("scheduled", "early_access", "live")

# A household's join on a deal. Started, waiting for the card -> active, counted
# -> withdrawn | ordered (the deal unlocked, or they took the regular-price
# offer) | not_charged (the deal missed or was cancelled).
PENDING_CARD = "pending_card"
ACTIVE = "active"
WITHDRAWN = "withdrawn"
ORDERED = "ordered"
NOT_CHARGED = "not_charged"

# A place on a full deal's waitlist. Waiting -> offered (a share is held for 2
# hours) -> claimed by joining | expired. Or left, or ended when the deal closes.
WAITING = "waiting"
OFFERED = "offered"
CLAIMED = "claimed"
OFFER_EXPIRED = "expired"
LEFT = "left"
ENDED = "ended"


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

    # Once, and only if the deal is close to its goal.
    extended_once = Column(Boolean, nullable=False, default=False)
    closed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # A missed deal: until then, members who joined can buy at the regular price.
    fallback_ends_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # When followers of the farm were told it had opened.
    members_told_at = Column(TIMESTAMP(timezone=True), nullable=True)
    public_told_at = Column(TIMESTAMP(timezone=True), nullable=True)

    published_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cancelled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cancel_reason = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class GroupCommit(Base):
    __tablename__ = "group_commits"

    id = Column(UUID(as_uuid=True), primary_key=True)
    deal_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    # One per household: an address plus its apartment (household.py).
    household_key = Column(String, nullable=False)
    status = Column(String, nullable=False, default=PENDING_CARD)
    units = Column(SmallInteger, nullable=False, default=1)
    fulfillment_method = Column(String, nullable=False)  # 'pickup' | 'delivery'
    delivery_starts_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivery_ends_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivery_fee = Column(Numeric(10, 2), nullable=False, default=0)  # what they were shown
    # To their pod's drop point (0038): pod_full_fee is the most they can pay,
    # and it's divided at the deadline. Set even if the pod is later deleted, so
    # the order can't quietly become a delivery to their home.
    pod_id = Column(UUID(as_uuid=True), nullable=True)
    pod_full_fee = Column(Numeric(10, 2), nullable=True)
    member_at_join = Column(Boolean, nullable=False, default=False)
    stripe_setup_intent_id = Column(String, nullable=True)
    stripe_payment_method_id = Column(String, nullable=True)
    order_id = Column(UUID(as_uuid=True), nullable=True)
    joined_at = Column(TIMESTAMP(timezone=True), nullable=True)
    withdrawn_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class GroupWaitlist(Base):
    __tablename__ = "group_waitlist"

    id = Column(UUID(as_uuid=True), primary_key=True)
    deal_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    household_key = Column(String, nullable=False)
    status = Column(String, nullable=False, default=WAITING)
    offered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    offer_expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class FarmFollow(Base):
    """A customer following a farm, to hear when it publishes a deal."""

    __tablename__ = "farm_follows"

    customer_id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), primary_key=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
