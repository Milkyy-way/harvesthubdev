from pydantic import BaseModel

from app.delivery.schemas import DeliveryProgressOut
from typing import Literal, Optional

FulfillmentMethod = Literal["pickup", "delivery"]
# 'card' covers everything the native Stripe PaymentSheet offers (manually
# entered card, Apple Pay, Google Pay) — the sheet itself decides what to
# show based on device capability, the app doesn't distinguish which.
PaymentMethod = Literal["card", "cash_on_pickup"]


class CreateOrderGroup(BaseModel):
    farmer_id: str
    fulfillment_method: FulfillmentMethod
    promo_code: Optional[str] = None
    # Delivery: the chosen window (GET /delivery/options slots[].starts_at).
    # It goes to the customer's saved address — never one sent here — or, with
    # pod_id, to that Neighborhood Pod's drop point.
    delivery_starts_at: Optional[str] = None
    pod_id: Optional[str] = None


class CreateOrderRequest(BaseModel):
    groups: list[CreateOrderGroup]
    payment_method: PaymentMethod


class OrderItemOut(BaseModel):
    id: Optional[str] = None  # the order line, for "Report a problem"
    product_id: Optional[str]
    product_name: str
    unit: str
    unit_price: float
    quantity: int
    line_total: float


class PickupOut(BaseModel):
    """A pickup's window and code (0042, app/pickup/)."""

    ready_at: Optional[str] = None  # when the farm tapped Ready
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    extended: bool = False
    can_extend: bool = False  # the one extra hour, while the window is open
    # Shown while it waits for pickup, and for a day after "not picked"
    # (the farm can still hand it over then).
    code: Optional[str] = None
    picked_up_at: Optional[str] = None
    not_picked_at: Optional[str] = None
    # Not packed by then: the customer can cancel with everything back.
    free_cancel_from: Optional[str] = None


class ProblemOut(BaseModel):
    status: Literal["open", "refunded", "declined", "handled"]
    reason: str
    created_at: Optional[str] = None
    refund_amount: Optional[float] = None
    note: Optional[str] = None  # HarvestHub's note to the customer
    photo_count: int = 0


class StoreOrderOut(BaseModel):
    id: str
    farmer_id: str
    farm_name: str
    photo_url: Optional[str]
    fulfillment_method: FulfillmentMethod
    pickup_address_street: Optional[str]
    pickup_address_city: Optional[str]
    pickup_address_state: Optional[str]
    pickup_address_zip: Optional[str]
    delivery_address_street: Optional[str]
    group_deal_id: Optional[str] = None
    delivery_address_city: Optional[str]
    delivery_address_state: Optional[str]
    delivery_address_zip: Optional[str]
    subtotal: float
    promo_code: Optional[str]
    promo_discount: float
    delivery_fee: float
    service_fee: float
    member_savings: float  # Harvest Pass — the waived service fee
    # The 30¢ part of service_fee (a payment under $25), and, paid at the
    # farm, the service fee taken off as a discount (2026-11-20).
    fixed_fee: float = 0
    cash_discount: float = 0
    tax: float
    total: float
    refunded_amount: float
    status: Literal["pending_payment", "paid", "ready_for_pickup", "out_for_delivery", "completed", "not_picked", "cancelled"]
    cancelled_by: Optional[Literal["customer", "farmer", "admin"]]
    cancellation_reason: Optional[str]
    items: list[OrderItemOut]
    my_rating: Optional[int]
    my_rating_comment: Optional[str] = None  # shown back to the customer (fix list 31)
    delivery: Optional[DeliveryProgressOut] = None  # delivery orders only
    # What the customer can do now (app/orders/service.py::cancel_terms):
    # cancel, and what would come back; or why not.
    can_cancel: bool = False
    cancel_blocked_reason: Optional[str] = None
    cancel_refund: float = 0
    cancel_keeps_service_fee: bool = False
    pickup: Optional[PickupOut] = None  # pickup orders only
    completed_at: Optional[str] = None  # handed over: picked up, or delivered
    problem: Optional[ProblemOut] = None
    can_report_problem: bool = False
    report_until: Optional[str] = None
    # A cash order not picked up: "Did you collect this order?"
    ask_collected: bool = False


