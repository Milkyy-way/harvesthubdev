from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.farmers.service import get_current_farmer
from app.promotions import service
from app.promotions.schemas import FarmerPromoCodeIn, FarmerPromoCodeOut, FarmerPromoCodeUpdate

# The farmer app's Promo codes screen. The discount comes off the farm's own
# sales (commission is on what's left). HarvestHub's codes aren't made here.
router = APIRouter(prefix="/farmers/me/promo-codes", tags=["farmer promo codes"])


@router.get("", response_model=list[FarmerPromoCodeOut])
def read_my_codes(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.list_farmer_codes(db, farmer.id)


@router.post("", response_model=FarmerPromoCodeOut, status_code=status.HTTP_201_CREATED)
def create_code(payload: FarmerPromoCodeIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.create_farmer_code(db, farmer.id, payload)


@router.patch("/{code_id}", response_model=FarmerPromoCodeOut)
def update_code(
    code_id: str, payload: FarmerPromoCodeUpdate, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)
):
    return service.update_farmer_code(db, farmer.id, code_id, payload)


@router.delete("/{code_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_code(code_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    service.delete_farmer_code(db, farmer.id, code_id)
