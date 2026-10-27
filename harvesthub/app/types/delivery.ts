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
  items: { product_name: string; quantity: number; unit: string }[];
  total: number;
  service_fee: number;
}

export interface Stop {
  id: string;
  sequence: number | null;
  status: StopStatus;
  address_line: string | null; // only while still to be delivered
  latitude: number | null;
  longitude: number | null;
  delivered_at: string | null;
  has_photo: boolean;
  note: string | null;
  orders: StopOrder[]; // one today; several at a Neighborhood Pod drop point later
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

export interface FarmDeliveryOption {
  farmer_id: string;
  offers_delivery: boolean;
  available: boolean;
  reason: string | null;
  delivery_fee: number;
  address_line: string; // the customer's saved address
  slots: DeliverySlot[];
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
}
