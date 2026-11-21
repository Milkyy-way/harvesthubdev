from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.customers.service import get_current_customer
from app.checkout import service
from app.checkout.schemas import CheckoutPreviewRequest, CheckoutPreviewResponse
from app.core.geo import km_from
from app.customers.places import browse_point
from app.pickup.rules import cash_blocked_reason

router = APIRouter(prefix="/checkout", tags=["checkout"])

@router.post("/preview", response_model=CheckoutPreviewResponse)
def preview_checkout(
    payload: CheckoutPreviewRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    preview = service.build_checkout_preview(db, str(customer.id), payload.groups, payload.payment_method)
    preview["cash_blocked_reason"] = cash_blocked_reason(db, customer.id)
    preview["cash_allowed"] = preview["cash_blocked_reason"] is None
    origin = browse_point(db, customer)
    for group in preview["groups"]:
        group["distance_km"] = km_from(origin, group["latitude"], group["longitude"])
    return preview
