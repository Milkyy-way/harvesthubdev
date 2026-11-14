"""Shared helpers for the end-to-end tests: they run against the LIVE preview
setup (the Cloud Run API, the Supabase project and Stripe in test mode), as the
"ZZ Autotest" accounts, and check each step in three places: what the API
returns, what the database holds, and what Stripe recorded.

Keys come from harvesthub-backend/.env and harvesthub/app/.env; nothing secret
lives in this folder. Run with the backend's Python:
    harvesthub-backend/venv/Scripts/python harvesthub/e2e/<script>.py
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
import stripe
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
_backend = dotenv_values(ROOT / "harvesthub-backend" / ".env")
_app = dotenv_values(ROOT / "harvesthub" / "app" / ".env")

API = _app["EXPO_PUBLIC_API_BASE_URL"].rstrip("/")
SUPABASE = _backend["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = _backend["SUPABASE_SERVICE_ROLE_KEY"]
ANON_KEY = _app["EXPO_PUBLIC_SUPABASE_ANON_KEY"]
CRON_SECRET = _backend.get("CRON_SECRET")
DATABASE_URL = _backend["DATABASE_URL"].replace("postgresql+psycopg2://", "postgresql://").replace("postgresql+psycopg://", "postgresql://")

stripe.api_key = _backend["STRIPE_SECRET_KEY"]
if not stripe.api_key.startswith("sk_test_"):
    sys.exit("Refusing to run: STRIPE_SECRET_KEY is not a test key.")

# Test accounts only: every address is on example.com, which can't receive mail.
PASSWORD = "Autotest-2026!"
PREFIX = "ZZ Autotest"

RESULTS_DIR = Path(__file__).resolve().parent / "results"


# --- Recording what was checked --------------------------------------------------------

class Report:
    """Collects checks: each one passes or fails, with the evidence behind it."""

    def __init__(self, name: str):
        self.name = name
        self.checks: list[dict] = []
        self.notes: list[str] = []

    def check(self, label: str, ok: bool, evidence="") -> bool:
        self.checks.append({"label": label, "ok": bool(ok), "evidence": str(evidence)})
        print(("PASS " if ok else "FAIL ") + label + ("" if ok or evidence == "" else f"  [{evidence}]"), flush=True)
        return bool(ok)

    def note(self, text: str) -> None:
        self.notes.append(text)
        print("NOTE " + text, flush=True)

    def save(self) -> Path:
        RESULTS_DIR.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = RESULTS_DIR / f"{stamp}-{self.name}.json"
        path.write_text(json.dumps({"name": self.name, "checks": self.checks, "notes": self.notes}, indent=2), encoding="utf-8")
        failed = [c for c in self.checks if not c["ok"]]
        print(f"\n{len(self.checks) - len(failed)} passed, {len(failed)} failed. Saved {path}")
        return path

    @property
    def failed(self) -> int:
        return sum(not c["ok"] for c in self.checks)


# --- Database (read and set up test rows) ----------------------------------------------

_conn = None


def db():
    global _conn
    if _conn is None or _conn.closed:
        _conn = psycopg2.connect(DATABASE_URL)
        _conn.autocommit = True
    return _conn


def q(sql: str, **params) -> list[dict]:
    with db().cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()] if cur.description else []


def q1(sql: str, **params):
    rows = q(sql, **params)
    return rows[0] if rows else None


# --- Accounts -------------------------------------------------------------------------

def _admin_headers():
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json"}


def user_id_for(email: str):
    row = q1("select id from auth.users where lower(email) = lower(%(e)s)", e=email)
    return str(row["id"]) if row else None


def ensure_user(email: str, metadata: dict) -> str:
    """Creates the account as the sign-up form would (same metadata, so the same
    trigger builds the profile), already email-confirmed. Reuses it if it exists."""
    existing = user_id_for(email)
    if existing:
        return existing
    r = requests.post(
        f"{SUPABASE}/auth/v1/admin/users",
        headers=_admin_headers(),
        json={"email": email, "password": PASSWORD, "email_confirm": True, "user_metadata": metadata},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["id"]


class User:
    """A signed-in test account calling the real API, as the app would."""

    def __init__(self, email: str):
        self.email = email
        self.id = user_id_for(email)
        self._token = None
        self._expires = 0

    @property
    def token(self) -> str:
        if not self._token or time.time() > self._expires - 60:
            r = requests.post(
                f"{SUPABASE}/auth/v1/token?grant_type=password",
                headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
                json={"email": self.email, "password": PASSWORD},
                timeout=30,
            )
            r.raise_for_status()
            body = r.json()
            self._token, self._expires = body["access_token"], time.time() + body.get("expires_in", 3600)
        return self._token

    def call(self, method: str, path: str, body=None, params=None, expect=(200, 201, 204)):
        r = requests.request(
            method, f"{API}{path}", json=body, params=params, timeout=60,
            headers={"Authorization": f"Bearer {self.token}"},
        )
        if expect is not None and r.status_code not in (expect if isinstance(expect, tuple) else (expect,)):
            raise ApiError(method, path, r)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, None

    def get(self, path, **kw):
        return self.call("GET", path, **kw)[1]

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body, **kw)[1]


class ApiError(Exception):
    def __init__(self, method, path, response):
        self.status = response.status_code
        try:
            self.detail = response.json().get("detail")
        except ValueError:
            self.detail = response.text[:300]
        super().__init__(f"{method} {path} -> {self.status}: {self.detail}")


# --- Stripe (test mode) -----------------------------------------------------------------

def pay(client_secret: str, card: str = "pm_card_visa"):
    """What the card sheet does on the phone: confirm the PaymentIntent with a test card."""
    pi_id = client_secret.split("_secret_")[0]
    try:
        return stripe.PaymentIntent.confirm(pi_id, payment_method=card, return_url="https://example.com/return")
    except stripe.error.CardError as e:
        return stripe.PaymentIntent.retrieve(pi_id) if e else None


def run_jobs() -> dict:
    """The every-15-minutes job, on demand."""
    if not CRON_SECRET:
        raise RuntimeError("CRON_SECRET isn't in harvesthub-backend/.env")
    r = requests.post(f"{API}/internal/jobs/run", headers={"X-Cron-Secret": CRON_SECRET}, timeout=120)
    r.raise_for_status()
    return r.json()


def wait_for(fn, timeout=40, every=2):
    """Polls fn() until it returns something truthy (e.g. the webhook landing)."""
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(every)
    return fn()


def cents(x) -> int:
    return round(float(x) * 100)
