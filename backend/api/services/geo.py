"""Forward geocoding backed by Nominatim, with an offline fallback.

Both upstreams used by this project are free and key-less:

* Nominatim (OpenStreetMap) for turning "Chicago, IL" into coordinates.
* OSRM (see :mod:`api.services.routing`) for the road route itself.

Nominatim's usage policy requires an identifying User-Agent and no more than
one request per second, so every lookup is cached persistently and repeated
queries never leave the process.
"""

from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from dataclasses import asdict, dataclass

import httpx
from django.conf import settings

from . import places
from .cache import cache_get, cache_set

log = logging.getLogger(__name__)

CACHE_VERSION = "v1"
CACHE_TTL = 60 * 60 * 24 * 30  # 30 days

# Nominatim's usage policy allows at most one request per second. Exceeding it
# gets the connection dropped, so requests are serialised behind this lock.
_MIN_REQUEST_INTERVAL = 1.1
_throttle_lock = threading.Lock()
_last_request_at = 0.0


def _throttle() -> None:
    global _last_request_at
    with _throttle_lock:
        wait = _MIN_REQUEST_INTERVAL - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


class GeocodeError(ValueError):
    """Raised when a location cannot be resolved to coordinates."""


@dataclass(frozen=True)
class GeoPoint:
    label: str
    lat: float
    lon: float
    source: str = "nominatim"

    def as_dict(self) -> dict:
        return asdict(self)


_COORD_RE = re.compile(
    r"^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$"
)


def _cache_key(query: str) -> str:
    # Hashed so the key is always safe for any cache backend.
    digest = hashlib.sha1(query.strip().lower().encode("utf-8")).hexdigest()
    return f"geocode.{CACHE_VERSION}.{digest}"


def geocode(query: str, *, allow_fallback: bool | None = None) -> GeoPoint:
    """Resolve a free-text location to a :class:`GeoPoint`.

    Resolution order: raw coordinates, cache, Nominatim, offline city table.
    """
    query = (query or "").strip()
    if not query:
        raise GeocodeError("Location is required.")

    coords = _COORD_RE.match(query)
    if coords:
        lat, lon = float(coords.group(1)), float(coords.group(2))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise GeocodeError(f"'{query}' is not a valid coordinate pair.")
        return GeoPoint(places.describe(lat, lon), lat, lon, source="coordinates")

    key = _cache_key(query)
    cached = cache_get(key)
    if cached:
        return GeoPoint(**cached)

    if allow_fallback is None:
        allow_fallback = getattr(settings, "GEO_ALLOW_FALLBACK", True)

    point: GeoPoint | None = None
    for attempt in range(2):
        try:
            point = _geocode_nominatim(query)
            break
        except Exception as exc:  # network, timeout, rate limit, bad payload
            log.warning(
                "Nominatim lookup failed for %r (attempt %d): %s",
                query, attempt + 1, exc,
            )
            if attempt == 0:
                time.sleep(_MIN_REQUEST_INTERVAL)

    if point is None and allow_fallback:
        point = _geocode_offline(query)

    if point is None:
        raise GeocodeError(
            f"Could not find '{query}'. Try including the state, "
            "e.g. 'Springfield, IL'."
        )

    cache_set(key, point.as_dict(), CACHE_TTL)
    return point


def _geocode_nominatim(query: str) -> GeoPoint | None:
    _throttle()
    url = f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/search"
    response = httpx.get(
        url,
        params={
            "q": query,
            "format": "jsonv2",
            "limit": 1,
            "addressdetails": 1,
            "countrycodes": "us,ca,mx",
        },
        headers={
            "User-Agent": settings.GEO_USER_AGENT,
            "Accept-Language": "en",
        },
        timeout=settings.GEO_HTTP_TIMEOUT,
        follow_redirects=True,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload:
        return None
    hit = payload[0]
    lat, lon = float(hit["lat"]), float(hit["lon"])
    return GeoPoint(
        label=_short_label(hit, lat, lon),
        lat=lat,
        lon=lon,
        source="nominatim",
    )


def _short_label(hit: dict, lat: float, lon: float) -> str:
    """Prefer 'City, ST' over Nominatim's very long display_name.

    A RODS remark names a city, town or village, so a county- or region-level
    result is resolved back to the nearest actual place instead.
    """
    address = hit.get("address") or {}
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("hamlet")
        or address.get("municipality")
    )
    if not city:
        return places.describe(lat, lon)

    state = address.get("state")
    code = _STATE_CODES.get((state or "").lower())
    if code:
        return f"{city}, {code}"
    return f"{city}, {state}" if state else city


def _geocode_offline(query: str) -> GeoPoint | None:
    """Resolve from the bundled city table when Nominatim is unavailable."""
    matches = places.get_index().search(query, limit=1)
    if not matches:
        return None
    place = matches[0]
    return GeoPoint(place.label, place.lat, place.lon, source="offline")


def suggest(query: str, limit: int = 8) -> list[GeoPoint]:
    """Autocomplete suggestions, served entirely from the offline table.

    Typeahead fires on nearly every keystroke; sending that to Nominatim would
    breach its rate limit within seconds.
    """
    return [
        GeoPoint(p.label, p.lat, p.lon, source="offline")
        for p in places.get_index().search(query, limit=limit)
    ]


_STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "district of columbia": "DC", "florida": "FL",
    "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR",
}
