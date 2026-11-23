from pydantic import BaseModel
from typing import Literal, Optional


# One set of money lines, used for an open week and for a payout:
#   earnings = gross - commission            (what the farmer made)
#   net      = earnings - cash_collected - fees + carried_in
#            (what HarvestHub transfers; negative = the farmer owes)
class EarningsBreakdown(BaseModel):
    gross: float  # sales, after the farmer's own promo discounts
    commission: float
    earnings: float
    cash_collected: float  # cash the farmer already took in hand at pickup
    fees: float  # farmer-cancellation fees
    carried_in: float  # owed amounts folded in from earlier weeks (<= 0); payouts only
    net: float


class LedgerActivityOut(BaseModel):
    id: str
    entry_type: Literal["order", "refund_adjustment", "cancellation_fee"]
    store_order_id: Optional[str] = None  # opens the order's statement
    created_at: str
    customer_name: Optional[str]
    order_placed_at: Optional[str]
    item_count: int
    payment_method: Optional[Literal["card", "cash_on_pickup"]]
    gross: float
    commission: float
    cash_collected: float
    fee: float
    net: float


class OpenPeriodOut(BaseModel):
    period_start: str
    period_end: str
    is_current_week: bool
    # The Friday the weekly job turns this week into a payout: the first
    # Friday run AFTER the week has fully ended, i.e. period_end + 7 days.
    payout_prepared_on: str
    breakdown: EarningsBreakdown
    entries: list[LedgerActivityOut]


class InProgressOut(BaseModel):
    order_count: int  # released orders not picked up yet — not on the ledger until completed
    estimated_earnings: float


class PayoutOut(BaseModel):
    id: str
    period_start: str
    period_end: str
    breakdown: EarningsBreakdown
    status: Literal["pending_disbursement", "paid", "carried_forward"]
    disbursed_at: Optional[str]
    carried_into_period_end: Optional[str]  # when carried_forward: which later payout absorbed it


class FarmerEarningsOut(BaseModel):
    commission_rate: float
    open_periods: list[OpenPeriodOut]  # newest first; always includes the current week
    in_progress: InProgressOut
    awaiting_payout: float  # prepared payouts not yet sent (positive)
    owed_carrying: float  # owed amounts waiting to come off the next payout (<= 0)
    lifetime_earnings: float
    lifetime_paid_out: float
    payouts: list[PayoutOut]  # newest first


# --- Transactions and statements (2026-11-22, app/farmer_earnings/statements.py) ---


class TransactionOut(BaseModel):
    id: str
    kind: Literal["sale", "refund", "charge", "payout"]
    at: Optional[str]
    title: str
    detail: str
    amount: float  # what it does to the farm's money (negative = comes off)
    store_order_id: Optional[str]  # sale/refund/charge: opens the order's statement
    order_ref: Optional[str]
    period_start: str  # the pay week, for its weekly statement
    payout_status: Optional[str]  # payouts: open | pending | paid | settled | owed | carried


class TransactionsOut(BaseModel):
    items: list[TransactionOut]
    next_before: Optional[str]  # pass back as ?before= for the next page


class StatementItemOut(BaseModel):
    name: str
    unit: str
    quantity: int
    unit_price: float
    line_total: float


class StatementLineOut(BaseModel):
    label: str
    amount: float


class PayoutStateOut(BaseModel):
    status: str
    label: str
    paid_on: Optional[str]


class StatementEntryOut(BaseModel):
    kind: Literal["sale", "refund", "charge"]
    at: Optional[str]
    lines: list[StatementLineOut]
    net: float
    period_start: str
    period_end: str
    payout: PayoutStateOut


class OrderStatementOut(BaseModel):
    store_order_id: str
    order_ref: str
    customer: str  # "First L."
    placed_at: Optional[str]
    finished_at: Optional[str]
    what_happened: str
    fulfillment_method: str
    payment_method: Literal["card", "cash_on_pickup"]
    items: list[StatementItemOut]
    items_total: float
    promo_code: Optional[str]
    promo_discount: float
    delivery_fee: float
    tax: float  # collected by HarvestHub; not the farm's
    cash_total: Optional[float]  # cash orders: what the customer pays at pickup
    entries: list[StatementEntryOut]
    net: float
    note: Optional[str]


class StatementLinkOut(BaseModel):
    path: str  # on the API's origin, e.g. /statements/<token>; opens in the browser
    expires_in: int
