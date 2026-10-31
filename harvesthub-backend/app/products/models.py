from datetime import datetime
from sqlalchemy import Column, String, Boolean, Numeric, Integer, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True)
    farmer_id = Column(UUID(as_uuid=True), nullable=False)
    category_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    price = Column(Numeric(10, 2), nullable=False)
    unit = Column(String, nullable=False)
    quantity_available = Column(Integer, nullable=False, default=0)
    image_url = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    tax_category = Column(String, nullable=False, default="raw")  # 'raw' | 'prepared' — see app/core/tax.py
    # Left at a pod's drop point, this needs collecting soon (0035).
    keep_cold = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)  # powers the Home feed's "just picked" harvest tag
