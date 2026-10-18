from pydantic import BaseModel
from typing import Literal, Optional

FulfillmentMethod = Literal["pickup", "delivery"]


class CheckoutGroupRequest(BaseModel):
    farmer_id: str
    fulfillment_method: FulfillmentMethod
    promo_code: Optional[str] = None


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
