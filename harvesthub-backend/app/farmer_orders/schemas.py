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


class FarmerOrderOut(BaseModel):
    id: str  # the store order's id — the farmer's unit of fulfillment
    order_id: str
    placed_at: str
    status: Literal["pending_payment", "paid", "ready_for_pickup", "out_for_delivery", "completed", "cancelled"]
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
