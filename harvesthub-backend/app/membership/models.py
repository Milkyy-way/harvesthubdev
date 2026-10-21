from datetime import datetime
from sqlalchemy import Column, String, Integer, Numeric, Boolean, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class StripeCustomer(Base):
    __tablename__ = "stripe_customers"

    profile_id = Column(UUID(as_uuid=True), primary_key=True)
    stripe_customer_id = Column(String, nullable=False, unique=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class Membership(Base):
    __tablename__ = "memberships"

    id = Column(UUID(as_uuid=True), primary_key=True)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    plan = Column(String, nullable=False)  # 'monthly' | '3_months' | '6_months'
    interval_months = Column(Integer, nullable=False)
    price_amount = Column(Numeric(10, 2), nullable=False)  # billed every interval_months
    stripe_subscription_id = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False)  # mirrors Stripe's subscription status — see 0028
    trial_end = Column(TIMESTAMP(timezone=True), nullable=True)
    current_period_end = Column(TIMESTAMP(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False)
    canceled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    ended_at = Column(TIMESTAMP(timezone=True), nullable=True)
    card_brand = Column(String, nullable=True)
    card_last4 = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class FreePeriod(Base):
    """The free Harvest Pass every new customer gets (HARVEST_PASS_FREE_DAYS)
    — one row per customer, created by the API, never by the app."""

    __tablename__ = "harvest_pass_free_periods"

    customer_id = Column(UUID(as_uuid=True), primary_key=True)
    starts_at = Column(TIMESTAMP(timezone=True), nullable=False)
    ends_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
