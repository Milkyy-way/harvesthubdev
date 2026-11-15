from pydantic import BaseModel
from typing import Optional

class CartLineItemOut(BaseModel):
    product_id: str
    name: str
    unit: str
    price: float
    quantity: int
    quantity_available: int
    line_total: float

# One entry per farmer with items in the cart — the cart is grouped this
# way because checkout splits it into one order per farmer (separate
# fulfillment choice, separate total), not one order for the whole cart.
# The farm's town and how far it is, for "Pickup · 4.2 mi". Its street
# address is only shared once an order is placed (2026-11-14): it's on the
# order, not here.
class CartFarmGroupOut(BaseModel):
    farmer_id: str
    farm_name: str
    photo_url: Optional[str]
    address_city: Optional[str]
    address_state: Optional[str]
    distance_km: Optional[float] = None
    items: list[CartLineItemOut]
    subtotal: float

class CartSummary(BaseModel):
    farms: list[CartFarmGroupOut]
    total: float
    item_count: int

class CartActionResponse(BaseModel):
    product_id: str
    quantity: int
    cart_total: float
    cart_item_count: int
