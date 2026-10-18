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


class ReferralCode(Base):
    __tablename__ = "referral_codes"

    customer_id = Column(UUID(as_uuid=True), primary_key=True)
    code = Column(String, nullable=False, unique=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class Referral(Base):
    __tablename__ = "referrals"

    id = Column(UUID(as_uuid=True), primary_key=True)
    referrer_id = Column(UUID(as_uuid=True), nullable=False)
    referred_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    code = Column(String, nullable=False)
    membership_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String, nullable=False, default="pending")  # 'pending' | 'rewarded' | 'void'
    reward_amount = Column(Numeric(10, 2), nullable=True)
    stripe_balance_transaction_id = Column(String, nullable=True, unique=True)
    rewarded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
