"""The three ways a notification leaves HarvestHub — push (Expo's push
service, which hands off to Apple/Google), email (Resend) and text message
(Telnyx). Plain HTTPS calls: swapping a provider means changing one function
here.

Each sender returns a short status for the notifications row and never
raises: a provider being down must not break the order or payment that
triggered the notification.
"""
import logging
import re

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 8
NOT_CONFIGURED = "not_configured"
SENT = "sent"

# Matches the Android channel the app creates (lib/pushNotifications.ts).
ANDROID_CHANNEL_ID = "default"


def _failed(provider: str, error: Exception | str) -> str:
    logger.warning("%s send failed: %s", provider, error)
    return f"failed: {str(error)[:200]}"


def send_push(tokens: list[str], title: str, body: str, data: dict) -> tuple[str, list[str]]:
    """Returns (status, tokens Expo says are dead — the app was uninstalled
    or the user signed out without telling us — for the caller to delete)."""
    if not tokens:
        return "none", []
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
            "priority": "high",
            "channelId": ANDROID_CHANNEL_ID,
        }
        for token in tokens
    ]
    try:
        resp = requests.post("https://exp.host/--/api/v2/push/send", json=messages, headers=headers, timeout=_TIMEOUT)
        resp.raise_for_status()
        tickets = resp.json().get("data") or []
    except (requests.RequestException, ValueError) as e:
        return _failed("Push", e), []

    dead = [
        tokens[i]
        for i, ticket in enumerate(tickets)
        if i < len(tokens)
        and ticket.get("status") == "error"
        and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
    ]
    if any(ticket.get("status") == "ok" for ticket in tickets):
        return SENT, dead
    errors = "; ".join(str(t.get("message")) for t in tickets if t.get("status") == "error")
    return _failed("Push", errors or "no tickets"), dead


def send_email(to: str | None, subject: str, html: str, text: str, idempotency_key: str | None = None) -> str:
    if not to:
        return "none"
    if not settings.RESEND_API_KEY:
        return NOT_CONFIGURED
    headers = {"Authorization": f"Bearer {settings.RESEND_API_KEY}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key[:256]
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html, "text": text},
            headers=headers,
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        return _failed("Email", e)
    if resp.status_code >= 300:
        return _failed("Email", f"{resp.status_code} {resp.text}")
    return SENT


def us_phone_e164(phone: str | None) -> str | None:
    """'(202) 555-0123' -> '+12025550123'; None if it isn't a US number."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def send_sms(phone: str | None, text: str) -> str:
    to = us_phone_e164(phone)
    if not to:
        return "none"
    if not (settings.TELNYX_API_KEY and settings.TELNYX_FROM_NUMBER):
        return NOT_CONFIGURED
    try:
        resp = requests.post(
            "https://api.telnyx.com/v2/messages",
            json={"from": settings.TELNYX_FROM_NUMBER, "to": to, "text": text},
            headers={"Authorization": f"Bearer {settings.TELNYX_API_KEY}"},
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        return _failed("SMS", e)
    if resp.status_code >= 300:
        # Includes numbers that replied STOP — Telnyx refuses to text them.
        return _failed("SMS", f"{resp.status_code} {resp.text}")
    return SENT
