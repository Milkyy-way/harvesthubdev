"""Notifications — one call, notify(), sends a notification to a user on
every channel it uses (push / email / text, see messages.py) that the user
hasn't turned off, and records it in the notifications table.

Rules for callers:
  * Call it AFTER committing the change the notification is about — it
    commits (and on its own errors, rolls back) the session it's given.
  * Pass a dedupe_key for anything that can happen twice (a webhook retried,
    the scheduled job running again, two requests racing): a key that was
    already used is skipped, so the user hears about the event once.
  * It never raises. A notification that can't be delivered is logged and
    recorded, never allowed to fail the order or payment behind it.

Delivery runs inside the request, all channels and recipients in parallel,
with a deadline — not as a background task: Cloud Run throttles the CPU
once a response has been sent, so work after it could stall indefinitely.
"""
import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.models import Profile
from app.notifications import channels, messages
from app.notifications.models import Notification, NotificationSettings, PushToken

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="notify")
_DELIVERY_DEADLINE_SECONDS = 12

_EXPO_TOKEN = re.compile(r"^Expo(nent)?PushToken\[[^\]]{1,200}\]$")


@dataclass
class Notice:
    profile_id: object
    kind: str
    ctx: dict = field(default_factory=dict)
    dedupe_key: str | None = None


def notify(db: Session, profile_id, kind: str, ctx: dict | None = None, dedupe_key: str | None = None) -> None:
    notify_many(db, [Notice(profile_id, kind, ctx or {}, dedupe_key)])


def notify_many(db: Session, notices: list[Notice]) -> None:
    if not notices:
        return
    try:
        _deliver(db, notices)
    except Exception:
        logger.exception("Sending notifications failed")
        db.rollback()


# --- Sending ------------------------------------------------------------------------


def _auth_email(db: Session, profile_id) -> str | None:
    # FastAPI connects as postgres, so auth.users is readable here.
    return db.execute(text("select email from auth.users where id = :id"), {"id": str(profile_id)}).scalar()


def _first_name(profile: Profile) -> str | None:
    name = (profile.full_name or "").strip()
    return name.split(" ")[0] if name else None


def _deliver(db: Session, notices: list[Notice]) -> None:
    # 1. Record each notification (skipping already-used dedupe keys), and
    #    commit, so a crash mid-send can never send the same thing twice.
    queued = []
    for notice in notices:
        profile = db.get(Profile, notice.profile_id)
        if not profile or profile.status == "deleted":
            continue
        message = messages.BUILDERS[notice.kind](notice.ctx)
        notification_id = uuid.uuid4()
        inserted = db.execute(
            pg_insert(Notification)
            .values(
                id=notification_id,
                profile_id=profile.id,
                kind=notice.kind,
                title=message.title,
                body=message.body,
                data={"url": message.url} if message.url else {},
                dedupe_key=notice.dedupe_key,
                created_at=datetime.now(timezone.utc),
            )
            .on_conflict_do_nothing(index_elements=["dedupe_key"])
            .returning(Notification.id)
        ).first()
        if inserted:
            queued.append((notification_id, profile, message, notice.kind))
    db.commit()
    if not queued:
        return

    # 2. Send everything in parallel.
    statuses: dict = {}  # notification_id -> {column: status}
    pending = []  # (notification_id, column, future)
    for notification_id, profile, message, kind in queued:
        prefs = db.get(NotificationSettings, profile.id)
        row = statuses.setdefault(notification_id, {})

        if messages.PUSH in message.channels:
            if prefs and not prefs.push_enabled:
                row["push_status"] = "off"
            else:
                tokens = [t for (t,) in db.query(PushToken.token).filter(PushToken.profile_id == profile.id)]
                data = {"url": message.url, "kind": kind, "notification_id": str(notification_id)}
                pending.append(
                    (notification_id, "push_status", _executor.submit(channels.send_push, tokens, message.title, message.body, data))
                )

        if messages.EMAIL in message.channels:
            if prefs and not prefs.email_enabled:
                row["email_status"] = "off"
            else:
                html, plain = messages.render_email(message, _first_name(profile))
                pending.append(
                    (
                        notification_id,
                        "email_status",
                        _executor.submit(
                            channels.send_email,
                            _auth_email(db, profile.id),
                            message.title,
                            html,
                            plain,
                            str(notification_id),
                        ),
                    )
                )

        if messages.SMS in message.channels and message.sms:
            # Text messages only ever go to people who opted in.
            if not (prefs and prefs.sms_enabled):
                row["sms_status"] = "off"
            else:
                pending.append((notification_id, "sms_status", _executor.submit(channels.send_sms, profile.phone, message.sms)))

    done, _ = wait([f for _, _, f in pending], timeout=_DELIVERY_DEADLINE_SECONDS)
    dead_tokens: list[str] = []
    for notification_id, column, future in pending:
        if future not in done:
            result = "failed: timed out"
        else:
            try:
                result = future.result()
            except Exception as e:  # the senders don't raise, but never let one escape
                result = f"failed: {e}"[:200]
        if column == "push_status" and isinstance(result, tuple):
            result, dead = result
            dead_tokens += dead
        statuses[notification_id][column] = result

    # 3. Record what happened, and forget phones Expo says are gone.
    for notification_id, values in statuses.items():
        if values:
            db.query(Notification).filter(Notification.id == notification_id).update(values)
    if dead_tokens:
        db.query(PushToken).filter(PushToken.token.in_(dead_tokens)).delete(synchronize_session=False)
    db.commit()


