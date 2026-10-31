from typing import Literal, Optional
from pydantic import BaseModel, Field

DropKind = Literal["home", "neutral"]
PodStatus = Literal["draft", "pending", "active", "paused", "expired", "dissolved"]
InviteStatus = Literal["sent", "accepted", "declined", "expired", "revoked"]


# --- Choosing a drop point and a day ---------------------------------------------------


class DropPointIn(BaseModel):
    drop_kind: DropKind
    # A neutral location's address. A home drop point is always the host's
    # saved address — never one sent here.
    address_street: Optional[str] = Field(default=None, max_length=200)
    address_city: Optional[str] = Field(default=None, max_length=100)
    address_state: Optional[str] = Field(default=None, max_length=2)
    address_zip: Optional[str] = Field(default=None, max_length=10)
    permission_attested: bool = False  # required for a neutral location
    access_notes: Optional[str] = Field(default=None, max_length=300)  # gate, door code: for the driver
    shelter_note: Optional[str] = Field(default=None, max_length=200)  # required for a neutral location


class PodFarmOut(BaseModel):
    farmer_id: str
    farm_name: str
    pod_delivery_fee: float  # for the whole stop, split evenly across households
    share: float  # one household's share of it
    savings: float  # the share against this farm's home delivery fee


class DropDayOut(BaseModel):
    weekday: int
    label: str  # "Friday"
    farms: list[PodFarmOut]


class DropOptionsOut(BaseModel):
    address_line: str
    days: list[DropDayOut]  # only days at least one farm delivers here


class CreatePodIn(DropPointIn):
    name: str = Field(min_length=1, max_length=40)
    delivery_weekday: int = Field(ge=0, le=6)


# --- A pod ------------------------------------------------------------------------------


class PodMemberOut(BaseModel):
    id: str
    first_name: str  # never more: no last names, addresses or orders
    is_host: bool
    is_me: bool
    leaving: bool
    needs_reapproval: bool


class PodInviteOut(BaseModel):
    id: str
    code: str
    label: Optional[str]
    status: InviteStatus
    expires_at: str
    created_at: str


class PodSummaryOut(BaseModel):
    id: str
    name: str
    status: PodStatus
    is_host: bool
    delivery_day: str  # "Friday"
    address_line: Optional[str]
    member_count: int
    needs_reapproval: bool
    needs_drop_point: bool


class PodOut(PodSummaryOut):
    delivery_weekday: int
    drop_kind: Optional[DropKind]
    shelter_note: Optional[str]
    access_notes: Optional[str]  # the host only
    min_members: int
    size_cap: int
    radius_miles: float
    expires_at: Optional[str]  # a pending pod: when it expires if the minimum isn't reached
    grace_ends_at: Optional[str]  # a paused pod: when it dissolves if it doesn't recover
    reapprove_by: Optional[str]
    # Everyone has ordered for this date, so the drop point can't change.
    drop_locked_date: Optional[str]
    drop_on_its_way: bool  # a farm is on its way there, so it can't change now
    home_address_changed: bool  # the host only: their saved address no longer matches a home drop point
    my_leave_at: Optional[str]  # my own departure, if one is decided
    my_leave_reason: Optional[str]
    members: list[PodMemberOut]
    invites: list[PodInviteOut]  # the host only
    farms: list[PodFarmOut]  # who delivers to this drop point on this day


class PodListOut(BaseModel):
    pods: list[PodSummaryOut]


class UpdateDropIn(DropPointIn):
    pass


class CreateInviteIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=60)


class TransferIn(BaseModel):
    member_id: str
    # True when the host is handing over in order to leave.
    leave: bool = False


# --- The accept screen --------------------------------------------------------------------


class InvitePreviewOut(BaseModel):
    status: InviteStatus
    host_first_name: str
    pod_name: str
    pod_status: PodStatus
    delivery_day: str
    # The full address only to someone within the radius of it: a forwarded
    # link doesn't tell a stranger where the host lives.
    drop_line: str
    shelter_note: Optional[str]
    member_count: int
    size_cap: int
    farms: list[PodFarmOut]
    can_accept: bool
    # Why not, for the customer — unless all that's missing is Harvest Pass.
    blocker: Optional[str]
    needs_harvest_pass: bool
