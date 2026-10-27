from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.customers.service import get_current_customer
from app.delivery import service
from app.delivery.schemas import (
    DeliveryOptionsOut,
    DeliverySettingsIn,
    DeliverySettingsOut,
    MarkDeliveredIn,
    RunDetailOut,
    RunsOut,
)
from app.farmers.service import get_current_farmer

# Farm delivery — see app/delivery/service.py. Couldn't-deliver uses the
# farmer orders cancel endpoint (POST /farmers/me/orders/{id}/cancel).
farmer_router = APIRouter(prefix="/farmers/me/delivery", tags=["farmer delivery"])


@farmer_router.get("/settings", response_model=DeliverySettingsOut)
def read_settings(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.get_settings(db, farmer.id)


@farmer_router.put("/settings", response_model=DeliverySettingsOut)
def save_settings(payload: DeliverySettingsIn, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.update_settings(
        db,
        farmer.id,
        payload.offers_delivery,
        payload.delivery_fee,
        payload.radius_miles,
        payload.cutoff_hours,
        [w.model_dump() for w in payload.windows],
    )


@farmer_router.get("/runs", response_model=RunsOut)
def read_runs(db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.list_runs(db, farmer.id)


@farmer_router.get("/runs/{run_id}", response_model=RunDetailOut)
def read_run(run_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.get_run(db, farmer.id, run_id)


@farmer_router.post("/runs/{run_id}/start", response_model=RunDetailOut)
def start_run(run_id: str, db: Session = Depends(get_db), farmer=Depends(get_current_farmer)):
    return service.start_run(db, farmer.id, run_id)


@farmer_router.post("/runs/{run_id}/stops/{stop_id}/delivered", response_model=RunDetailOut)
def mark_delivered(
    run_id: str,
    stop_id: str,
    payload: MarkDeliveredIn,
    db: Session = Depends(get_db),
    farmer=Depends(get_current_farmer),
):
    return service.mark_delivered(db, farmer.id, run_id, stop_id, payload.photo_path, payload.note)


customer_router = APIRouter(prefix="/delivery", tags=["delivery"])


@customer_router.get("/options", response_model=DeliveryOptionsOut)
def read_options(
    farmer_ids: str = Query(..., max_length=2000, description="Comma-separated farmer ids from the cart"),
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    ids = [f.strip() for f in farmer_ids.split(",") if f.strip()][:20]
    return {"farms": service.delivery_options(db, customer.id, ids)}
