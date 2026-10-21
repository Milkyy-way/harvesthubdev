from pydantic import BaseModel
from typing import Optional

class CustomerProfileOut(BaseModel):
    address_street: str
    address_city: str
    address_state: str
    address_zip: str
    latitude: Optional[float]
    longitude: Optional[float]
    # 'exact' | 'interpolated' | 'approximate' | 'zip' | None (couldn't place)
    location_precision: Optional[str] = None
    dietary_preferences: list[str]
    produce_interests: list[str]

    class Config:
        from_attributes = True
