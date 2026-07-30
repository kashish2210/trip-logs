"""Offline nearest-place lookup for the RODS Remarks column.

Sec. 395.8(h)(6) requires the name of the city, town or village and the state
abbreviation at every change of duty status. A long trip produces a couple of
dozen of those, and Nominatim's usage policy caps reverse geocoding at one
request per second, so resolving them online would add tens of seconds to every
plan and hammer a free service.

Instead we ship a 29k-row table of US cities and answer lookups from memory in
microseconds. A one-degree bucket index keeps the search local, so no query
scans the whole table.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "us_cities.csv"

EARTH_RADIUS_MILES = 3958.7613


@dataclass(frozen=True)
class Place:
    city: str
    state: str
    lat: float
    lon: float

    @property
    def label(self) -> str:
        return f"{self.city}, {self.state}"


class PlaceIndex:
    """Bucketed nearest-neighbour index over US cities."""

    def __init__(self, places: list[Place]) -> None:
        self._places = places
        self._buckets: dict[tuple[int, int], list[int]] = {}
        for i, place in enumerate(places):
            key = (math.floor(place.lat), math.floor(place.lon))
            self._buckets.setdefault(key, []).append(i)

    def __len__(self) -> int:
        return len(self._places)

    def nearest(self, lat: float, lon: float) -> Place | None:
        """Closest city, widening the search ring until something is found."""
        if not self._places:
            return None
        base = (math.floor(lat), math.floor(lon))
        for ring in range(0, 12):
            candidates: list[int] = []
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    # Only the newly added outer ring on each pass.
                    if ring and max(abs(dy), abs(dx)) != ring:
                        continue
                    candidates.extend(
                        self._buckets.get((base[0] + dy, base[1] + dx), ())
                    )
            if candidates:
                best = min(
                    candidates,
                    key=lambda i: _sq_distance(
                        lat, lon, self._places[i].lat, self._places[i].lon
                    ),
                )
                return self._places[best]
        return None

    def search(self, query: str, limit: int = 8) -> list[Place]:
        """Prefix/substring search used by the location autocomplete."""
        needle = query.strip().lower()
        if not needle:
            return []
        state_filter = ""
        if "," in needle:
            head, _, tail = needle.rpartition(",")
            tail = tail.strip()
            if len(tail) == 2 and tail.isalpha():
                needle, state_filter = head.strip(), tail.upper()

        starts: list[Place] = []
        contains: list[Place] = []
        for place in self._places:
            if state_filter and place.state != state_filter:
                continue
            name = place.city.lower()
            if name.startswith(needle):
                starts.append(place)
                if len(starts) >= limit:
                    break
            elif len(contains) < limit and needle in name:
                contains.append(place)
        return (starts + contains)[:limit]


def _sq_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Cheap squared distance in degree-space, corrected for longitude."""
    dlat = lat1 - lat2
    dlon = (lon1 - lon2) * math.cos(math.radians((lat1 + lat2) / 2))
    return dlat * dlat + dlon * dlon


@lru_cache(maxsize=1)
def get_index() -> PlaceIndex:
    places: list[Place] = []
    if DATA_FILE.exists():
        with DATA_FILE.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                try:
                    places.append(
                        Place(
                            city=row["city"],
                            state=row["state"],
                            lat=float(row["lat"]),
                            lon=float(row["lon"]),
                        )
                    )
                except (KeyError, ValueError):
                    continue
    return PlaceIndex(places)


def describe(lat: float, lon: float) -> str:
    """``"Fond du Lac, WI"`` for a coordinate, or a coordinate string."""
    place = get_index().nearest(lat, lon)
    if place is None:
        return f"{lat:.3f}, {lon:.3f}"
    return place.label


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in statute miles."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))
