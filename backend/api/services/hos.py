"""FMCSA Hours-of-Service simulator for property-carrying CMV drivers.

This module is deliberately free of Django imports so the rule engine can be
unit tested in isolation. Everything is computed in **integer minutes** relative
to the trip start, and in the driver's home-terminal local time (49 CFR
395.8(d) requires the RODS grid to use a single home-terminal time base).

Rules implemented (Interstate Truck Driver's Guide to Hours of Service, 2022):

===========================  ===========  =========================================
Rule                         Limit        Citation
===========================  ===========  =========================================
Driving limit                11 h         Sec. 395.3(a)(3)
Driving window               14 h         Sec. 395.3(a)(2)
Break from driving           30 min after Sec. 395.3(a)(3)(ii)
                             8 h cumulative driving
Off-duty reset               10 h         Sec. 395.3(a)(1)
On-duty cycle                70 h / 8 day Sec. 395.3(b)(2)
Cycle restart                34 h         Sec. 395.3(c)
===========================  ===========  =========================================

Assessment assumptions baked in as defaults: property-carrying driver on the
70 hr / 8 day cycle, no adverse-driving exception, fuelling at least once every
1,000 miles, and one hour on duty at both pickup and drop-off.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Iterable, Literal

# --- Duty statuses -------------------------------------------------------
# Values match the four horizontal lines of the FMCSA graph grid.
OFF_DUTY = "OFF"  # line 1 - Off Duty
SLEEPER = "SB"  # line 2 - Sleeper Berth
DRIVING = "D"  # line 3 - Driving
ON_DUTY = "ON"  # line 4 - On Duty (Not Driving)

DutyStatus = Literal["OFF", "SB", "D", "ON"]

STATUS_ORDER: tuple[DutyStatus, ...] = (OFF_DUTY, SLEEPER, DRIVING, ON_DUTY)
STATUS_LABELS: dict[str, str] = {
    OFF_DUTY: "Off Duty",
    SLEEPER: "Sleeper Berth",
    DRIVING: "Driving",
    ON_DUTY: "On Duty (Not Driving)",
}

MINUTES_PER_DAY = 24 * 60


class HOSError(ValueError):
    """Raised when a trip cannot be planned under the HOS rules."""


# --- Configuration -------------------------------------------------------


@dataclass(frozen=True)
class HOSRules:
    """The hard regulatory limits, all in minutes."""

    max_driving_per_shift: int = 11 * 60  # 395.3(a)(3)
    max_shift_window: int = 14 * 60  # 395.3(a)(2)
    driving_before_break: int = 8 * 60  # 395.3(a)(3)(ii)
    minimum_break: int = 30
    required_reset: int = 10 * 60  # 395.3(a)(1)
    cycle_limit: int = 70 * 60  # 395.3(b)(2)
    cycle_days: int = 8
    restart_period: int = 34 * 60  # 395.3(c)

    def validate(self) -> None:
        if self.max_driving_per_shift > self.max_shift_window:
            raise HOSError("Driving limit cannot exceed the driving window.")


@dataclass(frozen=True)
class TripParams:
    """Operational assumptions that are not themselves regulations."""

    fuel_interval_miles: float = 1000.0
    fuel_minutes: int = 30
    pickup_minutes: int = 60
    dropoff_minutes: int = 60
    pretrip_minutes: int = 15
    posttrip_minutes: int = 15
    # A 10-hour reset is logged as a short off-duty period followed by sleeper
    # berth time, which is how drivers actually record it.
    reset_off_duty_minutes: int = 60
    average_speed_mph: float = 55.0


# --- Inputs / outputs ----------------------------------------------------


@dataclass(frozen=True)
class DriveTask:
    """A stretch of route the driver has to cover."""

    miles: float
    minutes: int
    label: str
    leg: int = 0


@dataclass(frozen=True)
class WorkTask:
    """A fixed on-duty (not driving) obligation such as loading."""

    minutes: int
    label: str
    kind: str
    leg: int = 0


Task = DriveTask | WorkTask


@dataclass
class DutySegment:
    """One contiguous run of a single duty status."""

    status: DutyStatus
    start: int  # minutes from trip start
    end: int  # minutes from trip start
    kind: str  # machine-readable reason: drive, fuel, break, reset, ...
    label: str  # human-readable activity for the Remarks section
    start_miles: float = 0.0
    end_miles: float = 0.0

    @property
    def minutes(self) -> int:
        return self.end - self.start

    @property
    def miles(self) -> float:
        return self.end_miles - self.start_miles


@dataclass
class SimulationResult:
    segments: list[DutySegment]
    total_minutes: int
    total_miles: float
    driving_minutes: int
    on_duty_minutes: int
    cycle_used_at_end: int
    rest_breaks: int
    fuel_stops: int
    restarts: int


# --- The simulator -------------------------------------------------------


class HOSSimulator:
    """Walks a list of tasks forward in time, inserting rests as required.

    The simulator is *constructive*: rather than planning a schedule and then
    checking it, it only ever advances the clock by an amount that every active
    limit permits. A compliant schedule therefore falls out by construction, and
    :func:`check_compliance` independently re-derives the clocks to prove it.
    """

    def __init__(
        self,
        rules: HOSRules | None = None,
        params: TripParams | None = None,
    ) -> None:
        self.rules = rules or HOSRules()
        self.params = params or TripParams()
        self.rules.validate()

    # -- internal state helpers ------------------------------------------

    def _reset_state(self, cycle_used_minutes: int) -> None:
        self.now = 0
        self.segments: list[DutySegment] = []
        self.cum_miles = 0.0
        self.miles_since_fuel = 0.0
        self.cycle_used = cycle_used_minutes
        self.shift_start: int | None = None
        self.driving_this_shift = 0
        self.driving_since_break = 0
        self.drove_this_shift = False
        self.counters = {"rest": 0, "fuel": 0, "restart": 0, "break": 0}

    def _add(
        self,
        status: DutyStatus,
        minutes: int,
        kind: str,
        label: str,
        miles: float = 0.0,
    ) -> None:
        """Append a segment, advancing the clock and every duty counter."""
        if minutes <= 0:
            return
        start_miles = self.cum_miles
        self.cum_miles += miles
        segment = DutySegment(
            status=status,
            start=self.now,
            end=self.now + minutes,
            kind=kind,
            label=label,
            start_miles=start_miles,
            end_miles=self.cum_miles,
        )
        # Merge with the previous segment when the status and activity are
        # identical, so the drawn grid shows one clean line instead of joins.
        if self.segments:
            prev = self.segments[-1]
            if prev.status == status and prev.kind == kind and prev.label == label:
                prev.end = segment.end
                prev.end_miles = segment.end_miles
            else:
                self.segments.append(segment)
        else:
            self.segments.append(segment)

        self.now += minutes
        if status in (DRIVING, ON_DUTY):
            self.cycle_used += minutes
        if status == DRIVING:
            self.driving_this_shift += minutes
            self.driving_since_break += minutes
            self.miles_since_fuel += miles
            self.drove_this_shift = True
        elif minutes >= self.rules.minimum_break:
            # Sec. 395.3(a)(3)(ii): the qualifying break may be taken off duty,
            # on duty, or in the sleeper berth - any 30 consecutive non-driving
            # minutes satisfy it.
            self.driving_since_break = 0

    def _begin_shift(self) -> None:
        """Start a new 14-hour driving window with a pre-trip inspection."""
        if self.shift_start is not None:
            return
        self.shift_start = self.now
        self.driving_this_shift = 0
        self.drove_this_shift = False
        self._add(
            ON_DUTY,
            self.params.pretrip_minutes,
            "pretrip",
            "Pre-trip inspection",
        )

    def _end_shift(self, total_rest: int, kind: str, label: str) -> None:
        """Close the shift with a post-trip inspection and a qualifying rest."""
        if self.drove_this_shift:
            self._add(
                ON_DUTY,
                self.params.posttrip_minutes,
                "posttrip",
                "Post-trip inspection",
            )
        # Logged the way drivers actually record it: a short off-duty period,
        # then the balance in the sleeper berth. Both count as off-duty time
        # toward the consecutive-hours requirement.
        off = min(self.params.reset_off_duty_minutes, total_rest)
        self._add(OFF_DUTY, off, kind, label)
        self._add(SLEEPER, total_rest - off, kind, "Sleeper berth")
        self.shift_start = None
        self.driving_this_shift = 0
        self.driving_since_break = 0
        self.drove_this_shift = False

    def _take_reset(self) -> None:
        self.counters["rest"] += 1
        self._end_shift(
            self.rules.required_reset, "reset", "10-hour off-duty reset"
        )

    def _take_restart(self) -> None:
        self.counters["restart"] += 1
        self._end_shift(
            self.rules.restart_period, "restart", "34-hour cycle restart"
        )
        self.cycle_used = 0

    def _take_break(self) -> None:
        self.counters["break"] += 1
        self._add(
            OFF_DUTY,
            self.rules.minimum_break,
            "break",
            "30-minute rest break",
        )

    def _take_fuel(self) -> None:
        self.counters["fuel"] += 1
        self._add(
            ON_DUTY,
            self.params.fuel_minutes,
            "fuel",
            "Fuel stop",
        )
        self.miles_since_fuel = 0.0

    # -- public API -------------------------------------------------------

    def run(
        self,
        tasks: Iterable[Task],
        cycle_used_hours: float = 0.0,
    ) -> SimulationResult:
        rules = self.rules
        if cycle_used_hours < 0:
            raise HOSError("Current cycle used cannot be negative.")
        cycle_used = int(round(cycle_used_hours * 60))
        if cycle_used >= rules.cycle_limit:
            # Legal, but the driver must restart before touching the wheel.
            pass

        self._reset_state(cycle_used)

        for task in tasks:
            if isinstance(task, WorkTask):
                self._run_work(task)
            else:
                self._run_drive(task)

        # Close the trip out: final post-trip inspection, then off duty.
        if self.shift_start is not None:
            if self.drove_this_shift:
                self._add(
                    ON_DUTY,
                    self.params.posttrip_minutes,
                    "posttrip",
                    "Post-trip inspection",
                )
            self._add(OFF_DUTY, 1, "offduty", "Off duty")
            self.shift_start = None

        driving = sum(s.minutes for s in self.segments if s.status == DRIVING)
        on_duty = sum(s.minutes for s in self.segments if s.status == ON_DUTY)
        return SimulationResult(
            segments=self.segments,
            total_minutes=self.now,
            total_miles=self.cum_miles,
            driving_minutes=driving,
            on_duty_minutes=on_duty,
            cycle_used_at_end=self.cycle_used,
            rest_breaks=self.counters["rest"],
            fuel_stops=self.counters["fuel"],
            restarts=self.counters["restart"],
        )

    def _run_work(self, task: WorkTask) -> None:
        """On-duty work. Permitted past the 14-hour window; only driving isn't."""
        if task.minutes <= 0:
            return
        # Loading/unloading past the cycle limit is legal (you just can't
        # drive), so no restart is forced here - the drive loop handles it.
        self._begin_shift()
        self._add(ON_DUTY, task.minutes, task.kind, task.label)

    def _run_drive(self, task: DriveTask) -> None:
        rules = self.rules
        params = self.params
        remaining = int(task.minutes)
        if remaining <= 0:
            return
        # Miles per minute for this leg, derived from the routing engine's own
        # duration so the plan reflects real road speeds rather than a guess.
        mpm = (task.miles / task.minutes) if task.minutes > 0 else 0.0

        guard = 0
        while remaining > 0:
            guard += 1
            if guard > 10_000:  # pragma: no cover - structural safety net
                raise HOSError("HOS simulation failed to converge.")

            self._begin_shift()
            assert self.shift_start is not None

            drive_left = rules.max_driving_per_shift - self.driving_this_shift
            window_left = rules.max_shift_window - (self.now - self.shift_start)
            break_left = rules.driving_before_break - self.driving_since_break
            cycle_left = rules.cycle_limit - self.cycle_used

            # Resolve blocking limits in order of severity.
            if cycle_left <= 0:
                self._take_restart()
                continue
            if drive_left <= 0 or window_left <= 0:
                self._take_reset()
                continue
            if break_left <= 0:
                self._take_break()
                continue

            if mpm > 0:
                miles_left = params.fuel_interval_miles - self.miles_since_fuel
                fuel_left = int(math.floor(miles_left / mpm))
            else:
                fuel_left = remaining
            if fuel_left <= 0:
                self._take_fuel()
                continue

            chunk = min(remaining, drive_left, window_left, break_left,
                        cycle_left, fuel_left)
            if chunk <= 0:  # pragma: no cover - defensive
                raise HOSError("No legal driving time available.")

            self._add(DRIVING, chunk, "drive", task.label, miles=chunk * mpm)
            remaining -= chunk


