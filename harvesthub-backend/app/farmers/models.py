from sqlalchemy import Column, String, Float, Integer, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.core.database import Base

class FarmerProfile(Base):
    __tablename__ = "farmer_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True)  # == profiles.id == auth.users.id
    farm_name = Column(String, nullable=False)
    address_street = Column(String, nullable=True)
    address_city = Column(String, nullable=True)
    address_state = Column(String, nullable=True)
    address_zip = Column(String, nullable=True)
    farm_types = Column(ARRAY(String), nullable=True)
    years_in_operation = Column(Integer, nullable=True)
    bio = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    geocoded_at = Column(TIMESTAMP, nullable=True)
    location_precision = Column(String, nullable=True)  # see app/core/geocoding.py (0031)
    photo_url = Column(String, nullable=True)


# Deliberately partial (no file_path — that's private verification-adjacent
# data) — just enough to show public certification badges on the farm
# detail page. Farmers manage the real rows via supabase-js directly
# (see 0004_farmer_tables.sql); no farmer-side CRUD through FastAPI yet.
class FarmerCertification(Base):
    __tablename__ = "farmer_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    cert_type = Column(String, nullable=False)
    cert_name = Column(String, nullable=False)
