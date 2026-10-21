"""Address suggestions while the user types — Google Places API (New),
called from here so the Google key never ships inside the app.

Billing: the app opens a "session" per address it's typing (a random token)
and sends it with every suggestion request and the final details request.
Google then charges only the details request (Place Details Essentials,
10,000 free a month); the suggestions in a finished session are free.

The app stores only the address text the user picked; the API geocodes it
itself (app/core/geocoding.py). Suggestions must be shown with "Google Maps"
attribution — the app does that under the list (Google's Places policies).
"""
import logging
import threading
import time
from collections import defaultdict, deque

import requests
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_PLACES = "https://places.googleapis.com/v1"
_TIMEOUT = 5
# Street addresses only, not businesses or cities (Table B types, which
# Autocomplete (New) accepts here).
_ADDRESS_TYPES = ["street_address", "premise", "subpremise"]
# Suggestions lean toward the DC/MD/VA launch area — a preference, not a
# limit: addresses anywhere in the US still come up.
_LOCATION_BIAS = {"circle": {"center": {"latitude": 38.9072, "longitude": -77.0369}, "radius": 50000.0}}


def _key() -> str:
    if not settings.GOOGLE_MAPS_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Address suggestions aren't set up.")
    return settings.GOOGLE_MAPS_API_KEY


def _google_failed(what: str, detail) -> HTTPException:
    logger.warning("Google %s failed: %s", what, detail)
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Address suggestions are unavailable right now.")


def suggest(query: str, session: str) -> list[dict]:
    try:
        resp = requests.post(
            f"{_PLACES}/places:autocomplete",
            json={
                "input": query,
                "sessionToken": session,
                "includedRegionCodes": ["us"],
                "includedPrimaryTypes": _ADDRESS_TYPES,
                "locationBias": _LOCATION_BIAS,
                "languageCode": "en",
            },
            headers={
                "X-Goog-Api-Key": _key(),
                "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        raise _google_failed("autocomplete", e)
    if resp.status_code >= 300:
        raise _google_failed("autocomplete", f"{resp.status_code} {resp.text[:300]}")

    out = []
    for suggestion in resp.json().get("suggestions") or []:
        prediction = suggestion.get("placePrediction")
        if not prediction or not prediction.get("placeId"):
            continue
        fmt = prediction.get("structuredFormat") or {}
        out.append(
            {
                "place_id": prediction["placeId"],
                "main_text": (fmt.get("mainText") or {}).get("text", ""),
                "secondary_text": (fmt.get("secondaryText") or {}).get("text", ""),
            }
        )
    return out[:5]


def _component(components: list[dict], *types: str, short: bool = False) -> str | None:
    for wanted in types:
        for c in components:
            if wanted in (c.get("types") or []):
                return c.get("shortText" if short else "longText")
    return None


def details(place_id: str, session: str) -> dict:
    """The picked suggestion as street / city / state / ZIP, ready for the
    form. Ends the session (this is the one billed request)."""
    try:
        resp = requests.get(
            f"{_PLACES}/places/{place_id}",
            params={"sessionToken": session, "languageCode": "en", "regionCode": "us"},
            headers={"X-Goog-Api-Key": _key(), "X-Goog-FieldMask": "addressComponents"},
            timeout=_TIMEOUT,
        )
    except requests.RequestException as e:
        raise _google_failed("place details", e)
    if resp.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That address wasn't found.")
    if resp.status_code >= 300:
        raise _google_failed("place details", f"{resp.status_code} {resp.text[:300]}")

    components = resp.json().get("addressComponents") or []
    number = _component(components, "street_number")
    route = _component(components, "route", short=True)  # "Pennsylvania Ave NW"
    unit = _component(components, "subpremise")
    # Not every US address has a "locality" (unincorporated areas, NYC boroughs).
    city = _component(
        components, "locality", "postal_town", "sublocality_level_1", "sublocality", "administrative_area_level_3", "neighborhood"
    )
    state = _component(components, "administrative_area_level_1", short=True)
    zip_code = _component(components, "postal_code")
    country = _component(components, "country", short=True)
    if country != "US" or not (number and route and city and state and zip_code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That isn't a complete US street address. Pick another suggestion or type it in.",
        )
    street = f"{number} {route}" + (f" #{unit}" if unit else "")
    return {"street": street, "city": city, "state": state, "zip": zip_code[:5]}


class RateLimiter:
    """Requests per client IP in a sliding window — the suggestion endpoints
    are open before sign-in (sign-up needs them), so this keeps one caller
    from running up the Google bill. Per server instance, in memory; Google
    Cloud quotas are the hard backstop (LAUNCH_ANDROID.md 3c)."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 10_000:  # don't grow without bound
                self._hits.clear()
            hits = self._hits[key]
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True
