// Matches the FastAPI farmer-side schemas:
// harvesthub-backend/app/farmer_products/schemas.py (Farmer F2) and
// harvesthub-backend/app/farmer_orders/schemas.py (Farmer F3).
import type { OrderPaymentMethod, FulfillmentMethod, StoreOrderStatus } from './orders';
import type { ProduceInterest } from './database';

export type TaxCategory = 'raw' | 'prepared';

export interface FarmerProduct {
  id: string;
  name: string;
  description: string | null;
  category_slug: ProduceInterest;
  category_name: string;
  price: number;
  unit: string;
  quantity_available: number;
  image_url: string | null;
  tax_category: TaxCategory;
  keep_cold: boolean;
  is_active: boolean;
}

export interface FarmerProductInput {
  name: string;
  description: string | null;
  category_slug: string;
  price: number;
  unit: string;
  quantity_available: number;
  tax_category: TaxCategory;
  keep_cold: boolean;
  is_active: boolean;
}

export type FarmerOrderView = 'to_prepare' | 'ready' | 'completed' | 'cancelled';

export interface FarmerOrderItem {
  product_name: string;
  unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  keep_cold: boolean;
}

export interface FarmerOrder {
  id: string; // store order id
  order_id: string;
  placed_at: string;
  status: StoreOrderStatus;
  payment_method: OrderPaymentMethod;
  customer_name: string | null;
  customer_phone: string | null; // only while the order is active
  fulfillment_method: FulfillmentMethod;
  delivery_window_label: string | null; // delivery orders: "Fri, Nov 6 · 4–7 PM"
  delivery_address_line: string | null; // while active
  delivery_fee: number; // the farm keeps all of it
  pod_name: string | null; // goes to this Neighborhood Pod's drop point
  items: FarmerOrderItem[];
  subtotal: number;
  promo_code: string | null;
  promo_discount: number;
  service_fee: number;
  tax: number;
  total: number;
  estimated_earnings: number;
  amount_to_collect: number;
  refunded_amount: number;
  cancelled_by: 'customer' | 'farmer' | 'admin' | null;
  cancellation_reason: string | null;
}

export interface FarmerOrdersResponse {
  items: FarmerOrder[];
  counts: Record<FarmerOrderView, number>;
}

// Farmer F4 — harvesthub-backend/app/farmer_earnings/schemas.py.
// earnings = gross - commission; net = earnings - cash_collected - fees + carried_in
export interface EarningsBreakdown {
  gross: number;
  commission: number;
  earnings: number;
  cash_collected: number;
  fees: number;
  carried_in: number;
  net: number;
}

export interface LedgerActivity {
  id: string;
  entry_type: 'order' | 'refund_adjustment' | 'cancellation_fee';
  created_at: string;
  customer_name: string | null;
  order_placed_at: string | null;
  item_count: number;
  payment_method: OrderPaymentMethod | null;
  gross: number;
  commission: number;
  cash_collected: number;
  fee: number;
  net: number;
}

export interface OpenPeriod {
  period_start: string; // YYYY-MM-DD
  period_end: string;
  is_current_week: boolean;
  payout_prepared_on: string;
  breakdown: EarningsBreakdown;
  entries: LedgerActivity[];
}

export interface FarmerPayout {
  id: string;
  period_start: string;
  period_end: string;
  breakdown: EarningsBreakdown;
  status: 'pending_disbursement' | 'paid' | 'carried_forward';
  disbursed_at: string | null;
  carried_into_period_end: string | null;
}

// Farmer F7 — harvesthub-backend/app/farmer_ratings/schemas.py. No customer
// identity on purpose.
export interface ReceivedRating {
  rating: number;
  comment: string | null;
  created_at: string;
  order_placed_at: string | null;
  items_summary: string;
}

export interface FarmerRatings {
  average: number | null;
  count: number;
  distribution: number[]; // index 0 = 1-star ... index 4 = 5-star
  recent: ReceivedRating[];
}

export interface FarmerEarnings {
  commission_rate: number;
  open_periods: OpenPeriod[];
  in_progress: { order_count: number; estimated_earnings: number };
  awaiting_payout: number;
  owed_carrying: number;
  lifetime_earnings: number;
  lifetime_paid_out: number;
  payouts: FarmerPayout[];
}
