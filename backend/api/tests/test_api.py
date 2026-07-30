"""API-level tests.

Upstream network calls are stubbed so the suite is deterministic and runs
offline; the geocoder and router each have their own fallback path, which these
tests exercise directly.
"""

from __future__ import annotations

import json
from unittest import mock

from django.conf import settings
from django.test import TestCase, override_settings

from api.models import Trip
from api.services import routing
from api.services.geo import GeoPoint

# Keep the persistent on-disk route/geocode cache out of the test run.
isolated_cache = override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "tests",
        }
    }
)

CHICAGO = GeoPoint("Chicago, IL", 41.8781, -87.6298, "offline")
STL = GeoPoint("Saint Louis, MO", 38.6270, -90.1994, "offline")
DALLAS = GeoPoint("Dallas, TX", 32.7767, -96.7970, "offline")


def fake_geocode(query, **kwargs):
    q = query.lower()
    if "chicago" in q:
        return CHICAGO
    if "louis" in q:
        return STL
    return DALLAS


@isolated_cache
class PlanEndpointTests(TestCase):
    def setUp(self):
        # Force the great-circle fallback so no network is touched.
        patcher = mock.patch.object(
            routing, "_route_osrm", side_effect=routing.RoutingError("offline")
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        geo_patcher = mock.patch("api.services.planner.geocode", fake_geocode)
        geo_patcher.start()
        self.addCleanup(geo_patcher.stop)

    def _post(self, **overrides):
        payload = {
            "current_location": "Chicago, IL",
            "pickup_location": "Saint Louis, MO",
            "dropoff_location": "Dallas, TX",
            "current_cycle_used": 12.5,
            "start_datetime": "2026-03-04T06:00:00",
        }
        payload.update(overrides)
        return self.client.post(
            "/api/plan/", data=json.dumps(payload),
            content_type="application/json"
        )

    def test_plan_returns_route_logs_and_compliance(self):
        response = self._post()
        self.assertEqual(response.status_code, 201, response.content)
        plan = response.json()["plan"]

        self.assertGreater(plan["route"]["total_miles"], 500)
        self.assertEqual(len(plan["route"]["legs"]), 2)
        self.assertTrue(plan["log_days"])
        self.assertTrue(plan["compliance"]["compliant"])
        self.assertEqual(plan["compliance"]["issues"], [])
        self.assertTrue(plan["route"]["degraded"])  # fallback was used

    def test_every_log_sheet_totals_twenty_four_hours(self):
        plan = self._post().json()["plan"]
        for day in plan["log_days"]:
            self.assertEqual(day["total_minutes"], 1440, day["date"])
            summed = sum(t["minutes"] for t in day["totals"].values())
            self.assertEqual(summed, 1440)

    def test_log_entries_are_contiguous_across_the_day(self):
        plan = self._post().json()["plan"]
        for day in plan["log_days"]:
            entries = day["entries"]
            self.assertEqual(entries[0]["start"], 0)
            self.assertEqual(entries[-1]["end"], 1440)
            for a, b in zip(entries, entries[1:]):
                self.assertEqual(a["end"], b["start"])

    def test_stops_include_pickup_dropoff_and_fuel(self):
        plan = self._post().json()["plan"]
        kinds = {stop["kind"] for stop in plan["stops"]}
        self.assertIn("pickup", kinds)
        self.assertIn("dropoff", kinds)
        self.assertIn("origin", kinds)
        for stop in plan["stops"]:
            self.assertTrue(stop["location"])
            self.assertIsInstance(stop["lat"], float)

    def test_daily_miles_sum_to_the_route_total(self):
        plan = self._post().json()["plan"]
        daily = sum(day["miles_driving"] for day in plan["log_days"])
        self.assertAlmostEqual(daily, plan["summary"]["total_miles"], delta=1.0)

    def test_trip_is_persisted_and_retrievable(self):
        trip_id = self._post().json()["id"]
        self.assertEqual(Trip.objects.count(), 1)
        detail = self.client.get(f"/api/trips/{trip_id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["id"], trip_id)
        self.assertIn("log_days", detail.json()["plan"])

    def test_high_cycle_usage_forces_a_restart(self):
        plan = self._post(current_cycle_used=69.5).json()["plan"]
        kinds = {stop["kind"] for stop in plan["stops"]}
        self.assertIn("restart", kinds)
        self.assertTrue(plan["compliance"]["compliant"])

    def test_remarks_carry_a_location_for_each_status_change(self):
        plan = self._post().json()["plan"]
        remarks = [r for day in plan["log_days"] for r in day["remarks"]]
        self.assertTrue(remarks)
        for remark in remarks:
            self.assertTrue(remark["location"])
            self.assertTrue(remark["clock"])


class ValidationTests(TestCase):
    def test_missing_fields_are_rejected(self):
        response = self.client.post(
            "/api/plan/", data=json.dumps({}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("errors", response.json())

    def test_cycle_hours_above_the_limit_are_rejected(self):
        response = self.client.post(
            "/api/plan/",
            data=json.dumps(
                {
                    "current_location": "Chicago, IL",
                    "pickup_location": "Saint Louis, MO",
                    "dropoff_location": "Dallas, TX",
                    "current_cycle_used": 85,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_identical_pickup_and_dropoff_rejected(self):
        response = self.client.post(
            "/api/plan/",
            data=json.dumps(
                {
                    "current_location": "Chicago, IL",
                    "pickup_location": "Dallas, TX",
                    "dropoff_location": "dallas, tx",
                    "current_cycle_used": 0,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_trip_returns_404(self):
        response = self.client.get(
            "/api/trips/00000000-0000-0000-0000-000000000000/"
        )
        self.assertEqual(response.status_code, 404)


@isolated_cache
class LocationLookupTests(TestCase):
    def test_autocomplete_returns_matches(self):
        response = self.client.get("/api/locations/?q=Fond")
        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertTrue(results)
        self.assertTrue(any("Fond" in r["label"] for r in results))

    def test_state_filter_is_honoured(self):
        response = self.client.get("/api/locations/?q=Springfield, IL")
        results = response.json()
        self.assertTrue(results)
        self.assertTrue(all(r["label"].endswith(", IL") for r in results))

    def test_blank_query_returns_nothing(self):
        self.assertEqual(self.client.get("/api/locations/?q=").json(), [])

    def test_health(self):
        self.assertEqual(self.client.get("/api/health/").json()["status"], "ok")


class CacheConfigurationTests(TestCase):
    """Regression: the typeahead fires several requests at once, and DRF's
    throttle counters live in the *default* cache. Pointing that at the
    file-based backend made concurrent requests race to expire the same file,
    which raises PermissionError on Windows and 500s the endpoint."""

    def test_throttle_cache_is_not_file_based(self):
        backend = settings.CACHES["default"]["BACKEND"]
        self.assertNotIn("filebased", backend)

    def test_geo_cache_is_persistent(self):
        self.assertIn("filebased", settings.CACHES["geo"]["BACKEND"])

    def test_cache_helpers_survive_a_broken_backend(self):
        from api.services import cache as cache_module

        class Broken:
            def get(self, *a, **k):
                raise OSError("locked")

            def set(self, *a, **k):
                raise OSError("locked")

        with mock.patch.object(cache_module, "_backend", lambda: Broken()):
            self.assertIsNone(cache_module.cache_get("k"))
            cache_module.cache_set("k", {"a": 1}, 60)  # must not raise

    def test_repeated_lookups_all_succeed(self):
        for _ in range(8):
            response = self.client.get("/api/locations/?q=Springfield")
            self.assertEqual(response.status_code, 200)
