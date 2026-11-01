from datetime import date
from typing import Literal, Optional

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


class DealExtendIn(BaseModel):
    days: int = Field(ge=1, le=2)


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
    households: int
    shares_claimed: int
    households_paid: int
    extended_once: bool
    can_extend: bool
    fallback_ends_at: Optional[str]
    waitlist_count: int


class DealListOut(BaseModel):
    deals: list[DealOut]


class DealRecordOut(BaseModel):
    """The farmer's record: for coaching, not punishing."""

    deals_finished: int
    deals_unlocked: int
    deals_expired: int
    deals_cancelled: int
    deals_cancelled_after_goal: int
    orders_not_filled: int
    tip: Optional[str]


# --- The customer's side ---------------------------------------------------------------


class DealQuoteIn(BaseModel):
    units: int = Field(default=1, ge=1, le=10)
    fulfillment_method: Literal["pickup", "delivery"] = "pickup"
    pod_id: Optional[str] = Field(default=None, max_length=40)


class DealJoinIn(DealQuoteIn):
    delivery_starts_at: Optional[str] = Field(default=None, max_length=40)


class DealQuoteOut(BaseModel):
    share_price: float
    subtotal: float
    service_fee: float
    member_savings: float
    delivery_fee: float
    tax: float
    total: float
    # To a pod's drop point: delivery_fee and total are the most it can come to,
    # and this is each member's share as things stand.
    pod_share_now: Optional[float] = None


class DealJoinOut(BaseModel):
    setup_intent_client_secret: str


class DealCardOut(BaseModel):
    id: str
    status: str
    farmer_id: str
    farm_name: str
    farm_city: Optional[str]
    farm_state: Optional[str]
    product_name: str
    image_url: Optional[str]
    unit: str
    share_label: str
    regular_price: float
    deal_price: float
    share_price: float
    regular_share_price: float
    discount_percent: float
    goal: int
    capacity: int
    households: int
    shares_claimed: int
    public_opens_at: str
    deadline_at: str
    joined: bool


class DealCardListOut(BaseModel):
    deals: list[DealCardOut]


class MyCommitOut(BaseModel):
    status: str
    units: int
    fulfillment_method: str
    delivery_label: Optional[str]
    delivery_fee: float
    pod_name: Optional[str]
    pod_share_now: Optional[float]
    can_withdraw: bool
    order_id: Optional[str]
    order_status: Optional[str]


class FallbackOfferOut(BaseModel):
    ends_at: str
    share_price: float
    total: float


class DealSlotOut(BaseModel):
    starts_at: str
    ends_at: str
    label: str


class DealDeliveryOut(BaseModel):
    available: bool
    reason: Optional[str]
    fee: float
    slots: list[DealSlotOut]
    address_line: str


class DealPodChoiceOut(BaseModel):
    pod_id: str
    pod_name: str
    drop_address_line: str
    full_fee: float
    share_now: float
    slots: list[DealSlotOut]


class MyPodCountOut(BaseModel):
    pod_id: str
    pod_name: str
    households: int


class DealWaitlistOut(BaseModel):
    status: str
    position: Optional[int]
    offer_expires_at: Optional[str]


class CustomerDealOut(DealCardOut):
    description: Optional[str]
    max_units: int
    member_opens_at: str
    withdraw_locks_at: str
    fulfillment_date: Optional[date]
    filled_by_members: bool
    is_member: bool
    free_month_available: bool
    can_join: bool
    join_blocked_reason: Optional[str]
    my_commit: Optional[MyCommitOut]
    fallback: Optional[FallbackOfferOut]
    pickup_address: str
    delivery: DealDeliveryOut
    pods: list[DealPodChoiceOut]
    pod_note: Optional[str]
    my_pod: Optional[MyPodCountOut]
    waitlist: Optional[DealWaitlistOut]
    can_waitlist: bool
    following_farm: bool


class FollowOut(BaseModel):
    following: bool
