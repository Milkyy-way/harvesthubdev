from typing import Literal, Optional
from pydantic import BaseModel

HarvestPassPlan = Literal["monthly", "3_months", "6_months"]


class PlanOptionOut(BaseModel):
    plan: HarvestPassPlan
    interval_months: int
    discount_percent: int
    price_per_month: float
    billed_amount: float  # charged every interval_months


class MembershipOut(BaseModel):
    plan: HarvestPassPlan
    status: str  # Stripe's subscription status — see 0028
    has_benefits: bool
    interval_months: int
    price_amount: float
    price_per_month: float
    trial_end: Optional[str]
    current_period_end: Optional[str]
    cancel_at_period_end: bool
    renews_at: Optional[str]  # next charge, when not canceling
    ends_at: Optional[str]  # when benefits stop, when canceling
    card_brand: Optional[str]
    card_last4: Optional[str]
    started_at: Optional[str]


class MembershipOverviewOut(BaseModel):
    monthly_price: float
    plans: list[PlanOptionOut]
    free_days: int  # how long every new customer's free period lasts
    free_period_ends_at: Optional[str]
    free_period_active: bool
    free_service_fee_min_subtotal: float
    is_member: bool  # has the benefits right now — paid, or the free period
    membership: Optional[MembershipOut]
    total_savings: float


class PrepareJoinRequest(BaseModel):
    plan: HarvestPassPlan


class PrepareJoinOut(BaseModel):
    setup_intent_id: str
    setup_intent_client_secret: str
    plan: HarvestPassPlan
    interval_months: int
    price_per_month: float
    billed_amount: float
    free_until: Optional[str]  # joining during the free period: no charge until then
    due_today: float
    first_charge_at: str


class SubscribeRequest(BaseModel):
    plan: HarvestPassPlan
    setup_intent_id: str


class PrepareCardUpdateOut(BaseModel):
    setup_intent_id: str
    setup_intent_client_secret: str


class UpdateCardRequest(BaseModel):
    setup_intent_id: str
