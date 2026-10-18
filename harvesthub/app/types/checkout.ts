// Shared between the cart screen, the checkout screen, and
// CheckoutDraftContext — a customer's pickup/delivery choice per farmer
// persists across that navigation (see contexts/CheckoutDraftContext.tsx),
// so these types can't live inside a single component file anymore.

export type FulfillmentMethod = 'pickup' | 'delivery';

export interface DeliveryAddressDraft {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface FarmFulfillment {
  method: FulfillmentMethod | null;
  deliveryAddress: DeliveryAddressDraft;
}

export function isFulfillmentReady(fulfillment: FarmFulfillment | undefined): boolean {
  if (!fulfillment?.method) return false;
  if (fulfillment.method === 'delivery') {
    const { street, city, state, zip } = fulfillment.deliveryAddress;
    return Boolean(street.trim() && city.trim() && state.trim() && zip.trim());
  }
  return true;
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
