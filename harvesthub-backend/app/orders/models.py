from datetime import datetime
from sqlalchemy import Column, String, Integer, Numeric, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=True), primary_key=True)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String, nullable=False, default="active")  # trigger-maintained — see 0013's SQL
    placed_at = Column(TIMESTAMP, default=datetime.utcnow)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)


class StoreOrder(Base):
    __tablename__ = "store_orders"

    id = Column(UUID(as_uuid=True), primary_key=True)
    order_id = Column(UUID(as_uuid=True), nullable=False)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    farm_name = Column(String, nullable=False)

    fulfillment_method = Column(String, nullable=False)  # 'pickup' | 'delivery'
    pickup_address_street = Column(String, nullable=True)
    pickup_address_city = Column(String, nullable=True)
    pickup_address_state = Column(String, nullable=True)
    pickup_address_zip = Column(String, nullable=True)
    delivery_address_street = Column(String, nullable=True)
    delivery_address_city = Column(String, nullable=True)
    delivery_address_state = Column(String, nullable=True)
    delivery_address_zip = Column(String, nullable=True)

    subtotal = Column(Numeric(10, 2), nullable=False)
    promo_code = Column(String, nullable=True)
    promo_discount = Column(Numeric(10, 2), nullable=False, default=0)
    delivery_fee = Column(Numeric(10, 2), nullable=False, default=0)
    service_fee = Column(Numeric(10, 2), nullable=False, default=0)
    tax = Column(Numeric(10, 2), nullable=False, default=0)
    total = Column(Numeric(10, 2), nullable=False)
    # What Harvest Pass took off this farm's order (the waived service fee) — see 0028.
    member_savings = Column(Numeric(10, 2), nullable=False, default=0)

    # + 'ready_for_pickup' (0025), 'out_for_delivery' (0032)
    status = Column(String, nullable=False, default="pending_payment")
    # When the farmer may see this order and the customer's name/phone:
    # card payment succeeded, or placed as cash on pickup. Null = never shown.
    released_to_farmer_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # Delivery orders (0032): the window the customer chose, and the stop on
    # that window's delivery run (set once the order is paid).
    delivery_window_starts_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivery_window_ends_at = Column(TIMESTAMP(timezone=True), nullable=True)
    delivery_stop_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)


class StoreOrderItem(Base):
    __tablename__ = "store_order_items"

    id = Column(UUID(as_uuid=True), primary_key=True)
    store_order_id = Column(UUID(as_uuid=True), nullable=False)
    product_id = Column(UUID(as_uuid=True), nullable=True)
    product_name = Column(String, nullable=False)
    unit = Column(String, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    quantity = Column(Integer, nullable=False)
    line_total = Column(Numeric(10, 2), nullable=False)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)


class OrderCancellation(Base):
    __tablename__ = "order_cancellations"

    id = Column(UUID(as_uuid=True), primary_key=True)
    order_id = Column(UUID(as_uuid=True), nullable=False)
    store_order_id = Column(UUID(as_uuid=True), nullable=False)
    cancelled_by = Column(UUID(as_uuid=True), nullable=False)
    cancelled_by_role = Column(String, nullable=False)
    reason = Column(String, nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
