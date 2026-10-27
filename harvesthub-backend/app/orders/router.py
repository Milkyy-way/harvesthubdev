from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.customers.service import get_current_customer
from app.orders import service
from app.orders.schemas import CreateOrderRequest, CreateOrderResponse, OrderOut, CancelRequest, ReorderResponse
from app.ratings.schemas import SubmitRatingRequest
from app.delivery.schemas import DeliveryPhotoOut

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=CreateOrderResponse)
def place_order(payload: CreateOrderRequest, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    order, client_secret = service.create_order(db, customer, payload)
    return {"order": order, "client_secret": client_secret}


@router.get("", response_model=list[OrderOut])
def read_orders(
    status: Optional[str] = Query(None),
    range: Optional[str] = Query(None, description="week | month | 3m | 6m | all"),
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.list_orders(db, str(customer.id), status, range)


@router.get("/{order_id}", response_model=OrderOut)
def read_order(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    service.get_owned_order(db, str(customer.id), order_id)
    return service.build_order_out(db, order_id)


@router.post("/{order_id}/sync-payment-status", response_model=OrderOut)
def sync_payment(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.sync_payment_status(db, str(customer.id), order_id)


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: str,
    payload: CancelRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.cancel_whole_order(db, str(customer.id), order_id, "customer", customer.id, payload.reason)


@router.post("/{order_id}/store/{store_order_id}/cancel", response_model=OrderOut)
def cancel_store(
    order_id: str,
    store_order_id: str,
    payload: CancelRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.cancel_store_order(db, str(customer.id), order_id, store_order_id, "customer", customer.id, payload.reason)


@router.post("/{order_id}/store/{store_order_id}/complete", response_model=OrderOut)
def complete_store(
    order_id: str,
    store_order_id: str,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.mark_store_order_completed(db, str(customer.id), order_id, store_order_id)


@router.post("/{order_id}/store/{store_order_id}/rating", response_model=OrderOut)
def rate_store(
    order_id: str,
    store_order_id: str,
    payload: SubmitRatingRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    return service.submit_store_order_rating(db, str(customer.id), order_id, store_order_id, payload)


@router.post("/{order_id}/reorder", response_model=ReorderResponse)
def reorder(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.reorder(db, str(customer.id), order_id)


@router.get("/{order_id}/store/{store_order_id}/delivery-photo", response_model=DeliveryPhotoOut)
def delivery_photo(order_id: str, store_order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return {"url": service.delivery_photo_url(db, str(customer.id), order_id, store_order_id)}
