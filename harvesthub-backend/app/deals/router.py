from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deals import service
from app.deals.schemas import DealCancelIn, DealChangeIn, DealIn, DealListOut, DealOut, DealPreviewOut, DealSetupOut
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
