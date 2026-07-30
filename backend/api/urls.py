from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("locations/", views.locations, name="locations"),
    path("plan/", views.plan, name="plan"),
    path("logs/validate/", views.validate_logs, name="validate-logs"),
    path("trips/", views.trip_list, name="trip-list"),
    path("trips/<uuid:trip_id>/", views.trip_detail, name="trip-detail"),
]
