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
    trial_days: int  # 0 once the customer has had Harvest Pass before
    referral_trial_days: int
    free_service_fee_min_subtotal: float
    is_member: bool
    membership: Optional[MembershipOut]
    total_savings: float


class PrepareJoinRequest(BaseModel):
    plan: HarvestPassPlan
    referral_code: Optional[str] = None


class PrepareJoinOut(BaseModel):
    setup_intent_id: str
    setup_intent_client_secret: str
    plan: HarvestPassPlan
    interval_months: int
    price_per_month: float
    billed_amount: float
    trial_days: int
    due_today: float
    first_charge_at: str


class SubscribeRequest(BaseModel):
    plan: HarvestPassPlan
    setup_intent_id: str
    referral_code: Optional[str] = None


class PrepareCardUpdateOut(BaseModel):
    setup_intent_id: str
    setup_intent_client_secret: str


class UpdateCardRequest(BaseModel):
    setup_intent_id: str


class ReferralCodeCheckOut(BaseModel):
    code: str
    trial_days: int
    referrer_first_name: Optional[str]


class ReferralSummaryOut(BaseModel):
    code: str
    reward_amount: float
    friend_trial_days: int
    joined_count: int  # friends who joined with this code
    rewarded_count: int  # ...whose first paid month went through
    credit_earned: float
