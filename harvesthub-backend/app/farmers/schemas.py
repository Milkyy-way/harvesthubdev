from pydantic import BaseModel
from typing import Optional

from app.promotions.schemas import FarmPromoOut

class FarmerFeedCard(BaseModel):
    id: str
    farm_name: str
    photo_url: Optional[str]
    distance_km: float
    matched_categories: list[str]

class FarmerFeedResponse(BaseModel):
    items: list[FarmerFeedCard]
    limit: int
    offset: int
    total: int

class FarmerSpotlightCard(BaseModel):
    id: str
    farm_name: str
    photo_url: Optional[str]
    distance_km: float
    average_rating: Optional[float]
    rating_count: int

class FarmerSpotlightResponse(BaseModel):
    items: list[FarmerSpotlightCard]

class CertificationOut(BaseModel):
    cert_type: str
    cert_name: str

class FarmerDetailOut(BaseModel):
    id: str
    farm_name: str
    photo_url: Optional[str]
    bio: Optional[str]
    address_city: Optional[str]
    address_state: Optional[str]
    distance_km: Optional[float]
    farm_types: list[str]
    years_in_operation: Optional[int]
    average_rating: Optional[float]
    rating_count: int
    certifications: list[CertificationOut]
    # Promo codes the farm chose to show, that work right now.
    promotions: list[FarmPromoOut] = []
