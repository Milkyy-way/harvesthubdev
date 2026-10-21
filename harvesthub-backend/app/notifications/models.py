from datetime import datetime
from sqlalchemy import Boolean, Column, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB, UUID
from app.core.database import Base


class PushToken(Base):
    """One row per phone the user is signed in on (an Expo push token)."""

    __tablename__ = "push_tokens"

    token = Column(String, primary_key=True)
    profile_id = Column(UUID(as_uuid=True), nullable=False)
    platform = Column(String, nullable=False)  # 'ios' | 'android'
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    last_seen_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class NotificationSettings(Base):
    """Which channels the user wants. No row = the defaults (push and email
    on, text messages off until they opt in)."""

    __tablename__ = "notification_settings"

    profile_id = Column(UUID(as_uuid=True), primary_key=True)
    push_enabled = Column(Boolean, nullable=False, default=True)
    email_enabled = Column(Boolean, nullable=False, default=True)
    sms_enabled = Column(Boolean, nullable=False, default=False)
    # When they turned text messages on — the record of their consent.
    sms_consented_at = Column(TIMESTAMP(timezone=True), nullable=True)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class Notification(Base):
    """Every notification sent, and what happened on each channel."""

    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True)
    profile_id = Column(UUID(as_uuid=True), nullable=False)
    kind = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(String, nullable=False)
    data = Column(JSONB, nullable=False, default=dict)
    # Same key = the same event: it's only ever sent once (webhook retries,
    # the hourly job running again, two requests racing).
    dedupe_key = Column(String, nullable=True, unique=True)
    # 'sent' | 'off' (user turned it off) | 'none' (no device/email/phone)
    # | 'not_configured' (no provider key) | 'failed: ...'
    push_status = Column(String, nullable=True)
    email_status = Column(String, nullable=True)
    sms_status = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
