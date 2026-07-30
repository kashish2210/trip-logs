from django.contrib import admin

from .models import Trip


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "start_datetime",
        "total_miles",
        "log_days",
        "is_compliant",
        "route_source",
        "created_at",
    )
    list_filter = ("is_compliant", "route_source", "created_at")
    search_fields = (
        "current_location",
        "pickup_location",
        "dropoff_location",
        "driver_name",
        "carrier_name",
    )
    readonly_fields = ("id", "created_at", "plan")
    date_hierarchy = "created_at"
