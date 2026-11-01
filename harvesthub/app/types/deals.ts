// Threshold group deals, the farmer's side: harvesthub-backend/app/deals/.
export type DealStatus = 'draft' | 'scheduled' | 'early_access' | 'live' | 'goal_met' | 'unlocked' | 'expired' | 'cancelled' | 'fulfilled';

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  early_access: 'Members only',
  live: 'Live',
  goal_met: 'Goal met',
  unlocked: 'Unlocked',
  expired: 'Expired',
  cancelled: 'Cancelled',
  fulfilled: 'Fulfilled',
};

export const OPEN_DEAL_STATUSES: DealStatus[] = ['scheduled', 'early_access', 'live'];

export type DealPayout = {
  discount_percent: number;
  regular_share_price: number;
  share_price: number;
  commission_rate: number;
  net_per_share: number;
  net_at_goal: number;
  net_at_capacity: number;
  regular_net_at_goal: number;
  reserved_quantity: number;
};

export type DealForm = {
  product_id: string;
  share_size: number;
  deal_price: number;
  goal: number;
  capacity: number;
  max_units: number;
  public_start_date: string | null;
  window_days: number;
  fulfillment_date: string | null;
  subscriber_fallback: boolean;
};

export type DealPreview = {
  errors: string[];
  warnings: string[];
  payout: DealPayout;
  member_opens_at: string;
  public_opens_at: string;
  deadline_at: string;
  fulfillment_date: string;
};

export type DealListing = {
  id: string;
  name: string;
  price: number;
  unit: string;
  quantity_available: number;
  image_url: string | null;
};

export type DealSetup = {
  listings: DealListing[];
  avg_weekly_households: number;
  suggested_goal: number;
  has_other_products: boolean;
};

export type Deal = DealForm & {
  id: string;
  status: DealStatus;
  product_name: string;
  image_url: string | null;
  unit: string;
  share_label: string;
  regular_price: number;
  member_opens_at: string | null;
  public_opens_at: string | null;
  deadline_at: string | null;
  reserved_quantity: number;
  cancel_reason: string | null;
  payout: DealPayout;
};
