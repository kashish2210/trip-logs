"""Rule-by-rule tests for the HOS simulator.

These are plain ``unittest`` cases with no database access, so they run fast
under ``python manage.py test``.
"""

from __future__ import annotations

import unittest
from datetime import datetime

from api.services.hos import (
    DRIVING,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
    DriveTask,
    HOSRules,
    HOSSimulator,
    TripParams,
    WorkTask,
    build_log_days,
    check_compliance,
)

RULES = HOSRules()


def drive(hours: float, mph: float = 55.0, label: str = "Driving") -> DriveTask:
    minutes = int(round(hours * 60))
    return DriveTask(miles=hours * mph, minutes=minutes, label=label)


def run(tasks, cycle_used_hours: float = 0.0, params: TripParams | None = None):
    sim = HOSSimulator(params=params)
    return sim.run(tasks, cycle_used_hours=cycle_used_hours)


class DrivingLimitTests(unittest.TestCase):
    def test_short_trip_needs_no_rest(self):
        result = run([drive(4)])
        self.assertEqual(result.rest_breaks, 0)
        self.assertEqual(result.driving_minutes, 240)
        self.assertEqual(check_compliance(result.segments), [])

    def test_never_exceeds_eleven_hours_driving_in_a_shift(self):
        result = run([drive(30)])
        for shift in _shifts(result.segments):
            driving = sum(s.minutes for s in shift if s.status == DRIVING)
            self.assertLessEqual(driving, RULES.max_driving_per_shift)

    def test_never_drives_past_the_fourteen_hour_window(self):
        result = run([drive(30)])
        for shift in _shifts(result.segments):
            shift_start = shift[0].start
            last_drive = max(
                (s.end for s in shift if s.status == DRIVING), default=shift_start
            )
            self.assertLessEqual(
                last_drive - shift_start, RULES.max_shift_window
            )

    def test_thirty_minute_break_inserted_after_eight_hours_driving(self):
        result = run([drive(10)])
        breaks = [s for s in result.segments if s.kind == "break"]
        self.assertEqual(len(breaks), 1)
        self.assertEqual(breaks[0].minutes, 30)
        driving_before = sum(
            s.minutes
            for s in result.segments
            if s.status == DRIVING and s.end <= breaks[0].start
        )
        self.assertEqual(driving_before, RULES.driving_before_break)

    def test_reset_is_ten_consecutive_hours_off_duty(self):
        result = run([drive(20)])
        rests = _rest_runs(result.segments)
        self.assertTrue(rests, "expected at least one 10-hour reset")
        self.assertTrue(all(r >= RULES.required_reset for r in rests))

    def test_no_break_needed_when_driving_exactly_eight_hours(self):
        result = run([drive(8)])
        self.assertEqual([s for s in result.segments if s.kind == "break"], [])


class CycleTests(unittest.TestCase):
    def test_thirty_four_hour_restart_when_cycle_is_exhausted(self):
        result = run([drive(12)], cycle_used_hours=69.0)
        restarts = [s for s in result.segments if s.kind == "restart"]
        self.assertTrue(restarts, "expected a 34-hour restart")
        total = sum(
            s.minutes
            for s in result.segments
            if s.kind == "restart"
        )
        self.assertEqual(total, RULES.restart_period)

    def test_driver_starting_at_the_cycle_limit_restarts_before_driving(self):
        result = run([drive(2)], cycle_used_hours=70.0)
        first_drive = next(s for s in result.segments if s.status == DRIVING)
        restart = next(s for s in result.segments if s.kind == "restart")
        self.assertLess(restart.start, first_drive.start)

    def test_compliance_check_finds_no_violations_across_a_long_haul(self):
        result = run([drive(60)], cycle_used_hours=20.0)
        self.assertEqual(check_compliance(result.segments, 20.0), [])


class FuelAndWorkTests(unittest.TestCase):
    def test_fuel_stop_at_least_every_thousand_miles(self):
        result = run([drive(40, mph=60)])  # 2,400 miles
        self.assertGreaterEqual(result.fuel_stops, 2)
        miles_between = _miles_between_fuel(result.segments)
        self.assertTrue(all(m <= 1000.5 for m in miles_between), miles_between)

    def test_pickup_and_dropoff_are_one_hour_on_duty(self):
        tasks = [
            drive(2, label="Drive to pickup"),
            WorkTask(60, "Pickup", "pickup"),
            drive(3, label="Drive to drop-off"),
            WorkTask(60, "Drop-off", "dropoff"),
        ]
        result = run(tasks)
        pickup = next(s for s in result.segments if s.kind == "pickup")
        dropoff = next(s for s in result.segments if s.kind == "dropoff")
        self.assertEqual(pickup.minutes, 60)
        self.assertEqual(dropoff.minutes, 60)
        self.assertEqual(pickup.status, ON_DUTY)
        self.assertEqual(dropoff.status, ON_DUTY)

    def test_hour_at_pickup_satisfies_the_thirty_minute_break(self):
        # Drive 7h, load for an hour, then drive again: the loading hour is a
        # qualifying non-driving interruption so no separate break is needed
        # until 8 more cumulative driving hours have passed.
        tasks = [drive(7), WorkTask(60, "Pickup", "pickup"), drive(3)]
        result = run(tasks)
        self.assertEqual([s for s in result.segments if s.kind == "break"], [])

    def test_every_shift_opens_with_a_pre_trip_inspection(self):
        result = run([drive(25)])
        for shift in _shifts(result.segments):
            self.assertEqual(shift[0].kind, "pretrip")


