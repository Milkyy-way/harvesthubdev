from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.customers.service import get_current_customer
from app.orders import service
from app.orders.schemas import (
    CreateOrderRequest,
    CreateOrderResponse,
    OrderOut,
    CancelRequest,
    CollectedRequest,
    ProblemReportRequest,
    ReorderResponse,
    ResumePaymentResponse,
    DiscardResponse,
)
from app.ratings.schemas import SubmitRatingRequest
from app.delivery.schemas import DeliveryPhotoOut, TrackingOut
from app.pods import charging as pod_charging
from app.pickup import service as pickup_service
from app.problems import service as problems_service

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
    pod_charging.adopt_saved_card(db, customer.id, order_id)  # no-op unless it's a pod order
    return service.sync_payment_status(db, str(customer.id), order_id)


@router.post("/{order_id}/resume-payment", response_model=ResumePaymentResponse)
def resume_payment(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    # A checkout left unpaid: the payment sheet again (or the card sheet, for a pod order).
    return service.resume_payment(db, customer, order_id)


@router.post("/{order_id}/discard", response_model=DiscardResponse)
def discard_checkout(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    # A checkout left unpaid, removed: not counted as an order or a cancellation.
    return service.discard_checkout(db, str(customer.id), order_id)


@router.post("/{order_id}/pod-card")
def new_pod_card(order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    # A pod order's card was declined at the cutoff: save another, then sync.
    return pod_charging.prepare_new_card(db, customer.id, order_id)


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
    # Older app builds' "Mark as received". It always refuses now: the farm
    # hands the order over with the customer's code (app/pickup/).
    return service.mark_store_order_completed(db, str(customer.id), order_id, store_order_id)


@router.post("/{order_id}/store/{store_order_id}/extend-pickup", response_model=OrderOut)
def extend_pickup(order_id: str, store_order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    # One extra hour, once, while the pickup window is open.
    return pickup_service.extend(db, str(customer.id), order_id, store_order_id)


@router.post("/{order_id}/store/{store_order_id}/collected", response_model=OrderOut)
def answer_collected(
    order_id: str,
    store_order_id: str,
    payload: CollectedRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    # A cash order marked "not picked": did they collect it after all?
    return pickup_service.answer_collected(db, str(customer.id), order_id, store_order_id, payload.collected)


@router.post("/{order_id}/store/{store_order_id}/problem", response_model=OrderOut)
def report_problem(
    order_id: str,
    store_order_id: str,
    payload: ProblemReportRequest,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    # Report a problem: 24 hours after the handover, or after "not picked".
    return problems_service.create_report(
        db,
        str(customer.id),
        order_id,
        store_order_id,
        payload.reason,
        payload.details,
        [i.model_dump() for i in payload.items],
        payload.photo_paths,
    )


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


@router.get("/{order_id}/store/{store_order_id}/tracking", response_model=TrackingOut)
def delivery_tracking(order_id: str, store_order_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    # Polled every ~10 s by the order screen while a delivery is on its way.
    return service.delivery_tracking(db, str(customer.id), order_id, store_order_id)
