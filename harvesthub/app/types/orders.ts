// Matches the FastAPI backend's order schemas
// (harvesthub-backend/app/orders/schemas.py).
import type { DeliveryProgress } from './delivery';

export type FulfillmentMethod = 'pickup' | 'delivery';
// 'card' covers everything the native Stripe PaymentSheet offers (manually
// entered card, Apple Pay, Google Pay) — the sheet itself decides what to
// show based on device capability, the app doesn't distinguish which.
export type OrderPaymentMethod = 'card' | 'cash_on_pickup';

// card pickup:   pending_payment -> paid -> ready_for_pickup -> completed
// cash pickup:   pending_payment ---------> ready_for_pickup -> completed
// card delivery: pending_payment -> paid -> out_for_delivery -> completed
export type StoreOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';
export type OrderStatus = 'active' | 'completed' | 'cancelled';

export interface OrderLineItem {
  product_id: string | null;
  product_name: string;
  unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
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
  tax: number;
  total: number;
  refunded_amount: number;
  status: StoreOrderStatus;
  cancelled_by: 'customer' | 'farmer' | 'admin' | null;
  cancellation_reason: string | null;
  items: OrderLineItem[];
  my_rating: number | null;
  delivery: DeliveryProgress | null; // delivery orders only
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
