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
  free_days: number; // how long every new customer's free period lasts
  free_period_ends_at: string | null;
  free_period_active: boolean;
  free_service_fee_min_subtotal: number;
  is_member: boolean; // has the benefits right now — paid, or the free period
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
  free_until: string | null; // joining during the free period: no charge until then
  due_today: number;
  first_charge_at: string;
}

export interface PrepareCardUpdateResponse {
  setup_intent_id: string;
  setup_intent_client_secret: string;
}
