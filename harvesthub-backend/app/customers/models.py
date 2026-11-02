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
    address_unit = Column(String, nullable=True)  # apartment, suite or unit (0036)
    # The saved place they're browsing from; empty means home (app/customers/places.py).
    browse_place_id = Column(UUID(as_uuid=True), nullable=True)
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

    @property
    def street_line(self) -> str:
        """The street with the apartment: what a driver needs to find them."""
        return f"{self.address_street}, {self.address_unit}" if self.address_unit else self.address_street


class CustomerPlace(Base):
    """A saved place to browse nearby farms from, like Work (0039)."""

    __tablename__ = "customer_places"

    id = Column(UUID(as_uuid=True), primary_key=True)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String, nullable=False)
    address_street = Column(String, nullable=False)
    address_city = Column(String, nullable=False)
    address_state = Column(String, nullable=False)
    address_zip = Column(String, nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    geocoded_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
