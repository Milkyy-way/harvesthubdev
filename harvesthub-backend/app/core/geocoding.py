"""Turns a typed US address into map coordinates — shared by customer homes
and farms (see 0031_precise_locations.sql).

Order of attempts:
  1. Google Geocoding API (when GOOGLE_MAPS_API_KEY is set) — door-level
     accuracy for most addresses.
  2. US Census geocoder — free, interpolated along the street's address
     range; usually within a few dozen meters.
  3. ZIP code centroid — only a rough area, possibly miles off.

Every result says how exact it is (location_precision), so features that
need a real door — Neighborhood Pods' 0.5 mi check — can refuse a ZIP-level
guess instead of trusting it.

Google's terms let us keep its coordinates for at most 30 days, so every
stored location is re-geocoded before then: the scheduled job refreshes
anything older than REFRESH_AFTER, and a request that finds one older than
MAX_AGE (the job not running, say) refreshes it on the spot.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

# location_precision values, most to least exact (0031's check constraint).
EXACT = "exact"  # the address point itself
INTERPOLATED = "interpolated"  # estimated along the street's address range
APPROXIMATE = "approximate"  # street, neighborhood or city level
ZIP = "zip"  # ZIP code centroid

# Precise enough to place a home within a few hundred feet.
DOOR_LEVEL = (EXACT, INTERPOLATED)

REFRESH_AFTER = timedelta(days=25)
MAX_AGE = timedelta(days=30)

_TIMEOUT = 5


@dataclass
class GeocodeResult:
    latitude: float
    longitude: float
    precision: str
    provider: str  # 'google' | 'census' | 'zip'


def needs_geocode(geocoded_at: datetime | None) -> bool:
    """Never geocoded, or old enough that Google's 30 days are up."""
    if geocoded_at is None:
        return True
    # customer_profiles.geocoded_at is a plain timestamp (UTC), farmer_profiles'
    # a timestamptz — compare each against "now" of the same kind.
    now = datetime.now(timezone.utc) if geocoded_at.tzinfo else datetime.utcnow()
    return geocoded_at < now - MAX_AGE


def geocode_address(street: str | None, city: str | None, state: str | None, zip_code: str | None) -> GeocodeResult | None:
    """Best available coordinates for the address, or None if nothing matched.
    Never raises — a geocoding outage must not break the request that asked."""
    if street and city and state and zip_code:
        one_line = f"{street}, {city}, {state} {zip_code}"
        for attempt in (_google, _census):
            try:
                result = attempt(one_line)
            except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as e:
                logger.warning("%s geocoding failed for an address: %s", attempt.__name__.strip("_"), e)
                result = None
            if result:
                return result
    if zip_code:
        try:
            return _zip_centroid(zip_code)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as e:
            logger.warning("ZIP centroid lookup failed: %s", e)
    return None


def _google(one_line: str) -> GeocodeResult | None:
    if not settings.GOOGLE_MAPS_API_KEY:
        return None
    resp = requests.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        params={"address": one_line, "components": "country:US", "key": settings.GOOGLE_MAPS_API_KEY},
        timeout=_TIMEOUT,
    )
    body = resp.json()
    status = body.get("status")
    if status == "ZERO_RESULTS":
        return None
    if status != "OK":
        # REQUEST_DENIED (key/API not enabled), OVER_QUERY_LIMIT, ... — fall back.
        raise ValueError(f"{status}: {body.get('error_message', '')}")
    best = body["results"][0]
    location = best["geometry"]["location"]
    location_type = best["geometry"].get("location_type")
    if "postal_code" in best.get("types", []):
        precision = ZIP
    elif location_type == "ROOFTOP":
        # A partial match found a real door, but maybe not quite the one typed.
        precision = INTERPOLATED if best.get("partial_match") else EXACT
    elif location_type == "RANGE_INTERPOLATED":
        precision = INTERPOLATED
    else:
        precision = APPROXIMATE  # GEOMETRIC_CENTER / APPROXIMATE: a street or area
    return GeocodeResult(float(location["lat"]), float(location["lng"]), precision, "google")


def _census(one_line: str) -> GeocodeResult | None:
    resp = requests.get(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
        params={"address": one_line, "benchmark": "Public_AR_Current", "format": "json"},
        timeout=_TIMEOUT,
    )
    matches = resp.json().get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    coords = matches[0]["coordinates"]
    return GeocodeResult(float(coords["y"]), float(coords["x"]), INTERPOLATED, "census")


def _zip_centroid(zip_code: str) -> GeocodeResult | None:
    resp = requests.get(f"https://api.zippopotam.us/us/{zip_code[:5]}", timeout=_TIMEOUT)
    if resp.status_code != 200:
        return None
    place = resp.json()["places"][0]
    return GeocodeResult(float(place["latitude"]), float(place["longitude"]), ZIP, "zip")
