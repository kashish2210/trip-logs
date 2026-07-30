"""Turns trip inputs into a route, a duty timeline, and drawn ELD log sheets.

This is the orchestration layer: it geocodes the three locations, asks OSRM for
the road route, feeds the legs to the HOS simulator, then resolves every duty
change back onto the route so each stop has real coordinates and a
"City, ST" remark.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import places
from .geo import GeoPoint, geocode
from .hos import (
    DRIVING,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
    STATUS_LABELS,
    DriveTask,
    HOSRules,
    HOSSimulator,
    TripParams,
    WorkTask,
    build_log_days,
    check_compliance,
    minutes_to_clock,
    minutes_to_hours,
)
from .routing import Route, build_route

# Duty changes worth pinning on the map, and how the UI should label them.
STOP_KINDS = {
    "pickup": ("Pickup", "Loading"),
    "dropoff": ("Drop-off", "Unloading"),
    "fuel": ("Fuel stop", "Fuelling"),
    "break": ("30-min break", "Required break from driving"),
    "reset": ("10-hour reset", "Off-duty reset"),
    "restart": ("34-hour restart", "Cycle restart"),
}


@dataclass
class TripRequest:
    current_location: str
    pickup_location: str
    dropoff_location: str
    cycle_used_hours: float = 0.0
    start_datetime: datetime = field(default_factory=datetime.now)
    driver_name: str = ""
    carrier_name: str = ""
    main_office: str = ""
    truck_number: str = ""
    trailer_number: str = ""
    shipper: str = ""
    commodity: str = ""
    load_id: str = ""
    co_driver: str = ""


def plan_trip(
    request: TripRequest,
    rules: HOSRules | None = None,
    params: TripParams | None = None,
) -> dict:
    """Produce the complete plan payload for one trip."""
    rules = rules or HOSRules()
    params = params or TripParams()

    origin = geocode(request.current_location)
    pickup = geocode(request.pickup_location)
    dropoff = geocode(request.dropoff_location)

    route = build_route(
        [(origin.lat, origin.lon), (pickup.lat, pickup.lon),
         (dropoff.lat, dropoff.lon)]
    )
    if len(route.legs) < 2:
        raise ValueError("Routing engine did not return both trip legs.")

    to_pickup, to_dropoff = route.legs[0], route.legs[1]
    tasks = [
        DriveTask(to_pickup.miles, to_pickup.minutes, "Driving to pickup", leg=0),
        WorkTask(params.pickup_minutes, "Loading at pickup", "pickup", leg=0),
        DriveTask(to_dropoff.miles, to_dropoff.minutes, "Driving to drop-off",
                  leg=1),
        WorkTask(params.dropoff_minutes, "Unloading at drop-off", "dropoff",
                 leg=1),
    ]

    simulator = HOSSimulator(rules=rules, params=params)
    result = simulator.run(tasks, cycle_used_hours=request.cycle_used_hours)

    start = request.start_datetime.replace(second=0, microsecond=0)
    issues = check_compliance(result.segments, request.cycle_used_hours, rules)

    segments = [
        _segment_payload(seg, start, route) for seg in result.segments
    ]
    log_days = _build_log_payload(result, start, request, route, rules)
    stops = _build_stops(result, start, route, origin, pickup, dropoff)

    end = start + timedelta(minutes=result.total_minutes)
    totals = _status_totals(result.segments)

    return {
        "inputs": {
            "current_location": request.current_location,
            "pickup_location": request.pickup_location,
            "dropoff_location": request.dropoff_location,
            "cycle_used_hours": round(request.cycle_used_hours, 2),
            "start_datetime": start.isoformat(),
        },
        "driver": {
            "driver_name": request.driver_name,
            "carrier_name": request.carrier_name,
            "main_office": request.main_office,
            "truck_number": request.truck_number,
            "trailer_number": request.trailer_number,
            "shipper": request.shipper,
            "commodity": request.commodity,
            "load_id": request.load_id,
            "co_driver": request.co_driver,
        },
        "waypoints": [
            _waypoint(origin, "origin", "Current location", 0.0, start),
            _waypoint(pickup, "pickup", "Pickup", to_pickup.end_mile, None),
            _waypoint(dropoff, "dropoff", "Drop-off", to_dropoff.end_mile, None),
        ],
        "route": {
            "geometry": [[lat, lon] for lat, lon in route.simplified()],
            "total_miles": round(route.total_miles, 1),
            "total_drive_minutes": route.total_minutes,
            "legs": [
                {
                    "label": "Current location to pickup",
                    "miles": round(to_pickup.miles, 1),
                    "minutes": to_pickup.minutes,
                },
                {
                    "label": "Pickup to drop-off",
                    "miles": round(to_dropoff.miles, 1),
                    "minutes": to_dropoff.minutes,
                },
            ],
            "source": route.source,
            "degraded": route.degraded,
        },
        "segments": segments,
        "stops": stops,
        "log_days": log_days,
        "summary": {
            "start_datetime": start.isoformat(),
            "end_datetime": end.isoformat(),
            "elapsed_minutes": result.total_minutes,
            "elapsed_hours": minutes_to_hours(result.total_minutes),
            "total_miles": round(result.total_miles, 1),
            "driving_minutes": result.driving_minutes,
            "on_duty_minutes": result.on_duty_minutes,
            "off_duty_minutes": totals[OFF_DUTY],
            "sleeper_minutes": totals[SLEEPER],
            "days": len(log_days),
            "fuel_stops": result.fuel_stops,
            "rest_resets": result.rest_breaks,
            "short_breaks": sum(
                1 for s in result.segments if s.kind == "break"
            ),
            "cycle_restarts": result.restarts,
            "cycle_used_start": round(request.cycle_used_hours, 2),
            "cycle_used_end": minutes_to_hours(result.cycle_used_at_end),
            "cycle_limit_hours": rules.cycle_limit // 60,
            "cycle_remaining": minutes_to_hours(
                max(0, rules.cycle_limit - result.cycle_used_at_end)
            ),
            "average_speed_mph": (
                round(result.total_miles / (result.driving_minutes / 60), 1)
                if result.driving_minutes
                else 0.0
            ),
        },
        "compliance": {
            "compliant": not issues,
            "issues": [
                {
                    "rule": i.rule,
                    "citation": i.citation,
                    "detail": i.detail,
                    "at": (start + timedelta(minutes=i.at_minute)).isoformat(),
                }
                for i in issues
            ],
            "rules": [
                {"rule": "11-hour driving limit",
                 "citation": "49 CFR 395.3(a)(3)", "limit": "11 h"},
                {"rule": "14-hour driving window",
                 "citation": "49 CFR 395.3(a)(2)", "limit": "14 h"},
                {"rule": "30-minute break after 8 h driving",
                 "citation": "49 CFR 395.3(a)(3)(ii)", "limit": "30 min"},
                {"rule": "10-hour off-duty reset",
                 "citation": "49 CFR 395.3(a)(1)", "limit": "10 h"},
                {"rule": "70-hour / 8-day cycle",
                 "citation": "49 CFR 395.3(b)(2)", "limit": "70 h"},
                {"rule": "34-hour restart",
                 "citation": "49 CFR 395.3(c)", "limit": "34 h"},
            ],
        },
        "assumptions": [
            "Property-carrying driver on the 70 hour / 8 day cycle.",
            "No adverse driving conditions exception applied.",
            "Fuel stop at least every 1,000 miles (30 minutes on duty).",
            "1 hour on duty at pickup and 1 hour at drop-off.",
            "15-minute pre-trip and post-trip inspections each shift.",
            "Times shown in the driver's home-terminal local time.",
        ],
    }


# --- payload helpers -----------------------------------------------------


def _status_totals(segments) -> dict[str, int]:
    totals = {OFF_DUTY: 0, SLEEPER: 0, DRIVING: 0, ON_DUTY: 0}
    for seg in segments:
        totals[seg.status] += seg.minutes
    return totals


def _locate(route: Route, mile: float) -> tuple[float, float, str]:
    lat, lon = route.point_at_mile(mile)
    return lat, lon, places.describe(lat, lon)


def _waypoint(
    point: GeoPoint, kind: str, title: str, mile: float, at: datetime | None
) -> dict:
    return {
        "kind": kind,
        "title": title,
        "label": point.label,
        "lat": point.lat,
        "lon": point.lon,
        "mile": round(mile, 1),
        "source": point.source,
        "at": at.isoformat() if at else None,
    }


def _segment_payload(seg, start: datetime, route: Route) -> dict:
    lat, lon, location = _locate(route, seg.start_miles)
    begins = start + timedelta(minutes=seg.start)
    ends = start + timedelta(minutes=seg.end)
    return {
        "status": seg.status,
        "status_label": STATUS_LABELS[seg.status],
        "kind": seg.kind,
        "label": seg.label,
        "start": begins.isoformat(),
        "end": ends.isoformat(),
        "minutes": seg.minutes,
        "hours": minutes_to_hours(seg.minutes),
        "miles": round(seg.miles, 1),
        "odometer": round(seg.start_miles, 1),
        "location": location,
        "lat": round(lat, 5),
        "lon": round(lon, 5),
    }


def _build_stops(
    result,
    start: datetime,
    route: Route,
    origin: GeoPoint,
    pickup: GeoPoint,
    dropoff: GeoPoint,
) -> list[dict]:
    """Every stop worth showing on the map, in chronological order."""
    stops: list[dict] = [
        {
            "kind": "origin",
            "title": "Trip start",
            "detail": "Begin duty day",
            "location": origin.label,
            "lat": origin.lat,
            "lon": origin.lon,
            "mile": 0.0,
            "arrive": start.isoformat(),
            "depart": start.isoformat(),
            "minutes": 0,
        }
    ]
    for seg in result.segments:
        if seg.kind not in STOP_KINDS:
            continue
        title, detail = STOP_KINDS[seg.kind]
        if seg.kind == "pickup":
            lat, lon, location = pickup.lat, pickup.lon, pickup.label
        elif seg.kind == "dropoff":
            lat, lon, location = dropoff.lat, dropoff.lon, dropoff.label
        else:
            lat, lon, location = _locate(route, seg.start_miles)
        # A 10-hour reset is logged as off-duty followed by sleeper berth. That
        # is two segments but one place the truck is parked, so extend the
        # previous marker rather than stacking a second pin on the same spot.
        previous = stops[-1]
        if (
            previous["kind"] == seg.kind
            and previous["depart"]
            == (start + timedelta(minutes=seg.start)).isoformat()
        ):
            previous["depart"] = (start + timedelta(minutes=seg.end)).isoformat()
            previous["minutes"] += seg.minutes
            continue

        stops.append(
            {
                "kind": seg.kind,
                "title": title,
                "detail": detail,
                "location": location,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "mile": round(seg.start_miles, 1),
                "arrive": (start + timedelta(minutes=seg.start)).isoformat(),
                "depart": (start + timedelta(minutes=seg.end)).isoformat(),
                "minutes": seg.minutes,
            }
        )
    return stops


def _build_log_payload(
    result, start: datetime, request: TripRequest, route: Route,
    rules: HOSRules,
) -> list[dict]:
    days = build_log_days(
        result.segments, start, request.cycle_used_hours, rules
    )
    payload: list[dict] = []
    for day in days:
        for remark in day.remarks:
            lat, lon, location = _locate(route, remark.mile)
            remark.lat, remark.lon, remark.location = round(lat, 5), round(lon, 5), location

        entries = []
        for entry in day.entries:
            lat, lon, location = _locate(route, entry.start_miles)
            entries.append(
                {
                    "status": entry.status,
                    "status_label": STATUS_LABELS[entry.status],
                    "kind": entry.kind,
                    "label": entry.label,
                    "start": entry.start,
                    "end": entry.end,
                    "start_clock": minutes_to_clock(entry.start),
                    "end_clock": minutes_to_clock(entry.end),
                    "minutes": entry.end - entry.start,
                    "hours": minutes_to_hours(entry.end - entry.start),
                    "miles": round(entry.end_miles - entry.start_miles, 1),
                    "location": location,
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                }
            )

        payload.append(
            {
                "day_index": day.day_index,
                "day_number": day.day_index + 1,
                "date": day.date.isoformat(),
                "entries": entries,
                "remarks": [
                    {
                        "minute": r.minute,
                        "clock": minutes_to_clock(r.minute),
                        "label": r.label,
                        "kind": r.kind,
                        "location": r.location,
                        "lat": r.lat,
                        "lon": r.lon,
                    }
                    for r in day.remarks
                ],
                "totals": {
                    status: {
                        "minutes": minutes,
                        "hours": minutes_to_hours(minutes),
                    }
                    for status, minutes in day.totals.items()
                },
                "total_minutes": sum(day.totals.values()),
                "miles_driving": day.miles_driving,
                "total_mileage": day.miles_driving,
                "on_duty_hours": minutes_to_hours(day.on_duty_minutes),
                "cycle_used_end": minutes_to_hours(day.cycle_used_end),
                "cycle_available_tomorrow": minutes_to_hours(
                    day.cycle_available_tomorrow
                ),
                "carrier_name": request.carrier_name,
                "driver_name": request.driver_name,
                "main_office": request.main_office,
                "truck_number": request.truck_number,
                "trailer_number": request.trailer_number,
                "shipper": request.shipper,
                "commodity": request.commodity,
                "load_id": request.load_id,
                "co_driver": request.co_driver,
            }
        )
    return payload
