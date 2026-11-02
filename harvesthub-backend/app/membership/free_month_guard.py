"""One free month per person, even after deleting an account (2026-11-01).

Every new account can have a free Harvest Pass month, and deleting an account
deletes its free-month row. So we keep a list of keyed hashes of the email and
phone behind each free month. It holds no names and no link to any account, and
it outlives the account by design. See /privacy and /delete-account.

The hash is keyed (FREE_MONTH_HASH_KEY) because a plain hash of a phone number can
be reversed just by trying every number. Without the key nothing is recorded or
refused. Losing or changing the key empties the list in effect.
"""
import hashlib
import hmac
import logging

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.models import Profile
from app.membership.models import FreeMonthIdentifier

logger = logging.getLogger(__name__)

_GMAIL_DOMAINS = ("gmail.com", "googlemail.com")
_MIN_PHONE_DIGITS = 7


def normalize_email(email: str | None) -> str | None:
    """Spellings of one mailbox are one identifier: Gmail ignores dots, and
    anything after a + reaches the same inbox."""
    cleaned = (email or "").strip().lower()
    if "@" not in cleaned:
        return None
    local, domain = cleaned.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if domain in _GMAIL_DOMAINS:
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}" if local else None


def normalize_phone(phone: str | None) -> str | None:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) >= _MIN_PHONE_DIGITS else None


def _hash(kind: str, value: str, key: str) -> str:
    return hmac.new(key.encode(), f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()


def _hashes_of(db: Session, customer_id) -> list[str]:
    key = settings.FREE_MONTH_HASH_KEY
    if not key:
        logger.warning("FREE_MONTH_HASH_KEY isn't set, so free months aren't being checked")
        return []
    # FastAPI connects as postgres, so auth.users is readable here.
    email = db.execute(text("select email from auth.users where id = :id"), {"id": str(customer_id)}).scalar()
    profile = db.get(Profile, customer_id)
    out = []
    normalized_email = normalize_email(email)
    if normalized_email:
        out.append(_hash("email", normalized_email, key))
    normalized_phone = normalize_phone(profile.phone if profile else None)
    if normalized_phone:
        out.append(_hash("phone", normalized_phone, key))
    return out


def already_used(db: Session, customer_id) -> bool:
    """Has this customer's email or phone had a free month before?"""
    hashes = _hashes_of(db, customer_id)
    if not hashes:
        return False
    return db.query(FreeMonthIdentifier.identifier_hash).filter(FreeMonthIdentifier.identifier_hash.in_(hashes)).first() is not None


def remember(db: Session, customer_id) -> None:
    """Doesn't commit."""
    for identifier_hash in _hashes_of(db, customer_id):
        db.execute(pg_insert(FreeMonthIdentifier).values(identifier_hash=identifier_hash).on_conflict_do_nothing(index_elements=["identifier_hash"]))
