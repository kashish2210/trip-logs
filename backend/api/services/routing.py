"""Road routing via the public OSRM demo server, with a graceful fallback.

OSRM is free and needs no API key. When it is unreachable the planner falls
back to great-circle legs so the app still returns a usable plan; the response
is flagged ``degraded`` so the UI can say so honestly rather than presenting an
estimate as a real route.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field

import httpx
from django.conf import settings

from .cache import cache_get, cache_set
from .places import haversine_miles

log = logging.getLogger(__name__)

METERS_PER_MILE = 1609.344
CACHE_VERSION = "v1"
CACHE_TTL = 60 * 60 * 24 * 7

# Straight-line distance understates road distance; this is the usual planning
# correction used when no routing engine is available.
DETOUR_FACTOR = 1.21
FALLBACK_SPEED_MPH = 55.0


class RoutingError(RuntimeError):
    """Raised when no route can be produced at all."""


@dataclass
class RouteLeg:
    miles: float
    minutes: int
    start_mile: float
    end_mile: float


@dataclass
class Route:
    legs: list[RouteLeg]
    geometry: list[tuple[float, float]] = field(default_factory=list)
    cumulative_miles: list[float] = field(default_factory=list)
    source: str = "osrm"
    degraded: bool = False

    @property
    def total_miles(self) -> float:
        return sum(leg.miles for leg in self.legs)

    @property
    def total_minutes(self) -> int:
        return sum(leg.minutes for leg in self.legs)

    def point_at_mile(self, miles: float) -> tuple[float, float]:
        """Interpolate the coordinate reached after driving ``miles``.

        This is how a fuel stop or a 10-hour rest gets placed on the map at the
        spot the driver actually reaches, rather than at the nearest waypoint.
        """
        if not self.geometry:
            raise RoutingError("Route has no geometry.")
        totals = self.cumulative_miles
        if miles <= 0:
            return self.geometry[0]
        if miles >= totals[-1]:
            return self.geometry[-1]

        lo, hi = 0, len(totals) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if totals[mid] < miles:
                lo = mid + 1
            else:
                hi = mid
        i = max(1, lo)
        span = totals[i] - totals[i - 1]
        t = 0.0 if span <= 0 else (miles - totals[i - 1]) / span
        (lat1, lon1), (lat2, lon2) = self.geometry[i - 1], self.geometry[i]
        return (lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t)

    def simplified(self, max_points: int = 700) -> list[tuple[float, float]]:
        """Evenly downsampled geometry for drawing on the client."""
        n = len(self.geometry)
        if n <= max_points:
            return list(self.geometry)
        step = n / max_points
        picked = [self.geometry[int(i * step)] for i in range(max_points)]
        picked[-1] = self.geometry[-1]
        return picked


def build_route(points: list[tuple[float, float]]) -> Route:
    """Route through ``points`` (lat, lon), preferring OSRM."""
    if len(points) < 2:
        raise RoutingError("At least two waypoints are required.")

    signature = ";".join(f"{lat:.5f},{lon:.5f}" for lat, lon in points)
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()
    key = f"route.{CACHE_VERSION}.{digest}"
    cached = cache_get(key)
    if cached:
        return _route_from_cache(cached)

    try:
        route = _route_osrm(points)
    except Exception as exc:
        log.warning("OSRM routing failed (%s); falling back to estimate.", exc)
        if not getattr(settings, "GEO_ALLOW_FALLBACK", True):
            raise RoutingError(
                "Routing service is unavailable. Please try again shortly."
            ) from exc
        route = _route_fallback(points)

    cache_set(key, _route_to_cache(route), CACHE_TTL)
    return route


def _route_osrm(points: list[tuple[float, float]]) -> Route:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = f"{settings.OSRM_BASE_URL.rstrip('/')}/route/v1/driving/{coords}"
    response = httpx.get(
        url,
        params={"overview": "full", "geometries": "geojson", "steps": "false"},
        timeout=settings.GEO_HTTP_TIMEOUT,
        follow_redirects=True,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RoutingError(payload.get("message") or "No route found.")

    best = payload["routes"][0]
    geometry = [
        (float(lat), float(lon))
        for lon, lat in best.get("geometry", {}).get("coordinates", [])
    ]
    if len(geometry) < 2:
        raise RoutingError("Routing engine returned an empty geometry.")

    legs: list[RouteLeg] = []
    cursor = 0.0
    for leg in best.get("legs", []):
        miles = float(leg.get("distance", 0.0)) / METERS_PER_MILE
        minutes = max(1, int(round(float(leg.get("duration", 0.0)) / 60.0)))
        legs.append(RouteLeg(miles, minutes, cursor, cursor + miles))
        cursor += miles

    return Route(
        legs=legs,
        geometry=geometry,
        cumulative_miles=_cumulative(geometry),
        source="osrm",
        degraded=False,
    )


def _route_fallback(points: list[tuple[float, float]]) -> Route:
    """Great-circle legs with a detour correction, used when OSRM is down."""
    geometry: list[tuple[float, float]] = []
    legs: list[RouteLeg] = []
    cursor = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        miles = haversine_miles(lat1, lon1, lat2, lon2) * DETOUR_FACTOR
        minutes = max(1, int(round(miles / FALLBACK_SPEED_MPH * 60)))
        legs.append(RouteLeg(miles, minutes, cursor, cursor + miles))
        cursor += miles
        steps = 48
        start = 0 if not geometry else 1
        for i in range(start, steps + 1):
            t = i / steps
            geometry.append((lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t))

    return Route(
        legs=legs,
        geometry=geometry,
        cumulative_miles=_cumulative(geometry),
        source="estimate",
        degraded=True,
    )


def _cumulative(geometry: list[tuple[float, float]]) -> list[float]:
    totals = [0.0]
    for (lat1, lon1), (lat2, lon2) in zip(geometry, geometry[1:]):
        totals.append(totals[-1] + haversine_miles(lat1, lon1, lat2, lon2))
    return totals


def _route_to_cache(route: Route) -> dict:
    return {
        "legs": [
            [leg.miles, leg.minutes, leg.start_mile, leg.end_mile]
            for leg in route.legs
        ],
        "geometry": [[lat, lon] for lat, lon in route.geometry],
        "source": route.source,
        "degraded": route.degraded,
    }


def _route_from_cache(data: dict) -> Route:
    geometry = [(float(lat), float(lon)) for lat, lon in data["geometry"]]
    return Route(
        legs=[RouteLeg(m, mins, a, b) for m, mins, a, b in data["legs"]],
        geometry=geometry,
        cumulative_miles=_cumulative(geometry),
        source=data.get("source", "osrm"),
        degraded=bool(data.get("degraded")),
    )
