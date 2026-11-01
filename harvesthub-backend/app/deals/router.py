from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.customers.service import get_current_customer
from app.deals import closing
from app.deals import customer as customer_side
from app.deals import service
from app.deals.schemas import (
    CustomerDealOut,
    DealCancelIn,
    DealCardListOut,
    DealChangeIn,
    DealExtendIn,
    DealIn,
    DealJoinIn,
    DealJoinOut,
    DealListOut,
    DealOut,
    DealPreviewOut,
    DealQuoteIn,
    DealQuoteOut,
    DealRecordOut,
    DealSetupOut,
    FollowOut,
)
from app.farmers.service import get_current_farmer

# Threshold group deals, the farmer's side — see app/deals/service.py. Scoped to
# the signed-in, approved farmer: anyone else's deal id is a 404.
router = APIRouter(prefix="/farmers/me/deals", tags=["group deals"])


@router.get("", response_model=DealListOut)
def my_deals(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return {"deals": service.list_deals(db, farmer.id)}


@router.get("/setup", response_model=DealSetupOut)
def deal_setup(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.setup(db, farmer.id)


@router.get("/record", response_model=DealRecordOut)
def deal_record(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.record(db, farmer.id)


@router.post("/preview", response_model=DealPreviewOut)
def preview_deal(payload: DealIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.preview(db, farmer.id, payload)


@router.post("", response_model=DealOut, status_code=201)
def create_draft(payload: DealIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.create_draft(db, farmer.id, payload)


@router.get("/{deal_id}", response_model=DealOut)
def read_deal(deal_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.get_deal(db, farmer.id, deal_id)


@router.put("/{deal_id}", response_model=DealOut)
def update_draft(deal_id: str, payload: DealIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.update_draft(db, farmer.id, deal_id, payload)


@router.delete("/{deal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(deal_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    service.delete_draft(db, farmer.id, deal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{deal_id}/publish", response_model=DealOut)
def publish_deal(deal_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.publish(db, farmer.id, deal_id)


@router.patch("/{deal_id}", response_model=DealOut)
def change_deal(deal_id: str, payload: DealChangeIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.change_published(db, farmer.id, deal_id, payload)


@router.post("/{deal_id}/cancel", response_model=DealOut)
def cancel_deal(deal_id: str, payload: DealCancelIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.cancel(db, farmer.id, deal_id, payload.reason)


@router.post("/{deal_id}/extend", response_model=DealOut)
def extend_deal(deal_id: str, payload: DealExtendIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.extend(db, farmer.id, deal_id, payload.days)


# The customer's side — see app/deals/customer.py.
customer_router = APIRouter(prefix="/deals", tags=["group deals"])


@customer_router.get("", response_model=DealCardListOut)
def open_deals(farmer_id: str | None = None, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return {"deals": customer_side.list_deals(db, customer, farmer_id)}


@customer_router.get("/{deal_id}", response_model=CustomerDealOut)
def one_deal(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.get_deal(db, customer, deal_id)


@customer_router.post("/{deal_id}/quote", response_model=DealQuoteOut)
def quote_deal(deal_id: str, payload: DealQuoteIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.quote(db, customer, deal_id, payload)


@customer_router.post("/{deal_id}/join", response_model=DealJoinOut)
def join_deal(deal_id: str, payload: DealJoinIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.join(db, customer, deal_id, payload)


@customer_router.post("/{deal_id}/join/confirm", response_model=CustomerDealOut)
def confirm_join(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.confirm_join(db, customer, deal_id)


@customer_router.post("/{deal_id}/withdraw", response_model=CustomerDealOut)
def withdraw(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.withdraw(db, customer, deal_id)


@customer_router.post("/{deal_id}/regular-price", response_model=CustomerDealOut)
def buy_regular(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return closing.buy_at_regular_price(db, customer, deal_id)


@customer_router.post("/{deal_id}/waitlist", response_model=CustomerDealOut)
def join_waitlist(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.join_waitlist(db, customer, deal_id)


@customer_router.delete("/{deal_id}/waitlist", response_model=CustomerDealOut)
def leave_waitlist(deal_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return customer_side.leave_waitlist(db, customer, deal_id)


# Following a farm: hearing when it publishes a deal.
follow_router = APIRouter(prefix="/farm-follows", tags=["group deals"])


@follow_router.get("/{farmer_id}", response_model=FollowOut)
def am_i_following(farmer_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return {"following": customer_side.is_following(db, customer.id, farmer_id)}


@follow_router.put("/{farmer_id}", response_model=FollowOut)
def follow(farmer_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return {"following": customer_side.set_following(db, customer.id, farmer_id, True)}


@follow_router.delete("/{farmer_id}", response_model=FollowOut)
def unfollow(farmer_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return {"following": customer_side.set_following(db, customer.id, farmer_id, False)}
