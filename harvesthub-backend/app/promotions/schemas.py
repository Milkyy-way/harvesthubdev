from typing import Literal, Optional

from pydantic import BaseModel


# A code on the farm page: 'TEST10', '10% off', ['Ends Nov 30'].
class FarmPromoOut(BaseModel):
    code: str
    headline: str
    details: list[str]


class FarmerPromoCodeIn(BaseModel):
    code: str
    discount_type: Literal["percentage", "fixed"]
    discount_value: float
    min_order_amount: Optional[float] = None
    max_discount_amount: Optional[float] = None  # percentage codes only
    usage_limit: Optional[int] = None  # none = unlimited
    once_per_customer: bool = False
    show_on_farm_page: bool = True
    duration_days: Optional[int] = None  # 7, 14, 30 or 90; none = no end date


class FarmerPromoCodeUpdate(BaseModel):
    is_active: Optional[bool] = None
    show_on_farm_page: Optional[bool] = None


class FarmerPromoCodeOut(BaseModel):
    id: str
    code: str
    headline: str
    details: list[str]
    usage_limit: Optional[int]
    times_used: int
    show_on_farm_page: bool
    status: Literal["active", "paused", "scheduled", "ended", "used_up"]
