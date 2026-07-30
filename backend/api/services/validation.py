"""Validates a hand-edited set of log sheets against the HOS rules.

The editor lets a driver redraw the grid by hand, so the result has to be
checked by the same engine that produced the original plan rather than by a
second implementation in the browser. Duplicating the rules in TypeScript would
guarantee the two drift apart, and the one in the UI is the one nobody tests.

Days arrive as independent 24-hour grids. Shift and window rules span
midnight, so they are stitched back into one continuous timeline first, using
each sheet's calendar date to place it.
"""

from __future__ import annotations

from datetime import date as Date
from datetime import timedelta

from .hos import (
    DRIVING,
    MINUTES_PER_DAY,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
    DutySegment,
    HOSRules,
    check_compliance,
    minutes_to_hours,
)

VALID_STATUSES = {OFF_DUTY, SLEEPER, DRIVING, ON_DUTY}


class StructuralIssue(ValueError):
    """The submitted grid is not a well-formed record of duty status."""


def validate_days(
    days: list[dict],
    cycle_used_hours: float = 0.0,
    rules: HOSRules | None = None,
) -> dict:
    """Check edited sheets and return per-day totals plus any violations."""
    rules = rules or HOSRules()
    if not days:
        raise StructuralIssue("At least one log sheet is required.")

    ordered = sorted(days, key=lambda d: d["date"])
    first_date: Date = ordered[0]["date"]

    segments: list[DutySegment] = []
    day_reports: list[dict] = []
    structural: list[dict] = []
    running_cycle = int(round(cycle_used_hours * 60))

    for day in ordered:
        offset = (day["date"] - first_date).days * MINUTES_PER_DAY
        entries = sorted(day["entries"], key=lambda e: e["start"])

        totals = {OFF_DUTY: 0, SLEEPER: 0, DRIVING: 0, ON_DUTY: 0}
        cursor = 0
        for entry in entries:
            start, end = int(entry["start"]), int(entry["end"])
            if end <= start:
                continue
            if start != cursor:
                structural.append(
                    {
                        "date": day["date"].isoformat(),
                        "detail": (
                            f"Gap or overlap at {_clock(cursor)} — entries must "
                            "run continuously from 00:00 to 24:00."
                        ),
                    }
                )
            cursor = end
            totals[entry["status"]] += end - start
            segments.append(
                DutySegment(
                    status=entry["status"],
                    start=offset + start,
                    end=offset + end,
                    kind=entry.get("kind", "manual"),
                    label=entry.get("label", ""),
                )
            )

        total_minutes = sum(totals.values())
        if total_minutes != MINUTES_PER_DAY:
            structural.append(
                {
                    "date": day["date"].isoformat(),
                    "detail": (
                        f"Sheet totals {minutes_to_hours(total_minutes):.2f} h; "
                        "a log sheet must total exactly 24.00 h."
                    ),
                }
            )

        on_duty = totals[DRIVING] + totals[ON_DUTY]
        # A 34-hour break anywhere on the sheet resets the cycle.
        if _has_restart(entries, rules):
            running_cycle = 0
        running_cycle += on_duty

        day_reports.append(
            {
                "date": day["date"].isoformat(),
                "totals": {
                    status: {
                        "minutes": minutes,
                        "hours": minutes_to_hours(minutes),
                    }
                    for status, minutes in totals.items()
                },
                "total_minutes": total_minutes,
                "balanced": total_minutes == MINUTES_PER_DAY,
                "on_duty_hours": minutes_to_hours(on_duty),
                "driving_hours": minutes_to_hours(totals[DRIVING]),
                "cycle_used_end": minutes_to_hours(running_cycle),
                "cycle_available_tomorrow": minutes_to_hours(
                    max(0, rules.cycle_limit - running_cycle)
                ),
            }
        )

    issues = check_compliance(segments, cycle_used_hours, rules)
    start_of_day = first_date

    return {
        "compliant": not issues and not structural,
        "issues": [
            {
                "rule": issue.rule,
                "citation": issue.citation,
                "detail": issue.detail,
                "at": _absolute(start_of_day, issue.at_minute),
            }
            for issue in issues
        ],
        "structural": structural,
        "days": day_reports,
        "summary": {
            "driving_minutes": sum(
                s.minutes for s in segments if s.status == DRIVING
            ),
            "on_duty_minutes": sum(
                s.minutes for s in segments if s.status == ON_DUTY
            ),
            "cycle_used_end": minutes_to_hours(running_cycle),
            "cycle_remaining": minutes_to_hours(
                max(0, rules.cycle_limit - running_cycle)
            ),
        },
    }


def _has_restart(entries: list[dict], rules: HOSRules) -> bool:
    """True when the sheet contains 34+ consecutive off-duty minutes.

    Only detectable within a single sheet here; a restart spanning midnight is
    caught by check_compliance on the stitched timeline.
    """
    run = 0
    for entry in sorted(entries, key=lambda e: e["start"]):
        if entry["status"] in (OFF_DUTY, SLEEPER):
            run += int(entry["end"]) - int(entry["start"])
            if run >= rules.restart_period:
                return True
        else:
            run = 0
    return False


def _clock(minute: int) -> str:
    minute = int(minute) % MINUTES_PER_DAY
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _absolute(first_date: Date, minute: int) -> str:
    day = first_date + timedelta(days=minute // MINUTES_PER_DAY)
    within = minute % MINUTES_PER_DAY
    return f"{day.isoformat()}T{within // 60:02d}:{within % 60:02d}:00"
