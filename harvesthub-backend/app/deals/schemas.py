from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class DealIn(BaseModel):
    """A draft, or what the creation form currently says. Loose on purpose: the
    rules live in service.evaluate, which explains itself to the farmer."""

    product_id: str
    share_size: float = Field(default=1, gt=0, le=1000)
    deal_price: float = Field(gt=0, le=100000)
    goal: int = Field(ge=1, le=100000)
    capacity: int = Field(ge=1, le=100000)
    max_units: int = Field(default=1, ge=1, le=10)
    public_start_date: Optional[date] = None
    window_days: int = Field(default=5, ge=1, le=60)
    fulfillment_date: Optional[date] = None
    subscriber_fallback: bool = True


class DealChangeIn(BaseModel):
    """After publishing, a farmer may only change terms in shoppers' favor."""

    deal_price: Optional[float] = Field(default=None, gt=0, le=100000)
    goal: Optional[int] = Field(default=None, ge=1, le=100000)
    capacity: Optional[int] = Field(default=None, ge=1, le=100000)


class DealCancelIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class DealPayoutOut(BaseModel):
    discount_percent: float
    regular_share_price: float
    share_price: float
    commission_rate: float
    net_per_share: float
    net_at_goal: float
    net_at_capacity: float
    regular_net_at_goal: float
    reserved_quantity: int


class DealPreviewOut(BaseModel):
    errors: list[str]
    warnings: list[str]
    payout: DealPayoutOut
    member_opens_at: str
    public_opens_at: str
    deadline_at: str
    fulfillment_date: date


class DealListingOut(BaseModel):
    id: str
    name: str
    price: float
    unit: str
    quantity_available: int
    image_url: Optional[str]


class DealSetupOut(BaseModel):
    listings: list[DealListingOut]
    avg_weekly_households: int
    suggested_goal: int
    has_other_products: bool


class DealOut(BaseModel):
    id: str
    status: str
    product_id: str
    product_name: str
    image_url: Optional[str]
    unit: str
    share_size: float
    share_label: str
    regular_price: float
    deal_price: float
    goal: int
    capacity: int
    max_units: int
    subscriber_fallback: bool
    public_start_date: Optional[date]
    window_days: int
    fulfillment_date: Optional[date]
    member_opens_at: Optional[str]
    public_opens_at: Optional[str]
    deadline_at: Optional[str]
    reserved_quantity: int
    cancel_reason: Optional[str]
    payout: DealPayoutOut


class DealListOut(BaseModel):
    deals: list[DealOut]
