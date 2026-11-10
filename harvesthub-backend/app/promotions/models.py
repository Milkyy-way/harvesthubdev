from sqlalchemy import Column, String, Numeric, Integer, Boolean, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

# Always farmer-scoped: a promo only ever discounts that one farmer's part of
# a checkout, and the farm pays for it (commission is on what's left). Farmers
# make their own in the app (0040). See app/promotions/service.py.
class PromoCode(Base):
    __tablename__ = "promo_codes"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    code = Column(String, nullable=False)
    discount_type = Column(String, nullable=False)  # 'percentage' | 'fixed'
    discount_value = Column(Numeric(10, 2), nullable=False)
    min_order_amount = Column(Numeric(10, 2), nullable=True)
    max_discount_amount = Column(Numeric(10, 2), nullable=True)  # caps a percentage discount
    usage_limit = Column(Integer, nullable=True)
    times_used = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    starts_at = Column(TIMESTAMP(timezone=True), nullable=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    show_on_farm_page = Column(Boolean, nullable=False, default=False)
    once_per_customer = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


# One row per order a code was used on (0040).
class PromoCodeUse(Base):
    __tablename__ = "promo_code_uses"

    id = Column(UUID(as_uuid=True), primary_key=True)
    promo_code_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    order_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
