from pydantic import BaseModel, Field
from typing import Literal, Optional

TaxCategory = Literal["raw", "prepared"]  # see app/core/tax.py


class FarmerProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    category_slug: str
    price: float = Field(gt=0, le=10000)
    unit: str = Field(min_length=1, max_length=30)
    quantity_available: int = Field(ge=0, le=100000)
    tax_category: TaxCategory = "raw"
    keep_cold: bool = False
    is_active: bool = True


# PATCH — every field optional; only the ones sent are changed. image_url is
# set by the app after it uploads the photo (or null to remove it).
class FarmerProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    category_slug: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0, le=10000)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=30)
    quantity_available: Optional[int] = Field(default=None, ge=0, le=100000)
    tax_category: Optional[TaxCategory] = None
    keep_cold: Optional[bool] = None
    is_active: Optional[bool] = None
    image_url: Optional[str] = None


class FarmerProductOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    category_slug: str
    category_name: str
    price: float
    unit: str
    quantity_available: int
    image_url: Optional[str]
    tax_category: TaxCategory
    keep_cold: bool = False
    is_active: bool
