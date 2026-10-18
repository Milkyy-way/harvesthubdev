// Harvest Pass — matches harvesthub-backend/app/membership/schemas.py.

export type HarvestPassPlan = 'monthly' | '3_months' | '6_months';

export interface PlanOption {
  plan: HarvestPassPlan;
  interval_months: number;
  discount_percent: number;
  price_per_month: number;
  billed_amount: number; // charged every interval_months
}

export interface Membership {
  plan: HarvestPassPlan;
  status: string; // Stripe's subscription status
  has_benefits: boolean;
  interval_months: number;
  price_amount: number;
  price_per_month: number;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  renews_at: string | null; // next charge, when not canceling
  ends_at: string | null; // when benefits stop, when canceling
  card_brand: string | null;
  card_last4: string | null;
  started_at: string | null;
}

export interface MembershipOverview {
  monthly_price: number;
  plans: PlanOption[];
  trial_days: number; // 0 once the customer has had Harvest Pass before
  referral_trial_days: number;
  free_service_fee_min_subtotal: number;
  is_member: boolean;
  membership: Membership | null;
  total_savings: number;
}

export interface PrepareJoinResponse {
  setup_intent_id: string;
  setup_intent_client_secret: string;
  plan: HarvestPassPlan;
  interval_months: number;
  price_per_month: number;
  billed_amount: number;
  trial_days: number;
  due_today: number;
  first_charge_at: string;
}

export interface PrepareCardUpdateResponse {
  setup_intent_id: string;
  setup_intent_client_secret: string;
}

export interface ReferralCodeCheck {
  code: string;
  trial_days: number;
  referrer_first_name: string | null;
}

export interface ReferralSummary {
  code: string;
  reward_amount: number;
  friend_trial_days: number;
  joined_count: number;
  rewarded_count: number;
  credit_earned: number;
}
