import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.core.database import Base

class CustomerProfile(Base):
    __tablename__ = "customer_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True)  # == profiles.id == auth.users.id
    address_street = Column(String, nullable=False)
    address_city = Column(String, nullable=False)
    address_state = Column(String, nullable=False)
    address_zip = Column(String, nullable=False)
    latitude = Column(Float, nullable=True)     # new — added via migration below
    longitude = Column(Float, nullable=True)    # new
    geocoded_at = Column(TIMESTAMP, nullable=True)  # new
    # How exact latitude/longitude are — see app/core/geocoding.py (0031).
    location_precision = Column(String, nullable=True)
    # Existed since 0003 (signup captures these) but never mapped here until
    # the Account tab needed to display them — same "map only what's used
    # so far" discipline as every other model in this project.
    dietary_preferences = Column(ARRAY(String), nullable=True)
    produce_interests = Column(ARRAY(String), nullable=True)
    updated_at = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)
