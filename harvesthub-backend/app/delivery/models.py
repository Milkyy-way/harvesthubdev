from datetime import datetime
from sqlalchemy import Boolean, Column, Float, Integer, Numeric, SmallInteger, String, Time, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class FarmDeliverySettings(Base):
    """Whether a farm delivers, and on what terms (0032)."""

    __tablename__ = "farm_delivery_settings"

    farmer_id = Column(UUID(as_uuid=True), primary_key=True)
    offers_delivery = Column(Boolean, nullable=False, default=False)
    delivery_fee = Column(Numeric(10, 2), nullable=False, default=5.00)  # the farm keeps all of it
    radius_miles = Column(Numeric(4, 1), nullable=False, default=10)
    cutoff_hours = Column(Integer, nullable=False, default=24)
    # Neighborhood Pods (0035): whether the farm delivers to drop points, and
    # its fee for a drop point, split evenly across the pod's households.
    offers_pod_delivery = Column(Boolean, nullable=False, default=False)
    pod_delivery_fee = Column(Numeric(10, 2), nullable=False, default=5.00)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class FarmDeliveryWindow(Base):
    """A weekly delivery window, wall-clock time in America/New_York."""

    __tablename__ = "farm_delivery_windows"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    weekday = Column(SmallInteger, nullable=False)  # 0 = Monday, like datetime.weekday()
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class DeliveryRun(Base):
    """One farm delivering one window's orders."""

    __tablename__ = "delivery_runs"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    provider = Column(String, nullable=False, default="farm")  # couriers later
    window_starts_at = Column(TIMESTAMP(timezone=True), nullable=False)
    window_ends_at = Column(TIMESTAMP(timezone=True), nullable=False)
    status = Column(String, nullable=False, default="scheduled")  # 'scheduled' | 'in_progress' | 'completed'
    started_at = Column(TIMESTAMP(timezone=True), nullable=True)
    completed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # Live tracking (0033): the farmer's latest position while the run is in
    # progress — no trail; cleared when it completes.
    current_latitude = Column(Float, nullable=True)
    current_longitude = Column(Float, nullable=True)
    current_heading = Column(Float, nullable=True)
    location_updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class DeliveryStop(Base):
    """A place the run stops at — one customer's home (one store order), or
    a Neighborhood Pod's drop point (all of that pod's orders on the run)."""

    __tablename__ = "delivery_stops"

    id = Column(UUID(as_uuid=True), primary_key=True)
    run_id = Column(UUID(as_uuid=True), nullable=False)
    kind = Column(String, nullable=False, default="home")  # 'home' | 'pod'
    pod_id = Column(UUID(as_uuid=True), nullable=True)
    pod_drop_version = Column(Integer, nullable=True)  # orders for a moved drop point don't share a stop
    sequence = Column(Integer, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(String, nullable=False, default="pending")  # 'pending' | 'en_route' | 'delivered' | 'cancelled'
    delivered_at = Column(TIMESTAMP(timezone=True), nullable=True)
    photo_path = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
