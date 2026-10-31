import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import supabase_admin

logger = logging.getLogger(__name__)

# Every user's files live under a folder named after their user id
# (0006 and 0009's storage policies enforce that).
_USER_BUCKETS = ("farmer-verification-docs", "farmer-photos", "delivery-photos")

# Store orders the other side is still acting on — the same set the
# farmer's Orders tab treats as active, limited to released orders
# (an unreleased pending_payment card order is an abandoned checkout).
_ACTIVE_STORE_ORDERS = """
    so.released_to_farmer_at is not null
    and so.status in ('pending_payment', 'paid', 'ready_for_pickup', 'out_for_delivery')
"""


def _orders_phrase(count: int) -> str:
    return "1 order" if count == 1 else f"{count} orders"


def deletion_blockers(db: Session, user_id: str) -> list[str]:
    """Why this account can't be deleted yet, as messages for the user —
    empty when it can. Deleting mid-order would strand the other side, and
    a farmer's unpaid earnings (or a balance owed from cash orders) has to
    be settled first."""
    params = {"uid": user_id}
    blockers: list[str] = []

    as_customer = db.execute(
        text(f"""
            select count(*) from store_orders so
            join orders o on o.id = so.order_id
            where o.customer_id = :uid and {_ACTIVE_STORE_ORDERS}
        """),
        params,
    ).scalar_one()
    # Pod orders placed but not charged yet aren't released to the farmer, but
    # they're still orders: deleting the account would remove the saved card.
    awaiting_charge = db.execute(
        text("""
            select count(*) from payments p
            where p.customer_id = :uid and p.status in ('awaiting_cutoff', 'charging', 'charge_failed')
        """),
        params,
    ).scalar_one()
    as_customer += awaiting_charge
    if as_customer:
        blockers.append(f"You have {_orders_phrase(as_customer)} in progress. Pick them up or cancel them first.")

    as_farmer = db.execute(
        text(f"select count(*) from store_orders so where so.farmer_id = :uid and {_ACTIVE_STORE_ORDERS}"),
        params,
    ).scalar_one()
    if as_farmer:
        blockers.append(f"You have {_orders_phrase(as_farmer)} to fulfill. Complete or cancel them first.")

    open_entries = db.execute(
        text("select count(*) from farmer_ledger_entries where farmer_id = :uid and status = 'open'"),
        params,
    ).scalar_one()
    if open_entries:
        blockers.append(
            "You have sales that haven't been paid out yet. Your account can be deleted after the payout for them is sent."
        )

    waiting = db.execute(
        text("select coalesce(sum(net_total), 0) from farmer_payouts where farmer_id = :uid and status = 'pending_disbursement'"),
        params,
    ).scalar_one()
    if waiting:
        blockers.append(f"A payout of ${waiting:.2f} is still being sent to you. You can delete your account once it's paid.")

    owed = db.execute(
        text("""
            select coalesce(sum(net_total), 0) from farmer_payouts
            where farmer_id = :uid and status = 'carried_forward' and carried_into_payout_id is null
        """),
        params,
    ).scalar_one()
    if owed:
        blockers.append(f"You owe HarvestHub ${-owed:.2f} from cash orders. Contact support to settle it first.")

    hosting = db.execute(
        text("""
            select count(*) from pods p
            where p.host_id = :uid and p.status not in ('expired', 'dissolved')
              and exists (
                select 1 from pod_members m
                where m.pod_id = p.id and m.status = 'active' and m.customer_id <> :uid
              )
        """),
        params,
    ).scalar_one()
    if hosting:
        blockers.append("You host a Neighborhood Pod with other members. Hand it to another member or end it first.")

    return blockers


def delete_account(user_id: str, doorstep_photos: list[str] | None = None) -> None:
    """Deletes the user's Storage files, then the auth user — 0027's
    trigger erases or anonymizes everything in the database in the same
    step. Files go first so a failure never leaves documents (a government
    ID, a business license) behind an account that no longer exists; if
    either step fails, the user can simply try again.

    doorstep_photos: a customer's proof-of-delivery photos, which live in
    the farmers' folders (app/delivery/service.py::customer_photo_paths)."""
    for bucket in _USER_BUCKETS:
        paths = supabase_admin.list_storage_paths(bucket, user_id)
        if paths:
            supabase_admin.delete_storage_paths(bucket, paths)
    if doorstep_photos:
        supabase_admin.delete_storage_paths("delivery-photos", doorstep_photos)
    supabase_admin.delete_auth_user(user_id)
    logger.info("Deleted account %s", user_id)
