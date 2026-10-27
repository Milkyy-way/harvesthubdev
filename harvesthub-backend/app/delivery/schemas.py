from typing import Literal, Optional
from pydantic import BaseModel, Field


# --- Farmer: settings ---------------------------------------------------------------------


class DeliveryWindowIn(BaseModel):
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    start_time: str  # "16:00", America/New_York
    end_time: str


class DeliverySettingsIn(BaseModel):
    offers_delivery: bool
    delivery_fee: float = Field(ge=0, le=50)
    radius_miles: float = Field(gt=0, le=50)
    cutoff_hours: int = Field(ge=0, le=168)
    windows: list[DeliveryWindowIn] = Field(default_factory=list, max_length=21)


class DeliveryWindowOut(BaseModel):
    weekday: int
    start_time: str
    end_time: str


class DeliverySettingsOut(BaseModel):
    offers_delivery: bool
    delivery_fee: float
    radius_miles: float
    cutoff_hours: int
    windows: list[DeliveryWindowOut]
    farm_located: bool  # the radius is measured from the farm, so it must be on the map


# --- Farmer: runs -------------------------------------------------------------------------

RunStatus = Literal["scheduled", "in_progress", "completed"]
StopStatus = Literal["pending", "en_route", "delivered", "cancelled"]


class RunSummaryOut(BaseModel):
    id: str
    label: str  # "Fri, Nov 6 · 4–7 PM"
    starts_at: str
    ends_at: str
    status: RunStatus
    stop_count: int
    delivered_count: int
    can_start: bool


class RunsOut(BaseModel):
    upcoming: list[RunSummaryOut]
    recent: list[RunSummaryOut]  # completed in the last week


class StopItemOut(BaseModel):
    product_name: str
    quantity: int
    unit: str


class StopOrderOut(BaseModel):
    store_order_id: str
    status: str
    customer_name: Optional[str]
    customer_phone: Optional[str]  # only while the stop is still to be delivered
    items: list[StopItemOut]
    total: float
    service_fee: float  # what a farmer cancellation would cost them


class StopOut(BaseModel):
    id: str
    sequence: Optional[int]  # route order, once the run has started
    status: StopStatus
    address_line: Optional[str]  # only while still to be delivered
    latitude: Optional[float]
    longitude: Optional[float]
    delivered_at: Optional[str]
    has_photo: bool
    note: Optional[str]
    orders: list[StopOrderOut]  # one today; several at a pod drop point later


class RunDetailOut(RunSummaryOut):
    stops: list[StopOut]


class MarkDeliveredIn(BaseModel):
    # Uploaded first, by the app, to delivery-photos/{farmer uid}/{stop id}.<ext>
    photo_path: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=300)  # e.g. "Left by the side door"


# --- Customer ------------------------------------------------------------------------------


class DeliverySlotOut(BaseModel):
    starts_at: str  # send back as delivery_starts_at at checkout
    ends_at: str
    label: str


class FarmDeliveryOptionOut(BaseModel):
    farmer_id: str
    offers_delivery: bool  # false: don't show a Delivery choice at all
    available: bool  # to this customer, now
    reason: Optional[str]  # why not, in words for the customer
    delivery_fee: float
    address_line: str  # deliveries go to the customer's saved address
    slots: list[DeliverySlotOut]


class DeliveryOptionsOut(BaseModel):
    farms: list[FarmDeliveryOptionOut]


class DeliveryProgressOut(BaseModel):
    window_label: str
    window_starts_at: str
    window_ends_at: str
    stage: Literal["scheduled", "on_the_way", "delivered", "cancelled"]
    stops_before: Optional[int]  # while on the way: deliveries ahead of yours (0 = you're next)
    delivered_at: Optional[str]
    has_photo: bool
    note: Optional[str]


class DeliveryPhotoOut(BaseModel):
    url: Optional[str]  # one-hour link; None if there's no photo
