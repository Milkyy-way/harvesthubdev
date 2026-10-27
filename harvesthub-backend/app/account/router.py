import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
import stripe

from app.account import service
from app.core import supabase_admin
from app.membership import service as membership_service
from app.delivery import service as delivery_service
from app.core.database import get_db
from app.core.security import get_current_user

logger = logging.getLogger(__name__)

# Account deletion, for customers and farmers alike (Google Play requires an
# in-app way to delete an account). What's erased vs. kept is described in
# 0027_account_deletion.sql and on the public /delete-account page.
router = APIRouter(prefix="/account", tags=["account"])


class DeletionCheckOut(BaseModel):
    can_delete: bool
    blockers: list[str]


@router.get("/deletion-check", response_model=DeletionCheckOut)
def check_deletion(db: Session = Depends(get_db), user=Depends(get_current_user)):
    blockers = service.deletion_blockers(db, user["id"])
    return {"can_delete": not blockers, "blockers": blockers}


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(db: Session = Depends(get_db), user=Depends(get_current_user)):
    blockers = service.deletion_blockers(db, user["id"])
    if blockers:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=" ".join(blockers))
    if not supabase_admin.is_configured():
        logger.error("Account deletion requested but SUPABASE_SERVICE_ROLE_KEY is not set")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account deletion isn't available right now. Please contact support.",
        )
    # Harvest Pass first: deleting the Stripe customer ends the subscription
    # immediately, so a deleted account is never billed again.
    try:
        membership_service.release_billing_for_deletion(db, user["id"])
    except stripe.error.StripeError as exc:
        logger.error("Account deletion: could not cancel billing for %s: %s", user["id"], exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="We couldn't cancel your Harvest Pass just now. Please try again in a few minutes.",
        )
    doorstep_photos = delivery_service.customer_photo_paths(db, user["id"])
    db.close()  # nothing else to read; don't hold a connection during the Supabase calls
    try:
        service.delete_account(user["id"], doorstep_photos)
    except (supabase_admin.SupabaseAdminError, OSError) as exc:
        logger.error("Account deletion failed for %s: %s", user["id"], exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="We couldn't delete your account just now. Please try again in a few minutes.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