# --- Independent compliance check ---------------------------------------


@dataclass
class ComplianceIssue:
    rule: str
    citation: str
    detail: str
    at_minute: int


def check_compliance(
    segments: list[DutySegment],
    cycle_used_hours: float = 0.0,
    rules: HOSRules | None = None,
) -> list[ComplianceIssue]:
    """Re-derive every clock from the finished timeline and report violations.

    This intentionally shares no state with :class:`HOSSimulator` so that it is
    a genuine check rather than a restatement of the generator.
    """
    rules = rules or HOSRules()
    issues: list[ComplianceIssue] = []

    driving_shift = 0
    driving_since_break = 0
    shift_start: int | None = None
    rest_run = 0  # consecutive off-duty/sleeper minutes
    non_driving_run = 0  # consecutive minutes not driving, any status
    cycle = int(round(cycle_used_hours * 60))

    for seg in segments:
        if seg.status != DRIVING:
            # Sec. 395.3(a)(3)(ii): the qualifying interruption may be taken
            # off duty, on duty, or in the sleeper berth, so a fuel stop or a
            # loading hour counts just as much as a formal break.
            non_driving_run += seg.minutes
            if non_driving_run >= rules.minimum_break:
                driving_since_break = 0

            if seg.status in (OFF_DUTY, SLEEPER):
                rest_run += seg.minutes
                if rest_run >= rules.required_reset:
                    shift_start = None
                    driving_shift = 0
                    driving_since_break = 0
                if rest_run >= rules.restart_period:
                    cycle = 0
                continue

            # On duty (not driving): counts against the cycle and the window,
            # but breaks any run of consecutive rest.
            rest_run = 0
            if shift_start is None:
                shift_start = seg.start
            cycle += seg.minutes
            continue

        # Driving.
        rest_run = 0
        non_driving_run = 0
        if shift_start is None:
            shift_start = seg.start
        cycle += seg.minutes
        if cycle > rules.cycle_limit:
            issues.append(
                ComplianceIssue(
                    "70-hour / 8-day limit",
                    "49 CFR 395.3(b)(2)",
                    f"Driving with {cycle / 60:.1f} h on duty in the cycle.",
                    seg.start,
                )
            )

        if seg.end - shift_start > rules.max_shift_window:
            issues.append(
                ComplianceIssue(
                    "14-hour driving window",
                    "49 CFR 395.3(a)(2)",
                    "Driving after the 14th hour of the work shift.",
                    seg.start,
                )
            )
        driving_shift += seg.minutes
        if driving_shift > rules.max_driving_per_shift:
            issues.append(
                ComplianceIssue(
                    "11-hour driving limit",
                    "49 CFR 395.3(a)(3)",
                    f"{driving_shift / 60:.1f} h driven in one shift.",
                    seg.start,
                )
            )
        driving_since_break += seg.minutes
        if driving_since_break > rules.driving_before_break:
            issues.append(
                ComplianceIssue(
                    "30-minute break",
                    "49 CFR 395.3(a)(3)(ii)",
                    f"{driving_since_break / 60:.1f} h driving without a "
                    "30-minute interruption.",
                    seg.start,
                )
            )

    return issues


