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
    product_id: Optional[str]
    product_name: str
    unit: str
    unit_price: float
    quantity: int
    line_total: float


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
    delivery_address_city: Optional[str]
    delivery_address_state: Optional[str]
    delivery_address_zip: Optional[str]
    subtotal: float
    promo_code: Optional[str]
    promo_discount: float
    delivery_fee: float
    service_fee: float
    member_savings: float  # Harvest Pass — the waived service fee
    tax: float
    total: float
    refunded_amount: float
    status: Literal["pending_payment", "paid", "ready_for_pickup", "out_for_delivery", "completed", "cancelled"]
    cancelled_by: Optional[Literal["customer", "farmer", "admin"]]
    cancellation_reason: Optional[str]
    items: list[OrderItemOut]
    my_rating: Optional[int]
    delivery: Optional[DeliveryProgressOut] = None  # delivery orders only


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


class CreateOrderResponse(BaseModel):
    order: OrderOut
    client_secret: Optional[str]


class CancelRequest(BaseModel):
    reason: Optional[str] = None


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


class DashboardSummaryOut(BaseModel):
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
