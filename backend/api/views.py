from __future__ import annotations

import logging

from django.db import DatabaseError
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .models import Trip
from .serializers import (
    LocationSuggestionSerializer,
    LogValidationSerializer,
    TripDetailSerializer,
    TripRequestSerializer,
    TripSummarySerializer,
)
from .services import geo
from .services.hos import HOSError
from .services.planner import TripRequest, plan_trip
from .services.routing import RoutingError
from .services.validation import StructuralIssue, validate_days

log = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    """Return a consistent ``{"detail": ...}`` body for every error."""
    response = exception_handler(exc, context)
    if response is not None:
        if isinstance(response.data, dict) and "detail" not in response.data:
            response.data = {"detail": "Invalid request.",
                             "errors": response.data}
        return response

    if isinstance(
        exc, (geo.GeocodeError, RoutingError, HOSError, StructuralIssue, ValueError)
    ):
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    log.exception("Unhandled API error", exc_info=exc)
    return Response(
        {"detail": "Something went wrong while planning the trip."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


@api_view(["GET"])
def health(request):
    return Response({"status": "ok", "service": "eld-trip-planner"})


@api_view(["GET"])
def locations(request):
    """Typeahead for the trip form, served from the bundled city table."""
    query = request.query_params.get("q", "")
    limit = min(int(request.query_params.get("limit", 8) or 8), 25)
    results = geo.suggest(query, limit=limit)
    return Response(
        LocationSuggestionSerializer(
            [r.as_dict() for r in results], many=True
        ).data
    )


@api_view(["POST"])
def plan(request):
    """Plan a trip: route, HOS-compliant duty timeline, and drawn log sheets."""
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    trip_request = TripRequest(
        current_location=data["current_location"],
        pickup_location=data["pickup_location"],
        dropoff_location=data["dropoff_location"],
        cycle_used_hours=data["current_cycle_used"],
        start_datetime=data["start_datetime"],
        driver_name=data.get("driver_name", ""),
        carrier_name=data.get("carrier_name", ""),
        main_office=data.get("main_office", ""),
        truck_number=data.get("truck_number", ""),
        trailer_number=data.get("trailer_number", ""),
        shipper=data.get("shipper", ""),
        commodity=data.get("commodity", ""),
        load_id=data.get("load_id", ""),
        co_driver=data.get("co_driver", ""),
    )

    result = plan_trip(trip_request)
    summary = result["summary"]

    trip = None
    try:
        trip = Trip.objects.create(
            current_location=trip_request.current_location,
            pickup_location=trip_request.pickup_location,
            dropoff_location=trip_request.dropoff_location,
            cycle_used_hours=trip_request.cycle_used_hours,
            start_datetime=trip_request.start_datetime,
            driver_name=trip_request.driver_name,
            carrier_name=trip_request.carrier_name,
            main_office=trip_request.main_office,
            truck_number=trip_request.truck_number,
            trailer_number=trip_request.trailer_number,
            shipper=trip_request.shipper,
            commodity=trip_request.commodity,
            load_id=trip_request.load_id,
            co_driver=trip_request.co_driver,
            total_miles=summary["total_miles"],
            driving_minutes=summary["driving_minutes"],
            elapsed_minutes=summary["elapsed_minutes"],
            log_days=summary["days"],
            is_compliant=result["compliance"]["compliant"],
            route_source=result["route"]["source"],
            plan=result,
        )
    except DatabaseError:
        # A storage hiccup shouldn't cost the driver a plan they just waited
        # for; return it and log the failure.
        log.exception("Could not persist trip")

    return Response(
        {"id": str(trip.id) if trip else None, "saved": trip is not None,
         "plan": result},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def validate_logs(request):
    """Re-check hand-edited log sheets against the HOS rules.

    The editor calls this on every change, so the browser never has to carry a
    second copy of the rules.
    """
    serializer = LogValidationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    return Response(
        validate_days(data["days"], data.get("cycle_used_start", 0.0))
    )


@api_view(["GET"])
def trip_list(request):
    limit = min(int(request.query_params.get("limit", 20) or 20), 100)
    trips = Trip.objects.all()[:limit]
    return Response(TripSummarySerializer(trips, many=True).data)


@api_view(["GET"])
def trip_detail(request, trip_id):
    try:
        trip = Trip.objects.get(pk=trip_id)
    except (Trip.DoesNotExist, ValueError, TypeError):
        raise NotFound()
    return Response(TripDetailSerializer(trip).data)


class NotFound(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Trip not found."