# --- Daily log construction ---------------------------------------------


@dataclass
class LogEntry:
    status: DutyStatus
    start: int  # minute of day, 0-1440
    end: int
    kind: str
    label: str
    start_miles: float = 0.0
    end_miles: float = 0.0


@dataclass
class LogRemark:
    minute: int
    label: str
    kind: str = ""
    mile: float = 0.0
    location: str = ""
    lat: float | None = None
    lon: float | None = None


@dataclass
class LogDay:
    day_index: int
    date: date
    entries: list[LogEntry] = field(default_factory=list)
    remarks: list[LogRemark] = field(default_factory=list)
    totals: dict[str, int] = field(default_factory=dict)
    miles_driving: float = 0.0
    on_duty_minutes: int = 0
    cycle_used_end: int = 0
    cycle_available_tomorrow: int = 0


def build_log_days(
    segments: list[DutySegment],
    start_dt: datetime,
    cycle_used_hours: float = 0.0,
    rules: HOSRules | None = None,
) -> list[LogDay]:
    """Split a duty timeline into one 24-hour RODS grid per calendar day.

    Any part of a day not covered by the trip is padded with off-duty time so
    every sheet totals exactly 24 hours, as Sec. 395.8(h)(5) requires.
    """
    rules = rules or HOSRules()
    if not segments:
        return []

    day_zero = start_dt.date()
    start_offset = start_dt.hour * 60 + start_dt.minute
    total_end = segments[-1].end + start_offset
    last_day = (total_end - 1) // MINUTES_PER_DAY

    # Bucket segments into days, clipping at midnight.
    buckets: dict[int, list[LogEntry]] = {d: [] for d in range(last_day + 1)}
    for seg in segments:
        abs_start = seg.start + start_offset
        abs_end = seg.end + start_offset
        if abs_end <= abs_start:
            continue
        span = abs_end - abs_start
        cursor = abs_start
        while cursor < abs_end:
            day = cursor // MINUTES_PER_DAY
            day_end = (day + 1) * MINUTES_PER_DAY
            slice_end = min(abs_end, day_end)
            frac_a = (cursor - abs_start) / span
            frac_b = (slice_end - abs_start) / span
            buckets.setdefault(day, []).append(
                LogEntry(
                    status=seg.status,
                    start=cursor - day * MINUTES_PER_DAY,
                    end=slice_end - day * MINUTES_PER_DAY,
                    kind=seg.kind,
                    label=seg.label,
                    start_miles=seg.start_miles + frac_a * seg.miles,
                    end_miles=seg.start_miles + frac_b * seg.miles,
                )
            )
            cursor = slice_end

    days: list[LogDay] = []
    running_cycle = int(round(cycle_used_hours * 60))
    for index in range(last_day + 1):
        entries = sorted(buckets.get(index, []), key=lambda e: e.start)
        entries = _pad_with_off_duty(entries)
        totals = {status: 0 for status in STATUS_ORDER}
        for entry in entries:
            totals[entry.status] += entry.end - entry.start

        miles = sum(e.end_miles - e.start_miles for e in entries
                    if e.status == DRIVING)
        on_duty = totals[DRIVING] + totals[ON_DUTY]

        # A 34-hour restart zeroes the cycle; detect one ending on this day.
        if any(e.kind == "restart" for e in entries):
            running_cycle = 0
        running_cycle += on_duty

        days.append(
            LogDay(
                day_index=index,
                date=day_zero + timedelta(days=index),
                entries=entries,
                remarks=_remarks_for(entries),
                totals={k: v for k, v in totals.items()},
                miles_driving=round(miles, 1),
                on_duty_minutes=on_duty,
                cycle_used_end=running_cycle,
                cycle_available_tomorrow=max(0, rules.cycle_limit - running_cycle),
            )
        )
    return days