class PaymentOut(BaseModel):
    id: str
    amount: float
    currency: str
    payment_method: PaymentMethod
    status: str
    failure_reason: Optional[str]
    # A pod order: save a card with client_secret (a SetupIntent), and it's
    # charged at the farm's cutoff.
    charged_at_cutoff: bool = False


class OrderOut(BaseModel):
    id: str
    status: Literal["active", "completed", "cancelled"]
    placed_at: str
    grand_total: float
    store_orders: list[StoreOrderOut]
    payment: Optional[PaymentOut]
    # Not paid for yet (2026-11-14): the payment sheet was closed, or the card
    # declined. Not an order yet: the farm hasn't seen it, nothing was charged,
    # and it isn't counted. The customer can pay (POST /orders/{id}/resume-payment)
    # or remove it (POST /orders/{id}/discard) until pay_by; after that the
    # scheduled job removes it.
    checkout_unfinished: bool = False
    pay_by: Optional[str] = None
    # Removed unpaid (0041): only reachable by its link, never listed.
    removed: bool = False


class CreateOrderResponse(BaseModel):
    order: OrderOut
    client_secret: Optional[str]


class ResumePaymentResponse(BaseModel):
    order: OrderOut
    # None when there's nothing left to pay (it went through meanwhile).
    client_secret: Optional[str]
    # A pod order saves a card (a SetupIntent) instead of paying now.
    card_setup: bool = False


class DiscardResponse(BaseModel):
    # False when the payment turned out to have gone through: `order` is then
    # the placed order.
    removed: bool
    order: Optional[OrderOut] = None


class CancelRequest(BaseModel):
    reason: Optional[str] = None


class CollectedRequest(BaseModel):
    collected: bool


class ProblemItemIn(BaseModel):
    item_id: str
    quantity: int


class ProblemReportRequest(BaseModel):
    reason: Literal["missing_item", "damaged", "wrong_item", "quality", "farm_closed", "other"]
    details: Optional[str] = None
    items: list[ProblemItemIn] = []
    # Uploaded first, to problem-photos/{customer id}/{store order id}/{1..3}.{ext} (0043).
    photo_paths: list[str] = []


class ReorderResponse(BaseModel):
    added_count: int
    skipped_count: int
    cart_item_count: int


class DailyActivityOut(BaseModel):
    date: str
    order_count: int
    amount: float


class FavoriteFarmOut(BaseModel):
    farmer_id: str
    farm_name: str
    order_count: int


class TopProductOut(BaseModel):
    product_name: str
    quantity: int


class CategorySpendOut(BaseModel):
    slug: str  # 'other' for lines whose product no longer exists
    name: str
    amount: float  # item value only — fees and tax excluded
    color_slot: Optional[int]  # fixed chart color for an all-time top category; null = "Other"


class PeriodTotalsOut(BaseModel):
    start: str  # the previous period's first day, YYYY-MM-DD
    orders_total: int
    spending: float
    savings: float


class DashboardSummaryOut(BaseModel):
    # The calendar period asked for ('month' | 'year'), with its first day and
    # the next period's first day (local time, YYYY-MM-DD); 'all' or None
    # otherwise. `previous` is the period before, for "+2 vs October".
    period: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    previous: Optional[PeriodTotalsOut] = None
    first_order_on: Optional[str] = None  # how far back the arrows go
    orders_total: int
    orders_active: int
    orders_completed: int
    orders_cancelled: int
    # Scoped to whatever `range` was requested (all-time when omitted) —
    # see app/orders/service.py::get_dashboard_summary.
    spending_all_time: float
    savings_all_time: float
    average_order_value: float
    activity_last_7_days: list[DailyActivityOut]
    favorite_farm: Optional[FavoriteFarmOut]
    most_ordered_product: Optional[TopProductOut]
    spending_by_category: list[CategorySpendOut]  # in range, largest first
