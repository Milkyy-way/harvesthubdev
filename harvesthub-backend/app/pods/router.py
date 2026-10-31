from fastapi import APIRouter, Depends, Path, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.customers.service import get_current_customer
from app.pods import service
from app.pods.schemas import (
    CreateInviteIn,
    CreatePodIn,
    DropOptionsOut,
    DropPointIn,
    InvitePreviewOut,
    PodInviteOut,
    PodListOut,
    PodOut,
    TransferIn,
    UpdateDropIn,
)

# Neighborhood Pods — see app/pods/service.py. Customers only: every route is
# for the signed-in customer's own pods, or an invite they were given.
router = APIRouter(prefix="/pods", tags=["pods"])

_CODE = Path(..., min_length=8, max_length=8, pattern=r"^[A-Za-z0-9]+$")


@router.get("", response_model=PodListOut)
def my_pods(db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.list_pods(db, customer.id)


@router.post("/drop-options", response_model=DropOptionsOut)
def drop_options(payload: DropPointIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.drop_options(db, customer, payload)


@router.post("", response_model=PodOut, status_code=status.HTTP_201_CREATED)
def create_pod(payload: CreatePodIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.create_pod(db, customer, payload)


# Invite routes first: "invites" must not be taken for a pod id.
@router.get("/invites/{code}", response_model=InvitePreviewOut)
def preview_invite(code: str = _CODE, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.preview_invite(db, customer, code)


@router.post("/invites/{code}/accept", response_model=PodOut)
def accept_invite(code: str = _CODE, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.accept_invite(db, customer, code)


@router.post("/invites/{code}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invite(code: str = _CODE, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    service.decline_invite(db, customer, code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{pod_id}", response_model=PodOut)
def read_pod(pod_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.get_pod(db, customer.id, pod_id)


@router.post("/{pod_id}/invites", response_model=PodInviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(pod_id: str, payload: CreateInviteIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.create_invite(db, customer.id, pod_id, payload.label)


@router.post("/{pod_id}/invites/{invite_id}/revoke", response_model=PodOut)
def revoke_invite(pod_id: str, invite_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.revoke_invite(db, customer.id, pod_id, invite_id)


@router.post("/{pod_id}/leave", response_model=PodListOut)
def leave_pod(pod_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.leave_pod(db, customer.id, pod_id)


@router.post("/{pod_id}/members/{member_id}/revoke", response_model=PodOut)
def revoke_member(pod_id: str, member_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.revoke_member(db, customer.id, pod_id, member_id)


@router.post("/{pod_id}/transfer", response_model=PodListOut)
def transfer_host(pod_id: str, payload: TransferIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.transfer_host(db, customer.id, pod_id, payload.member_id, payload.leave)


@router.put("/{pod_id}/drop-point", response_model=PodOut)
def update_drop_point(pod_id: str, payload: UpdateDropIn, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.update_drop_point(db, customer, pod_id, payload)


@router.post("/{pod_id}/reapprove", response_model=PodOut)
def reapprove(pod_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.reapprove_drop_point(db, customer, pod_id)


@router.post("/{pod_id}/dissolve", response_model=PodListOut)
def dissolve(pod_id: str, db: Session = Depends(get_db), customer=Depends(get_current_customer)):
    return service.dissolve_pod(db, customer.id, pod_id)
