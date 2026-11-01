// Threshold group deals, the farmer's side: harvesthub-backend/app/deals/.
export type DealStatus =
  | 'draft'
  | 'scheduled'
  | 'early_access'
  | 'live'
  | 'goal_met'
  | 'full'
  | 'closing'
  | 'unlocked'
  | 'expired'
  | 'cancelled'
  | 'fulfilled';

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  early_access: 'Members only',
  live: 'Live',
  goal_met: 'Goal met',
  full: 'Full',
  closing: 'Closing',
  unlocked: 'Unlocked',
  expired: 'Expired',
  cancelled: 'Cancelled',
  fulfilled: 'Fulfilled',
};

export const OPEN_DEAL_STATUSES: DealStatus[] = ['scheduled', 'early_access', 'live', 'goal_met'];

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
  households: number;
  shares_claimed: number;
  households_paid: number;
  extended_once: boolean;
  can_extend: boolean;
  fallback_ends_at: string | null;
  waitlist_count: number;
};

export type DealRecord = {
  deals_finished: number;
  deals_unlocked: number;
  deals_expired: number;
  deals_cancelled: number;
  deals_cancelled_after_goal: number;
  orders_not_filled: number;
  tip: string | null;
};

// --- The customer's side -----------------------------------------------------

export type CustomerDealCard = {
  id: string;
  status: DealStatus;
  farmer_id: string;
  farm_name: string;
  farm_city: string | null;
  farm_state: string | null;
  product_name: string;
  image_url: string | null;
  unit: string;
  share_label: string;
  regular_price: number;
  deal_price: number;
  share_price: number;
  regular_share_price: number;
  discount_percent: number;
  goal: number;
  capacity: number;
  households: number;
  shares_claimed: number;
  public_opens_at: string;
  deadline_at: string;
  joined: boolean;
};

export type DealQuote = {
  share_price: number;
  subtotal: number;
  service_fee: number;
  member_savings: number;
  delivery_fee: number;
  tax: number;
  total: number;
  // To a pod's drop point: delivery_fee and total are the most it can come to.
  pod_share_now: number | null;
};

export type DealSlot = { starts_at: string; ends_at: string; label: string };

export type DealPodChoice = {
  pod_id: string;
  pod_name: string;
  drop_address_line: string;
  full_fee: number;
  share_now: number;
  slots: DealSlot[];
};

export type CustomerDeal = CustomerDealCard & {
  description: string | null;
  max_units: number;
  member_opens_at: string;
  withdraw_locks_at: string;
  fulfillment_date: string | null;
  filled_by_members: boolean;
  is_member: boolean;
  free_month_available: boolean;
  can_join: boolean;
  join_blocked_reason: string | null;
  my_commit: {
    status: 'active' | 'ordered' | 'not_charged';
    units: number;
    fulfillment_method: 'pickup' | 'delivery';
    delivery_label: string | null;
    delivery_fee: number;
    pod_name: string | null;
    pod_share_now: number | null;
    can_withdraw: boolean;
    order_id: string | null;
    order_status: string | null;
  } | null;
  fallback: { ends_at: string; share_price: number; total: number } | null;
  pickup_address: string;
  delivery: {
    available: boolean;
    reason: string | null;
    fee: number;
    slots: DealSlot[];
    address_line: string;
  };
  pods: DealPodChoice[];
  pod_note: string | null;
  my_pod: { pod_id: string; pod_name: string; households: number } | null;
  waitlist: { status: 'waiting' | 'offered'; position: number | null; offer_expires_at: string | null } | null;
  can_waitlist: boolean;
  following_farm: boolean;
};

// Days until the last 24 hours, then hours and minutes.
export function timeLeft(iso: string, bare = false): string {
  const minutes = Math.max(Math.floor((new Date(iso).getTime() - Date.now()) / 60000), 0);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const text = days >= 1 ? `${days} d ${hours} h` : hours >= 1 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  return bare ? text : `${text} left`;
}

// A card's one line on how a deal stands.
export function dealLine(deal: CustomerDealCard): string {
  switch (deal.status) {
    case 'early_access':
      return `Members joining now · ${deal.households} of ${deal.goal}`;
    case 'goal_met':
      return `Unlocked · ${Math.max(deal.capacity - deal.shares_claimed, 0)} shares left`;
    case 'full':
      return 'All shares claimed';
    case 'closing':
      return 'Closing now';
    case 'unlocked':
      return 'It unlocked';
    case 'expired':
      return "Didn't reach its goal";
    case 'cancelled':
      return 'Cancelled by the farm';
    default:
      return `${Math.max(deal.goal - deal.households, 0)} more to unlock`;
  }
}
