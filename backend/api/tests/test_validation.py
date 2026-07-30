"""Tests for validating hand-edited log sheets."""

from __future__ import annotations

import json
from datetime import date

from django.test import TestCase

from api.services.validation import StructuralIssue, validate_days


def span(status: str, start: int, end: int) -> dict:
    return {"status": status, "start": start, "end": end, "kind": "manual", "label": ""}


def full_day(*spans: dict) -> list[dict]:
    return list(spans)


class ValidateDaysTests(TestCase):
    def test_a_full_off_duty_day_is_compliant(self):
        result = validate_days(
            [{"date": date(2026, 3, 4), "entries": full_day(span("OFF", 0, 1440))}]
        )
        self.assertTrue(result["compliant"])
        self.assertEqual(result["issues"], [])
        self.assertEqual(result["structural"], [])
        self.assertEqual(result["days"][0]["total_minutes"], 1440)

    def test_totals_are_reported_per_status(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(
                        span("OFF", 0, 360),
                        span("ON", 360, 420),
                        span("D", 420, 900),
                        span("SB", 900, 1440),
                    ),
                }
            ]
        )
        totals = result["days"][0]["totals"]
        self.assertEqual(totals["D"]["minutes"], 480)
        self.assertEqual(totals["ON"]["minutes"], 60)
        self.assertEqual(totals["SB"]["minutes"], 540)
        self.assertEqual(result["days"][0]["on_duty_hours"], 9.0)

    def test_a_sheet_that_does_not_total_24_hours_is_flagged(self):
        result = validate_days(
            [{"date": date(2026, 3, 4), "entries": full_day(span("OFF", 0, 1000))}]
        )
        self.assertFalse(result["compliant"])
        self.assertTrue(result["structural"])
        self.assertIn("24.00", result["structural"][0]["detail"])

    def test_a_gap_between_entries_is_flagged(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(span("OFF", 0, 600), span("D", 700, 1440)),
                }
            ]
        )
        self.assertFalse(result["compliant"])
        self.assertTrue(any("Gap" in s["detail"] for s in result["structural"]))

    def test_twelve_hours_driving_breaks_the_eleven_hour_limit(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(
                        span("OFF", 0, 60),
                        span("D", 60, 780),  # 12 h straight
                        span("OFF", 780, 1440),
                    ),
                }
            ]
        )
        self.assertFalse(result["compliant"])
        rules = {issue["rule"] for issue in result["issues"]}
        self.assertIn("11-hour driving limit", rules)
        self.assertIn("30-minute break", rules)

    def test_driving_past_the_fourteen_hour_window_is_caught(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(
                        span("ON", 0, 600),  # 10 h on duty first
                        span("D", 600, 1020),  # driving from hour 10 to 17
                        span("OFF", 1020, 1440),
                    ),
                }
            ]
        )
        rules = {issue["rule"] for issue in result["issues"]}
        self.assertIn("14-hour driving window", rules)

    def test_shift_rules_span_midnight_across_two_sheets(self):
        # 7 h driving at the end of day 1 and 6 h at the start of day 2, with
        # no 10-hour reset between them: one shift, 13 h of driving.
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(
                        span("OFF", 0, 1020),
                        span("D", 1020, 1440),  # 7 h
                    ),
                },
                {
                    "date": date(2026, 3, 5),
                    "entries": full_day(
                        span("D", 0, 360),  # 6 h
                        span("OFF", 360, 1440),
                    ),
                },
            ]
        )
        rules = {issue["rule"] for issue in result["issues"]}
        self.assertIn("11-hour driving limit", rules)

    def test_a_reset_between_the_sheets_clears_the_shift(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(
                        span("OFF", 0, 60),
                        span("D", 60, 480),  # 7 h
                        span("SB", 480, 1440),
                    ),
                },
                {
                    "date": date(2026, 3, 5),
                    "entries": full_day(
                        span("SB", 0, 120),  # 10 h of rest in total
                        span("D", 120, 540),  # 7 h in a fresh shift
                        span("OFF", 540, 1440),
                    ),
                },
            ]
        )
        self.assertTrue(result["compliant"], result["issues"])

    def test_cycle_recap_rolls_forward_across_days(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(span("ON", 0, 600), span("OFF", 600, 1440)),
                },
                {
                    "date": date(2026, 3, 5),
                    "entries": full_day(span("ON", 0, 300), span("OFF", 300, 1440)),
                },
            ],
            cycle_used_hours=10.0,
        )
        self.assertEqual(result["days"][0]["cycle_used_end"], 20.0)
        self.assertEqual(result["days"][1]["cycle_used_end"], 25.0)
        self.assertEqual(result["days"][1]["cycle_available_tomorrow"], 45.0)

    def test_days_are_ordered_regardless_of_input_order(self):
        result = validate_days(
            [
                {
                    "date": date(2026, 3, 5),
                    "entries": full_day(span("OFF", 0, 1440)),
                },
                {
                    "date": date(2026, 3, 4),
                    "entries": full_day(span("OFF", 0, 1440)),
                },
            ]
        )
        self.assertEqual(
            [d["date"] for d in result["days"]], ["2026-03-04", "2026-03-05"]
        )

    def test_no_days_is_rejected(self):
        with self.assertRaises(StructuralIssue):
            validate_days([])


class ValidateEndpointTests(TestCase):
    def post(self, payload):
        return self.client.post(
            "/api/logs/validate/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_endpoint_returns_a_report(self):
        response = self.post(
            {
                "cycle_used_start": 8,
                "days": [
                    {
                        "date": "2026-03-04",
                        "entries": [
                            {"status": "OFF", "start": 0, "end": 360},
                            {"status": "D", "start": 360, "end": 840},
                            {"status": "OFF", "start": 840, "end": 1440},
                        ],
                    }
                ],
            }
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["compliant"])
        self.assertEqual(body["days"][0]["driving_hours"], 8.0)

    def test_bad_status_is_rejected(self):
        response = self.post(
            {
                "days": [
                    {
                        "date": "2026-03-04",
                        "entries": [{"status": "XX", "start": 0, "end": 1440}],
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 400)

    def test_backwards_entry_is_rejected(self):
        response = self.post(
            {
                "days": [
                    {
                        "date": "2026-03-04",
                        "entries": [{"status": "OFF", "start": 600, "end": 60}],
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 400)

    def test_duplicate_dates_are_rejected(self):
        day = {
            "date": "2026-03-04",
            "entries": [{"status": "OFF", "start": 0, "end": 1440}],
        }
        self.assertEqual(self.post({"days": [day, day]}).status_code, 400)

    def test_empty_days_rejected(self):
        self.assertEqual(self.post({"days": []}).status_code, 400)
