from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.notifications import service
from app.notifications.schemas import (
    NotificationSettingsOut,
    RegisterDeviceRequest,
    UnregisterDeviceRequest,
    UpdateNotificationSettingsRequest,
)

# For any signed-in user, customer or farmer — see app/notifications/service.py.
router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
def register_device(payload: RegisterDeviceRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    service.register_device(db, user["id"], payload.token, payload.platform)


@router.post("/devices/unregister", status_code=status.HTTP_204_NO_CONTENT)
def unregister_device(payload: UnregisterDeviceRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    service.unregister_device(db, user["id"], payload.token)


@router.get("/settings", response_model=NotificationSettingsOut)
def read_settings(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.get_settings(db, user["id"])


@router.put("/settings", response_model=NotificationSettingsOut)
def update_settings(
    payload: UpdateNotificationSettingsRequest, db: Session = Depends(get_db), user=Depends(get_current_user)
):
    return service.update_settings(db, user["id"], payload.push_enabled, payload.email_enabled, payload.sms_enabled)
