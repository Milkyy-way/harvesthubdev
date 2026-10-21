from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.customers.service import get_current_customer
from app.membership import service
from app.membership.schemas import (
    MembershipOverviewOut,
    PrepareCardUpdateOut,
    PrepareJoinOut,
    PrepareJoinRequest,
    SubscribeRequest,
    UpdateCardRequest,
)

# Harvest Pass, the customer membership — see app/membership/service.py for
# the free period every new customer gets and the join flow (card first,
# then subscription).
router = APIRouter(prefix="/membership", tags=["membership"])


@router.get("", response_model=MembershipOverviewOut)
def read_membership(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.get_overview(db, customer.id)


@router.post("/prepare", response_model=PrepareJoinOut)
def prepare_join(
    payload: PrepareJoinRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
    user=Depends(get_current_user),
):
    return service.prepare_join(db, customer.id, user.get("email"), payload.plan)


@router.post("/subscribe", response_model=MembershipOverviewOut)
def subscribe(payload: SubscribeRequest, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.subscribe(db, customer.id, payload.plan, payload.setup_intent_id)


@router.post("/sync", response_model=MembershipOverviewOut)
def sync_membership(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.refresh(db, customer.id)


@router.post("/cancel", response_model=MembershipOverviewOut)
def cancel_membership(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.cancel(db, customer.id)


@router.post("/resume", response_model=MembershipOverviewOut)
def resume_membership(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.resume(db, customer.id)


@router.post("/payment-method/prepare", response_model=PrepareCardUpdateOut)
def prepare_card_update(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.prepare_card_update(db, customer.id)


@router.post("/payment-method", response_model=MembershipOverviewOut)
def update_card(payload: UpdateCardRequest, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.update_card(db, customer.id, payload.setup_intent_id)