def _pad_with_off_duty(entries: list[LogEntry]) -> list[LogEntry]:
    """Fill gaps (and the head/tail of the day) with off-duty time."""
    padded: list[LogEntry] = []
    cursor = 0
    for entry in entries:
        if entry.start > cursor:
            padded.append(
                LogEntry(OFF_DUTY, cursor, entry.start, "offduty", "Off duty")
            )
        padded.append(entry)
        cursor = max(cursor, entry.end)
    if cursor < MINUTES_PER_DAY:
        padded.append(
            LogEntry(OFF_DUTY, cursor, MINUTES_PER_DAY, "offduty", "Off duty")
        )

    # Collapse neighbouring identical statuses so the drawn line is continuous.
    merged: list[LogEntry] = []
    for entry in padded:
        if (
            merged
            and merged[-1].status == entry.status
            and merged[-1].kind == entry.kind
            and merged[-1].label == entry.label
        ):
            merged[-1].end = entry.end
            merged[-1].end_miles = entry.end_miles
        else:
            merged.append(replace(entry))
    return merged


def _remarks_for(entries: list[LogEntry]) -> list[LogRemark]:
    """One remark per change of duty status, per Sec. 395.8(h)(6)."""
    remarks: list[LogRemark] = []
    for i, entry in enumerate(entries):
        if i == 0 and entry.kind == "offduty":
            continue  # start-of-day padding is not a status change
        if entry.kind == "offduty" and entry.end >= MINUTES_PER_DAY:
            continue  # end-of-day padding
        remarks.append(
            LogRemark(
                minute=entry.start,
                label=entry.label,
                kind=entry.kind,
                mile=entry.start_miles,
            )
        )
    return remarks


def minutes_to_clock(minutes: int) -> str:
    """Render a minute-of-day as ``HH:MM`` on a 24-hour clock."""
    minutes = int(minutes) % MINUTES_PER_DAY
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def minutes_to_hours(minutes: int) -> float:
    """Render minutes as the decimal hours drivers total on the log."""
    return round(minutes / 60.0, 2)
