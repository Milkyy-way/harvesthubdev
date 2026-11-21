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
    # Paying at the farm takes the service fee off (2026-11-20). Older app
    # builds don't send it: priced as paying in the app.
    payment_method: Literal["card", "cash_on_pickup"] = "card"


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
# The farm's street address isn't here: it's shared once the order is placed
# (2026-11-14), on the order itself. The town and distance are.
class CheckoutGroupOut(BaseModel):
    farmer_id: str
    farm_name: str
    address_city: Optional[str]
    address_state: Optional[str]
    distance_km: Optional[float] = None
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
    # The 30¢ part of service_fee, on one farm, when the items are under $25.
    fixed_fee: float = 0
    # Paying at the farm: the service fee taken off (service_fee is then 0).
    cash_discount: float = 0
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
    # The 30¢ added when the items come to less than small_order_fee_below.
    small_order_fee: float = 0
    small_order_fee_below: float = 25
    pay_at_farm: bool = False
    # Paying at the farm isn't offered after 2 missed cash pickups.
    cash_allowed: bool = True
    cash_blocked_reason: Optional[str] = None
