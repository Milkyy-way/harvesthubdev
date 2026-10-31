// Shared between the cart screen, the checkout screen, and
// CheckoutDraftContext — a customer's pickup/delivery choice per farmer
// persists across that navigation (see contexts/CheckoutDraftContext.tsx),
// so these types can't live inside a single component file anymore.

export type FulfillmentMethod = 'pickup' | 'delivery';

// Deliveries go to the customer's saved address (Edit Profile) or, with podId,
// their Neighborhood Pod's drop point; either way the window is chosen too.
export interface FarmFulfillment {
  method: FulfillmentMethod | null;
  deliverySlot: string | null; // DeliverySlot.starts_at
  podId: string | null;
}

export function isFulfillmentReady(fulfillment: FarmFulfillment | undefined): boolean {
  if (!fulfillment?.method) return false;
  return fulfillment.method === 'pickup' || Boolean(fulfillment.deliverySlot);
}

// Matches CheckoutLineItemOut/CheckoutGroupOut/CheckoutPreviewResponse
// (harvesthub-backend/app/checkout/schemas.py) — POST /checkout/preview.
export interface CheckoutLineItem {
  product_id: string;
  name: string;
  unit: string;
  price: number;
  quantity: number;
  line_total: number;
}

export interface CheckoutGroup {
  farmer_id: string;
  farm_name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  latitude: number | null;
  longitude: number | null;
  fulfillment_method: FulfillmentMethod;
  items: CheckoutLineItem[];
  subtotal: number;
  promo_code: string | null;
  promo_discount: number;
  promo_error: string | null;
  delivery_fee: number;
  // Delivery only: the window, where it goes, or why it can't be delivered
  // (the order can't be placed while delivery_error is set).
  delivery_window_label: string | null;
  delivery_address_line: string | null;
  delivery_error: string | null;
  pod_id: string | null;
  pod_name: string | null;
  pod_savings: number; // the most the pod can save against home delivery
  // A pod order: delivery_fee and farm_total are the most it can come to. It's
  // charged once at charge_at, down to pod_fee_low if every household orders.
  pod_fee_low: number | null;
  charge_at: string | null;
  service_fee: number;
  member_savings: number; // service fee Harvest Pass waived for this farm
  tax: number;
  farm_total: number;
}

export interface CheckoutPreviewResponse {
  groups: CheckoutGroup[];
  grand_total: number;
  is_member: boolean;
  member_savings: number;
  // Non-members only: what Harvest Pass would save on this checkout (0 below
  // the minimum) — drives the checkout upsell.
  member_potential_savings: number;
  member_min_subtotal: number;
  items_subtotal: number;
}
