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
    offers_pod_delivery: bool = False
    pod_delivery_fee: float = Field(default=5.00, ge=0, le=50)


class DeliveryWindowOut(BaseModel):
    weekday: int
    start_time: str
    end_time: str


class DeliverySettingsOut(BaseModel):
    offers_delivery: bool
    delivery_fee: float
    radius_miles: float
    cutoff_hours: int
    offers_pod_delivery: bool
    pod_delivery_fee: float  # for a drop point, split evenly across the pod's households
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
    keep_cold: bool = False


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
    kind: Literal["home", "pod"]
    pod_name: Optional[str]
    access_notes: Optional[str]  # a pod's gate or door code, while still to be delivered
    shelter_note: Optional[str]  # where to leave it at a pod's drop point
    sequence: Optional[int]  # route order, once the run has started
    status: StopStatus
    address_line: Optional[str]  # only while still to be delivered
    latitude: Optional[float]
    longitude: Optional[float]
    delivered_at: Optional[str]
    has_photo: bool
    note: Optional[str]
    orders: list[StopOrderOut]  # one at a home; several at a pod's drop point


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


class PodDeliveryOptionOut(BaseModel):
    pod_id: str  # send back as pod_id at checkout
    pod_name: str
    drop_address_line: str
    delivery_fee: float  # the least they'd pay: every household orders
    total_fee: float  # the farm's fee for the whole stop: the most they'd pay
    households: int  # how many are in the pod
    savings: float  # the most they'd save against this farm's home delivery fee
    slots: list[DeliverySlotOut]  # this farm's windows on the pod's day


class FarmDeliveryOptionOut(BaseModel):
    farmer_id: str
    offers_delivery: bool  # false: don't show a Delivery choice at all
    available: bool  # to this customer, now
    reason: Optional[str]  # why not, in words for the customer
    delivery_fee: float
    address_line: str  # deliveries go to the customer's saved address
    slots: list[DeliverySlotOut]
    pods: list[PodDeliveryOptionOut] = []  # active pods they can order to instead


class DeliveryOptionsOut(BaseModel):
    farms: list[FarmDeliveryOptionOut]


class PodChargeOut(BaseModel):
    status: Literal["not_placed", "awaiting", "charging", "failed", "charged", "cancelled"]
    charge_at: str  # the farm's cutoff
    households_ordered: int
    households_total: int
    share_now: float  # each household's share if orders closed now
    full_fee: float
    failure_reason: Optional[str]


class DeliveryProgressOut(BaseModel):
    window_label: str
    window_starts_at: str
    window_ends_at: str
    stage: Literal["scheduled", "on_the_way", "delivered", "cancelled"]
    stops_before: Optional[int]  # while on the way: deliveries ahead of yours (0 = you're next)
    delivered_at: Optional[str]
    has_photo: bool
    note: Optional[str]
    pod_name: Optional[str] = None  # delivered to this pod's drop point
    collect_within_hours: Optional[int] = None  # a pod order with cold items
    pod_charge: Optional[PodChargeOut] = None  # how a pod order's charge stands


class DeliveryPhotoOut(BaseModel):
    url: Optional[str]  # one-hour link; None if there's no photo


# --- Live tracking (0033) -------------------------------------------------------------------


class LocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    heading: Optional[float] = Field(default=None, ge=0, le=360)  # degrees from north


class PointOut(BaseModel):
    latitude: float
    longitude: float


class FarmerPositionOut(PointOut):
    heading: Optional[float]
    updated_at: str
    stale: bool  # no update for a few minutes (signal lost, phone off)


class TrackingOut(BaseModel):
    stage: Literal["scheduled", "on_the_way", "delivered", "cancelled"]
    stops_before: Optional[int]
    # Only for the customer who's next — before that it's just stops_before.
    farmer: Optional[FarmerPositionOut]
    destination: Optional[PointOut]  # their own stop
    eta_minutes: Optional[int]  # rough: straight-line distance, typical speed
