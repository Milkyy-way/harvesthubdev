// Farm delivery — matches harvesthub-backend/app/delivery/schemas.py.

// --- Farmer: settings ---------------------------------------------------------

export interface DeliveryWindow {
  weekday: number; // 0 = Monday … 6 = Sunday
  start_time: string; // "16:00", Eastern time
  end_time: string;
}

export interface DeliverySettings {
  offers_delivery: boolean;
  delivery_fee: number; // the farm keeps all of it
  radius_miles: number;
  cutoff_hours: number;
  offers_pod_delivery: boolean;
  pod_delivery_fee: number; // for a drop point, split evenly across the pod's households
  windows: DeliveryWindow[];
  farm_located: boolean; // the radius is measured from the farm
}

// --- Farmer: runs ---------------------------------------------------------------

export type RunStatus = 'scheduled' | 'in_progress' | 'completed';
export type StopStatus = 'pending' | 'en_route' | 'delivered' | 'cancelled';

export interface RunSummary {
  id: string;
  label: string; // "Fri, Nov 6 · 4–7 PM"
  starts_at: string;
  ends_at: string;
  status: RunStatus;
  stop_count: number;
  delivered_count: number;
  can_start: boolean;
}

export interface RunsResponse {
  upcoming: RunSummary[];
  recent: RunSummary[];
}

export interface StopOrder {
  store_order_id: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null; // only while still to be delivered
  items: { product_name: string; quantity: number; unit: string; keep_cold: boolean }[];
  total: number;
  service_fee: number;
}

export interface Stop {
  id: string;
  kind: 'home' | 'pod';
  pod_name: string | null;
  access_notes: string | null; // a pod's gate or door code, while still to be delivered
  shelter_note: string | null; // where to leave it at a pod's drop point
  sequence: number | null;
  status: StopStatus;
  address_line: string | null; // only while still to be delivered
  latitude: number | null;
  longitude: number | null;
  delivered_at: string | null;
  has_photo: boolean;
  note: string | null;
  orders: StopOrder[]; // one at a home; several at a Neighborhood Pod's drop point
}

export interface RunDetail extends RunSummary {
  stops: Stop[];
}

// --- Customer -----------------------------------------------------------------------

export interface DeliverySlot {
  starts_at: string; // send back as delivery_starts_at
  ends_at: string;
  label: string;
}

export interface PodDeliveryOption {
  pod_id: string;
  pod_name: string;
  drop_address_line: string;
  delivery_fee: number; // the least they'd pay: every household orders
  total_fee: number; // the farm's fee for the whole stop: the most they'd pay
  households: number; // how many are in the pod
  savings: number; // the most they'd save against this farm's home delivery fee
  slots: DeliverySlot[]; // this farm's windows on the pod's day
}

export interface FarmDeliveryOption {
  farmer_id: string;
  offers_delivery: boolean;
  available: boolean;
  reason: string | null;
  delivery_fee: number;
  address_line: string; // the customer's saved address
  slots: DeliverySlot[];
  pods: PodDeliveryOption[]; // active pods they can order to instead
}

// Live tracking — GET /orders/{id}/store/{storeOrderId}/tracking, polled
// while a delivery is on its way. The farmer's position only for the
// customer who's next.
export interface DeliveryTracking {
  stage: 'scheduled' | 'on_the_way' | 'delivered' | 'cancelled';
  stops_before: number | null;
  farmer: { latitude: number; longitude: number; heading: number | null; updated_at: string; stale: boolean } | null;
  destination: { latitude: number; longitude: number } | null;
  eta_minutes: number | null;
}

// How a pod order's charge stands (harvesthub-backend/app/pods/charging.py).
export interface PodCharge {
  status: 'not_placed' | 'awaiting' | 'charging' | 'failed' | 'charged' | 'cancelled';
  charge_at: string; // the farm's cutoff
  households_ordered: number;
  households_total: number;
  share_now: number; // each household's share if orders closed now
  full_fee: number;
  failure_reason: string | null;
}

export interface DeliveryProgress {
  window_label: string;
  window_starts_at: string;
  window_ends_at: string;
  stage: 'scheduled' | 'on_the_way' | 'delivered' | 'cancelled';
  stops_before: number | null; // while on the way: 0 = you're next
  delivered_at: string | null;
  has_photo: boolean;
  note: string | null;
  pod_name: string | null; // delivered to this pod's drop point
  collect_within_hours: number | null; // a pod order with cold items
  pod_charge: PodCharge | null;
}
