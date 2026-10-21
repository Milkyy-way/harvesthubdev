from typing import Literal, Optional
from pydantic import BaseModel, Field


class RegisterDeviceRequest(BaseModel):
    token: str = Field(max_length=255)  # Expo push token: ExponentPushToken[...]
    platform: Literal["ios", "android"]


class UnregisterDeviceRequest(BaseModel):
    token: str = Field(max_length=255)


class NotificationSettingsOut(BaseModel):
    push_enabled: bool
    email_enabled: bool
    sms_enabled: bool
    email_available: bool  # false until the email provider is set up
    sms_available: bool  # false until the SMS provider is set up
    sms_phone: Optional[str]  # the number texts go to (+1...), None if the profile has no US number


class UpdateNotificationSettingsRequest(BaseModel):
    push_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
