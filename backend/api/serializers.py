from __future__ import annotations

from datetime import datetime

from rest_framework import serializers

from .models import Trip
from .services.hos import HOSRules

CYCLE_LIMIT_HOURS = HOSRules().cycle_limit / 60


class TripRequestSerializer(serializers.Serializer):
    """Validates the four required inputs plus optional log-sheet details."""

    current_location = serializers.CharField(max_length=200, trim_whitespace=True)
    pickup_location = serializers.CharField(max_length=200, trim_whitespace=True)
    dropoff_location = serializers.CharField(max_length=200, trim_whitespace=True)
    current_cycle_used = serializers.FloatField(
        min_value=0,
        max_value=CYCLE_LIMIT_HOURS,
        help_text="On-duty hours already used in the 70 hour / 8 day cycle.",
    )
    start_datetime = serializers.DateTimeField(required=False, allow_null=True)

    driver_name = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    carrier_name = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    main_office = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    truck_number = serializers.CharField(
        max_length=60, required=False, allow_blank=True, default=""
    )
    trailer_number = serializers.CharField(
        max_length=60, required=False, allow_blank=True, default=""
    )
    shipper = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    commodity = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )
    load_id = serializers.CharField(
        max_length=60, required=False, allow_blank=True, default=""
    )
    co_driver = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )

    def validate_start_datetime(self, value):
        if value is None:
            return None
        # The planner works in home-terminal local time throughout, so drop any
        # incoming offset rather than silently shifting the driver's log.
        return value.replace(tzinfo=None)

    def validate(self, attrs):
        if not attrs.get("start_datetime"):
            attrs["start_datetime"] = datetime.now().replace(
                second=0, microsecond=0
            )
        pickup = attrs["pickup_location"].strip().lower()
        dropoff = attrs["dropoff_location"].strip().lower()
        if pickup == dropoff:
            raise serializers.ValidationError(
                {"dropoff_location": "Drop-off must differ from pickup."}
            )
        return attrs


class TripSummarySerializer(serializers.ModelSerializer):
    """Compact representation used by the recent-trips list."""

    title = serializers.CharField(read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "title",
            "current_location",
            "pickup_location",
            "dropoff_location",
            "cycle_used_hours",
            "start_datetime",
            "total_miles",
            "driving_minutes",
            "elapsed_minutes",
            "log_days",
            "is_compliant",
            "route_source",
            "created_at",
        ]


class TripDetailSerializer(TripSummarySerializer):
    class Meta(TripSummarySerializer.Meta):
        fields = TripSummarySerializer.Meta.fields + ["plan"]


class LocationSuggestionSerializer(serializers.Serializer):
    label = serializers.CharField()
    lat = serializers.FloatField()
    lon = serializers.FloatField()
    source = serializers.CharField()


class LogEntrySerializer(serializers.Serializer):
    """One span on an edited grid."""

    status = serializers.ChoiceField(choices=["OFF", "SB", "D", "ON"])
    start = serializers.IntegerField(min_value=0, max_value=1440)
    end = serializers.IntegerField(min_value=0, max_value=1440)
    kind = serializers.CharField(
        max_length=40, required=False, allow_blank=True, default="manual"
    )
    label = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default=""
    )

    def validate(self, attrs):
        if attrs["end"] <= attrs["start"]:
            raise serializers.ValidationError("end must be after start.")
        return attrs


class LogDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    entries = LogEntrySerializer(many=True)

    def validate_entries(self, value):
        if not value:
            raise serializers.ValidationError("A sheet needs at least one entry.")
        return value


class LogValidationSerializer(serializers.Serializer):
    """Payload for re-checking hand-edited log sheets."""

    days = LogDaySerializer(many=True)
    cycle_used_start = serializers.FloatField(
        min_value=0, max_value=CYCLE_LIMIT_HOURS, required=False, default=0.0
    )

    def validate_days(self, value):
        if not value:
            raise serializers.ValidationError("At least one sheet is required.")
        if len(value) > 31:
            raise serializers.ValidationError("Too many sheets in one request.")
        dates = [day["date"] for day in value]
        if len(set(dates)) != len(dates):
            raise serializers.ValidationError("Duplicate dates in the sheets.")
        return value
