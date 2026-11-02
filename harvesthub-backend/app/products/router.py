from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.customers.places import browse_point
from app.customers.service import get_current_customer
from app.products import service
from app.products.schemas import ProductOut, HarvestPicksResponse

router = APIRouter(prefix="/products", tags=["products"])

@router.get("", response_model=list[ProductOut])
def read_products(
    farmer_id: str,
    category: str | None = None,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.list_products_for_farmer(db, farmer_id, category, str(customer.id))


@router.get("/harvest", response_model=HarvestPicksResponse)
def read_harvest_picks(
    limit: int = Query(8, ge=1, le=20),
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    latitude, longitude = browse_point(db, customer)
    if latitude is None or longitude is None:
        raise HTTPException(status_code=422, detail="Your delivery address couldn't be located yet")

    items = service.get_harvest_picks(db, latitude, longitude, limit)
    return {"items": items}
