"""Persistence for planned trips.

The computed plan is stored whole in a JSON column. It is derived, immutable
output built from a fixed rule set, so normalising it into a dozen tables would
buy nothing but joins; the columns alongside it are the ones worth querying,
indexing, and reporting on.
"""

from __future__ import annotations

import uuid

from django.db import models


class Trip(models.Model):
    """A planned trip and its computed route, duty timeline, and log sheets."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # --- inputs ---------------------------------------------------------
    current_location = models.CharField(max_length=200)
    pickup_location = models.CharField(max_length=200)
    dropoff_location = models.CharField(max_length=200)
    cycle_used_hours = models.FloatField(default=0.0)
    start_datetime = models.DateTimeField()

    # --- optional log-sheet header details -------------------------------
    driver_name = models.CharField(max_length=120, blank=True)
    carrier_name = models.CharField(max_length=120, blank=True)
    main_office = models.CharField(max_length=200, blank=True)
    truck_number = models.CharField(max_length=60, blank=True)
    trailer_number = models.CharField(max_length=60, blank=True)
    shipper = models.CharField(max_length=120, blank=True)
    commodity = models.CharField(max_length=120, blank=True)
    load_id = models.CharField(max_length=60, blank=True)
    co_driver = models.CharField(max_length=120, blank=True)

    # --- denormalised results for listing and filtering -------------------
    total_miles = models.FloatField(default=0.0)
    driving_minutes = models.IntegerField(default=0)
    elapsed_minutes = models.IntegerField(default=0)
    log_days = models.IntegerField(default=0)
    is_compliant = models.BooleanField(default=True)
    route_source = models.CharField(max_length=20, default="osrm")

    plan = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["is_compliant"]),
        ]

    def __str__(self) -> str:
        return f"{self.pickup_location} to {self.dropoff_location}"

    @property
    def title(self) -> str:
        return f"{self.pickup_location} → {self.dropoff_location}"
