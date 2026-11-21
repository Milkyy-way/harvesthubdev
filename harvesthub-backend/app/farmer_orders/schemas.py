from datetime import datetime
from pydantic import BaseModel, Field
from typing import Literal, Optional

# The farmer Orders tab's segments. 'to_prepare' = paid card orders + placed
# cash orders; 'ready' = waiting for the customer to pick up, or out on a
# delivery run.
FarmerOrderView = Literal["to_prepare", "ready", "completed", "cancelled"]


class FarmerOrderItemOut(BaseModel):
    product_name: str
    unit: str
    unit_price: float
    quantity: int
    line_total: float
    keep_cold: bool = False


class FarmerOrderOut(BaseModel):
    id: str  # the store order's id — the farmer's unit of fulfillment
    order_id: str
    placed_at: str
    status: Literal["pending_payment", "paid", "ready_for_pickup", "out_for_delivery", "completed", "not_picked", "cancelled"]
    payment_method: Literal["card", "cash_on_pickup"]
    customer_name: Optional[str]
    # Only while the order is still active (to prepare / ready) — the farmer
    # needs it to coordinate pickup, not afterwards.
    customer_phone: Optional[str]
    fulfillment_method: Literal["pickup", "delivery"]
    # Delivery orders: the window it goes out in, and (while active) where to.
    delivery_window_label: Optional[str] = None
    delivery_address_line: Optional[str] = None
    delivery_fee: float = 0  # the farm keeps all of it
    pod_name: Optional[str] = None  # goes to this Neighborhood Pod's drop point
    items: list[FarmerOrderItemOut]
    subtotal: float
    promo_code: Optional[str]
    promo_discount: float
    service_fee: float
    tax: float
    total: float
    # (subtotal - promo) minus the commission, plus any delivery fee — what
    # this order should add to the farmer's payout (an estimate until it's
    # completed and ledgered).
    estimated_earnings: float
    # A cash order not yet picked up: what to collect from the customer.
    amount_to_collect: float
    refunded_amount: float
    cancelled_by: Optional[Literal["customer", "farmer", "admin"]]
    cancellation_reason: Optional[str]
    # Pickup (0042, app/pickup/). The farm never sees the code: the customer
    # tells it at the handover.
    pickup_starts_at: Optional[str] = None
    pickup_ends_at: Optional[str] = None
    pickup_extended: bool = False
    completed_at: Optional[str] = None
    not_picked_at: Optional[str] = None
    # Can enter the customer's code now: while it waits for pickup, and for a
    # day after "not picked" (until hand_over_until).
    can_hand_over: bool = False
    hand_over_until: Optional[str] = None
    picked_up_with: Optional[Literal["code", "backup"]] = None
    # What cancelling now would cost the farm: the service fee (on a Harvest
    # Pass order, the 5% it would have been). 0 for cash.
    cancel_fee: float = 0
    # The backup check (the last 4 digits of their phone) only works with a
    # phone number on file.
    customer_has_phone: bool = False


class ReadyRequest(BaseModel):
    # The window starts now, or at this time (up to 3 days away): packed in
    # the evening, ready from tomorrow morning.
    ready_from: Optional[datetime] = None


class HandOverRequest(BaseModel):
    # The customer's 4-digit code — or, when they can't show it, the last 4
    # digits of their phone and why the code couldn't be used.
    code: Optional[str] = Field(default=None, max_length=8)
    phone_last4: Optional[str] = Field(default=None, max_length=8)
    reason: Optional[str] = Field(default=None, max_length=300)


class FarmerOrderCounts(BaseModel):
    to_prepare: int
    ready: int
    completed: int
    cancelled: int


class FarmerOrdersResponse(BaseModel):
    items: list[FarmerOrderOut]
    counts: FarmerOrderCounts


class FarmerCancelRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=300)