# --- Devices and settings (the app's endpoints) -------------------------------------------


def register_device(db: Session, profile_id, token: str, platform: str) -> None:
    """Called by the app after sign-in. A phone that was signed in to another
    account moves to this one — notifications follow whoever is signed in."""
    if not _EXPO_TOKEN.match(token):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That isn't a valid push token.")
    now = datetime.now(timezone.utc)
    db.execute(
        pg_insert(PushToken)
        .values(token=token, profile_id=profile_id, platform=platform, created_at=now, last_seen_at=now)
        .on_conflict_do_update(
            index_elements=["token"], set_={"profile_id": profile_id, "platform": platform, "last_seen_at": now}
        )
    )
    db.commit()


def unregister_device(db: Session, profile_id, token: str) -> None:
    """Called by the app on sign-out, so a shared phone stops getting the
    previous user's notifications."""
    db.query(PushToken).filter(PushToken.token == token, PushToken.profile_id == profile_id).delete()
    db.commit()


def _settings_out(prefs: NotificationSettings | None, profile: Profile) -> dict:
    return {
        "push_enabled": prefs.push_enabled if prefs else True,
        "email_enabled": prefs.email_enabled if prefs else True,
        "sms_enabled": prefs.sms_enabled if prefs else False,
        # The app only offers the channels that are actually set up.
        "email_available": bool(settings.RESEND_API_KEY),
        "sms_available": bool(settings.TELNYX_API_KEY and settings.TELNYX_FROM_NUMBER),
        "sms_phone": channels.us_phone_e164(profile.phone),
    }


def _profile(db: Session, profile_id) -> Profile:
    profile = db.get(Profile, profile_id)
    if not profile or profile.status == "deleted":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return profile


def get_settings(db: Session, profile_id) -> dict:
    return _settings_out(db.get(NotificationSettings, profile_id), _profile(db, profile_id))


def update_settings(
    db: Session, profile_id, push_enabled: bool | None, email_enabled: bool | None, sms_enabled: bool | None
) -> dict:
    profile = _profile(db, profile_id)
    prefs = db.get(NotificationSettings, profile_id)
    if not prefs:
        prefs = NotificationSettings(profile_id=profile_id, push_enabled=True, email_enabled=True, sms_enabled=False)
        db.add(prefs)
    if push_enabled is not None:
        prefs.push_enabled = push_enabled
    if email_enabled is not None:
        prefs.email_enabled = email_enabled
    if sms_enabled is not None and sms_enabled != prefs.sms_enabled:
        if sms_enabled and not channels.us_phone_e164(profile.phone):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Add a US mobile number to your profile first, then turn on text messages.",
            )
        prefs.sms_enabled = sms_enabled
        prefs.sms_consented_at = datetime.now(timezone.utc) if sms_enabled else None
    db.commit()
    return _settings_out(prefs, profile)
