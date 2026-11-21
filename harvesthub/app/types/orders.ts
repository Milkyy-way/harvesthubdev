// Matches the FastAPI backend's order schemas
// (harvesthub-backend/app/orders/schemas.py).
import type { DeliveryProgress } from './delivery';

export type FulfillmentMethod = 'pickup' | 'delivery';
// 'card' covers everything the native Stripe PaymentSheet offers (manually
// entered card, Apple Pay, Google Pay) — the sheet itself decides what to
// show based on device capability, the app doesn't distinguish which.
export type OrderPaymentMethod = 'card' | 'cash_on_pickup';

// card pickup:   pending_payment -> paid -> ready_for_pickup -> completed | not_picked
// cash pickup:   pending_payment ---------> ready_for_pickup -> completed | not_picked
// card delivery: pending_payment -> paid -> out_for_delivery -> completed
// not_picked (2026-11-20): the pickup time ended without the handover.
export type StoreOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'completed'
  | 'not_picked'
  | 'cancelled';
export type OrderStatus = 'active' | 'completed' | 'cancelled';

export interface OrderLineItem {
  id?: string; // the order line, for "Report a problem"
  product_id: string | null;
  product_name: string;
  unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

// A pickup's window and code (2026-11-20). The farm taps Ready (now or from
// a later time); the window is 3 hours, plus one extra hour on request. The
// customer shows the code and the farm enters it to hand the order over.
export interface PickupInfo {
  ready_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  extended: boolean;
  can_extend: boolean;
  // While it waits for pickup, and for a day after "not picked".
  code: string | null;
  picked_up_at: string | null;
  not_picked_at: string | null;
  // Not packed by then: cancelling gives everything back.
  free_cancel_from: string | null;
}

export type ProblemReason = 'missing_item' | 'damaged' | 'wrong_item' | 'quality' | 'farm_closed' | 'other';

export interface ProblemInfo {
  status: 'open' | 'refunded' | 'declined' | 'handled';
  reason: ProblemReason;
  created_at: string | null;
  refund_amount: number | null;
  note: string | null; // HarvestHub's note to the customer
}

export interface StoreOrder {
  id: string;
  farmer_id: string;
  farm_name: string;
  photo_url: string | null;
  fulfillment_method: FulfillmentMethod;
  pickup_address_street: string | null;
  pickup_address_city: string | null;
  pickup_address_state: string | null;
  pickup_address_zip: string | null;
  delivery_address_street: string | null;
  delivery_address_city: string | null;
  delivery_address_state: string | null;
  delivery_address_zip: string | null;
  subtotal: number;
  promo_code: string | null;
  promo_discount: number;
  delivery_fee: number;
  service_fee: number;
  member_savings: number; // Harvest Pass — the waived service fee
  fixed_fee?: number; // the 30¢ part of service_fee, on a payment under $25
  cash_discount?: number; // paid at the farm: the service fee taken off
  tax: number;
  total: number;
  refunded_amount: number;
  status: StoreOrderStatus;
  group_deal_id: string | null;
  cancelled_by: 'customer' | 'farmer' | 'admin' | null;
  cancellation_reason: string | null;
  items: OrderLineItem[];
  my_rating: number | null;
  delivery: DeliveryProgress | null; // delivery orders only
  // What the customer can do now (the server decides): cancel, and what
  // comes back — everything except the service fee — or why not.
  can_cancel?: boolean;
  cancel_blocked_reason?: string | null;
  cancel_refund?: number;
  cancel_keeps_service_fee?: boolean;
  pickup?: PickupInfo | null; // pickup orders only
  completed_at?: string | null; // handed over: picked up, or delivered
  problem?: ProblemInfo | null;
  can_report_problem?: boolean;
  report_until?: string | null;
  ask_collected?: boolean; // a cash order not picked up: "Did you collect it?"
}

export interface OrderPayment {
  id: string;
  amount: number;
  currency: string;
  payment_method: OrderPaymentMethod;
  status: string;
  failure_reason: string | null;
  // A pod order: client_secret saves a card, and it's charged at the farm's cutoff.
  charged_at_cutoff: boolean;
}

export interface Order {
  id: string;
  status: OrderStatus;
  placed_at: string;
  grand_total: number;
  store_orders: StoreOrder[];
  payment: OrderPayment | null;
  // Not paid for yet (2026-11-14): not an order until it is. Pay with
  // POST /orders/{id}/resume-payment, or remove it with /discard, by pay_by.
  checkout_unfinished?: boolean;
  pay_by?: string | null;
  removed?: boolean; // removed unpaid: nothing was charged
}

export interface ResumePaymentResponse {
  order: Order;
  client_secret: string | null; // null: nothing left to pay
  card_setup: boolean; // a pod order saves a card instead
}

export interface DiscardResponse {
  removed: boolean;
  order: Order | null; // when it turned out to be paid
}

export interface CreateOrderGroup {
  farmer_id: string;
  fulfillment_method: FulfillmentMethod;
  promo_code?: string | null;
  // Delivery: the chosen window (DeliverySlot.starts_at). It goes to the
  // customer's saved address, or with pod_id to that pod's drop point.
  delivery_starts_at?: string | null;
  pod_id?: string | null;
}

export interface CreateOrderRequest {
  groups: CreateOrderGroup[];
  payment_method: OrderPaymentMethod;
}

export interface CreateOrderResponse {
  order: Order;
  client_secret: string | null;
}

export interface ReorderResponse {
  added_count: number;
  skipped_count: number;
  cart_item_count: number;
}
