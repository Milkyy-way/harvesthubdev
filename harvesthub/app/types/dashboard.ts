// Matches the FastAPI backend's dashboard schemas
// (harvesthub-backend/app/orders/schemas.py) — GET /customers/me/dashboard-summary.

export interface DailyActivity {
  date: string;
  order_count: number;
  amount: number;
}

export interface FavoriteFarm {
  farmer_id: string;
  farm_name: string;
  order_count: number;
}

export interface TopProduct {
  product_name: string;
  quantity: number;
}

// The donut ("What you buy"): item totals per category in range, largest
// first. color_slot is the category's fixed chart color (one of the
// customer's all-time top categories) — null means it's grouped as "Other".
export interface CategorySpend {
  slug: string;
  name: string;
  amount: number;
  color_slot: number | null;
}

// The period before the one asked for, for "+2 vs Oct".
export interface PeriodTotals {
  start: string;
  orders_total: number;
  spending: number;
  savings: number;
}

// spending_all_time/savings_all_time/average_order_value/favorite_farm/
// most_ordered_product/orders_* are all scoped to the period asked for
// (`period` + `start`: a calendar month or year, see lib/period.ts and
// PeriodPicker; all time when omitted) — app/orders/service.py::
// get_dashboard_summary. activity_last_7_days is the one exception: always
// the real last 7 days.
export interface DashboardSummary {
  period?: 'month' | 'year' | 'all' | null;
  period_start?: string | null;
  period_end?: string | null;
  previous?: PeriodTotals | null;
  /** The customer's first order day, 'YYYY-MM-DD': the arrows stop there. */
  first_order_on?: string | null;
  orders_total: number;
  orders_active: number;
  orders_completed: number;
  orders_cancelled: number;
  spending_all_time: number;
  savings_all_time: number;
  average_order_value: number;
  activity_last_7_days: DailyActivity[];
  favorite_farm: FavoriteFarm | null;
  most_ordered_product: TopProduct | null;
  spending_by_category: CategorySpend[];
}
