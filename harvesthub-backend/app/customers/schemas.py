from pydantic import BaseModel, Field
from typing import Optional

class CustomerProfileOut(BaseModel):
    address_street: str
    address_city: str
    address_state: str
    address_zip: str
    address_unit: Optional[str] = None
    latitude: Optional[float]
    longitude: Optional[float]
    # 'exact' | 'interpolated' | 'approximate' | 'zip' | None (couldn't place)
    location_precision: Optional[str] = None
    dietary_preferences: list[str]
    produce_interests: list[str]

    class Config:
        from_attributes = True


class PlaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    address_street: str = Field(min_length=1, max_length=200)
    address_city: str = Field(min_length=1, max_length=100)
    address_state: str = Field(min_length=1, max_length=40)
    address_zip: str = Field(pattern=r"^[0-9]{5}(-[0-9]{4})?$")


class PlaceChoiceIn(BaseModel):
    place_id: Optional[str] = None  # none is Home


class PlaceOut(BaseModel):
    id: str
    name: str
    address_line: str


class PlacesOut(BaseModel):
    active_place_id: Optional[str]
    home_city: Optional[str]
    max_places: int
    places: list[PlaceOut]
