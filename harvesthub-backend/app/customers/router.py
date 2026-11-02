from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import get_current_user
from app.customers import places, service
from app.customers.schemas import CustomerProfileOut, PlaceChoiceIn, PlaceIn, PlacesOut
from app.orders import service as orders_service
from app.orders.schemas import DashboardSummaryOut

router = APIRouter(prefix="/customers", tags=["customers"])

@router.get("/me", response_model=CustomerProfileOut)
def read_my_profile(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.get_or_geocode_profile(db, user["id"])

@router.get("/me/dashboard-summary", response_model=DashboardSummaryOut)
def read_my_dashboard_summary(
    range: str | None = Query(None, description="week | month | 3m | 6m | all"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return orders_service.get_dashboard_summary(db, user["id"], range)


# Saved places, like Work, to browse nearby farms from (app/customers/places.py).
@router.get("/me/places", response_model=PlacesOut)
def read_my_places(db: Session = Depends(get_db), customer=Depends(service.get_current_customer)):
    return places.list_places(db, customer)


@router.post("/me/places", response_model=PlacesOut, status_code=201)
def add_my_place(payload: PlaceIn, db: Session = Depends(get_db), customer=Depends(service.get_current_customer)):
    return places.add_place(db, customer, payload)


@router.put("/me/places/active", response_model=PlacesOut)
def choose_my_place(payload: PlaceChoiceIn, db: Session = Depends(get_db), customer=Depends(service.get_current_customer)):
    return places.choose(db, customer, payload.place_id)


@router.delete("/me/places/{place_id}", response_model=PlacesOut)
def remove_my_place(place_id: str, db: Session = Depends(get_db), customer=Depends(service.get_current_customer)):
    return places.remove_place(db, customer, place_id)
