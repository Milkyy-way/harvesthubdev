from pydantic import BaseModel
from typing import Literal, Optional

FulfillmentMethod = Literal["pickup", "delivery"]


class CheckoutGroupRequest(BaseModel):
    farmer_id: str
    fulfillment_method: FulfillmentMethod
    promo_code: Optional[str] = None
    # Delivery: the chosen window's start, exactly as GET /delivery/options
    # returned it (slots[].starts_at).
    delivery_starts_at: Optional[str] = None
    # Deliver to this Neighborhood Pod's drop point instead of home.
    pod_id: Optional[str] = None


class CheckoutPreviewRequest(BaseModel):
    groups: list[CheckoutGroupRequest]


class CheckoutLineItemOut(BaseModel):
    product_id: str
    name: str
    unit: str
    price: float
    quantity: int
    line_total: float


# One entry per farmer in this checkout — mirrors CartFarmGroupOut's
# grouping (see app/cart/schemas.py) but adds the actual money breakdown.
# Recomputed fully server-side from the customer's real cart_items on every
# call; never trusts client-supplied prices or quantities.
class CheckoutGroupOut(BaseModel):
    farmer_id: str
    farm_name: str
    address_street: Optional[str]
    address_city: Optional[str]
    address_state: Optional[str]
    address_zip: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    fulfillment_method: FulfillmentMethod
    items: list[CheckoutLineItemOut]
    subtotal: float
    promo_code: Optional[str]
    promo_discount: float
    promo_error: Optional[str]
    delivery_fee: float
    # Delivery only: the window, where it goes (the customer's saved
    # address), or why it can't be delivered — the order can't be placed
    # while delivery_error is set.
    delivery_window_label: Optional[str] = None
    delivery_address_line: Optional[str] = None
    delivery_error: Optional[str] = None
    pod_id: Optional[str] = None
    pod_name: Optional[str] = None
    pod_savings: float = 0  # the most the pod can save against home delivery
    # A pod order: delivery_fee and farm_total are the most it can come to. It's
    # charged once at charge_at, with the fee divided among those who ordered,
    # down to pod_fee_low if every household does.
    pod_fee_low: Optional[float] = None
    charge_at: Optional[str] = None
    service_fee: float
    member_savings: float  # service fee Harvest Pass waived for this farm
    tax: float
    farm_total: float


class CheckoutPreviewResponse(BaseModel):
    groups: list[CheckoutGroupOut]
    grand_total: float
    is_member: bool
    member_savings: float
    # Non-members only: what Harvest Pass would save on this checkout (0
    # below the minimum) — drives the checkout upsell.
    member_potential_savings: float
    member_min_subtotal: float
    items_subtotal: float