class TimelineIntegrityTests(unittest.TestCase):
    def test_segments_are_contiguous_and_ordered(self):
        result = run([drive(30)])
        for a, b in zip(result.segments, result.segments[1:]):
            self.assertEqual(a.end, b.start)
            self.assertGreater(a.end, a.start)

    def test_total_miles_match_the_requested_distance(self):
        result = run([drive(10, mph=55)])
        self.assertAlmostEqual(result.total_miles, 550.0, places=3)

    def test_zero_distance_trip_is_handled(self):
        result = run([WorkTask(60, "Pickup", "pickup")])
        self.assertEqual(result.driving_minutes, 0)
        self.assertEqual(result.total_miles, 0.0)


class LogSheetTests(unittest.TestCase):
    def test_each_sheet_totals_exactly_twenty_four_hours(self):
        result = run([drive(26)])
        days = build_log_days(result.segments, datetime(2026, 3, 4, 6, 0))
        self.assertGreater(len(days), 1)
        for day in days:
            self.assertEqual(sum(day.totals.values()), 1440, day.date)

    def test_first_sheet_starts_off_duty_before_the_trip_begins(self):
        result = run([drive(4)])
        days = build_log_days(result.segments, datetime(2026, 3, 4, 6, 0))
        first = days[0].entries[0]
        self.assertEqual(first.status, OFF_DUTY)
        self.assertEqual(first.start, 0)
        self.assertEqual(first.end, 6 * 60)

    def test_daily_miles_sum_to_the_trip_total(self):
        result = run([drive(26, mph=55)])
        days = build_log_days(result.segments, datetime(2026, 3, 4, 6, 0))
        self.assertAlmostEqual(
            sum(d.miles_driving for d in days), result.total_miles, delta=0.5
        )

    def test_a_multi_day_rest_splits_across_sheets(self):
        result = run([drive(22)])
        days = build_log_days(result.segments, datetime(2026, 3, 4, 18, 0))
        statuses = {e.status for day in days for e in day.entries}
        self.assertIn(SLEEPER, statuses)

    def test_remarks_are_recorded_for_status_changes(self):
        result = run([drive(12)])
        days = build_log_days(result.segments, datetime(2026, 3, 4, 6, 0))
        self.assertTrue(days[0].remarks)
        self.assertTrue(all(0 <= r.minute <= 1440 for d in days for r in d.remarks))

    def test_cycle_recap_tracks_on_duty_hours(self):
        result = run([drive(9)], cycle_used_hours=10.0)
        days = build_log_days(result.segments, datetime(2026, 3, 4, 6, 0), 10.0)
        expected = 600 + days[0].on_duty_minutes
        self.assertEqual(days[0].cycle_used_end, expected)
        self.assertEqual(
            days[0].cycle_available_tomorrow, RULES.cycle_limit - expected
        )


class ValidationTests(unittest.TestCase):
    def test_negative_cycle_hours_rejected(self):
        with self.assertRaises(Exception):
            run([drive(1)], cycle_used_hours=-1)

    def test_compliance_checker_detects_a_planted_violation(self):
        result = run([drive(4)])
        segments = list(result.segments)
        # Force a 12-hour driving block into a single shift.
        driving = next(s for s in segments if s.status == DRIVING)
        driving.end = driving.start + 12 * 60
        for seg in segments[segments.index(driving) + 1:]:
            seg.start += 8 * 60
            seg.end += 8 * 60
        issues = check_compliance(segments)
        self.assertTrue(any("11-hour" in i.rule for i in issues))


# --- helpers -------------------------------------------------------------


def _shifts(segments):
    """Group segments into work shifts separated by 10+ hours of rest."""
    shifts, current, rest_run = [], [], 0
    for seg in segments:
        if seg.status in (OFF_DUTY, SLEEPER):
            rest_run += seg.minutes
            if rest_run >= RULES.required_reset and current:
                shifts.append(current)
                current = []
            if current:
                current.append(seg)
            continue
        if rest_run >= RULES.required_reset:
            rest_run = 0
        rest_run = 0
        current.append(seg)
    if current:
        shifts.append(current)
    return [s for s in shifts if s]


def _rest_runs(segments):
    runs, current = [], 0
    for seg in segments:
        if seg.status in (OFF_DUTY, SLEEPER):
            current += seg.minutes
        else:
            if current >= RULES.minimum_break:
                runs.append(current)
            current = 0
    if current >= RULES.minimum_break:
        runs.append(current)
    return [r for r in runs if r >= RULES.required_reset]


def _miles_between_fuel(segments):
    spans, last = [], 0.0
    for seg in segments:
        if seg.kind == "fuel":
            spans.append(seg.start_miles - last)
            last = seg.start_miles
    spans.append(segments[-1].end_miles - last)
    return spans


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
