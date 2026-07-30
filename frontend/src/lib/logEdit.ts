import type { DutyStatus, LogDay, LogEntry } from "../types";
import { MINUTES_PER_DAY } from "./logGeometry";

/**
 * The editable model behind a log sheet.
 *
 * A day is stored as an ordered list of *duty changes* rather than a list of
 * spans. Spans have to stay contiguous and cover exactly 24 hours; changes get
 * that for free, because a change simply says "from this minute on, the driver
 * is in this status". Moving one point can never leave a gap or an overlap,
 * which is the whole reason edits here can't corrupt a sheet.
 *
 * Invariants, held by every operation in this file:
 *   - at least one change exists, and the first sits at minute 0
 *   - changes are sorted and no two share a minute
 *   - no change sits at or past midnight
 */

export interface DutyChange {
  /** Minute of day this status begins, 0-1439. */
  minute: number;
  status: DutyStatus;
  /** Machine-readable origin: drive, fuel, break, reset, manual, ... */
  kind: string;
  /** Activity shown in the Remarks column. */
  label: string;
  /** City and state, per Sec. 395.8(h)(6). */
  location: string;
}

export interface DutySpan extends DutyChange {
  start: number;
  end: number;
  minutes: number;
}

export const DUTY_ORDER: DutyStatus[] = ["OFF", "SB", "D", "ON"];

/* -------------------------------------------------------------------------
   Conversion
   ------------------------------------------------------------------------- */

export function toChanges(entries: LogEntry[]): DutyChange[] {
  const changes: DutyChange[] = entries
    .filter((entry) => entry.end > entry.start)
    .map((entry) => ({
      minute: Math.round(entry.start),
      status: entry.status,
      kind: entry.kind,
      label: entry.label,
      location: entry.location ?? "",
    }));
  return normalise(changes);
}

export function toSpans(changes: DutyChange[]): DutySpan[] {
  const ordered = normalise(changes);
  return ordered.map((change, i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1].minute : MINUTES_PER_DAY;
    return { ...change, start: change.minute, end, minutes: end - change.minute };
  });
}

/** Sort, drop duplicates, anchor at midnight, and merge adjacent duplicates. */
export function normalise(changes: DutyChange[]): DutyChange[] {
  const sorted = [...changes]
    .map((c) => ({
      ...c,
      minute: clampMinute(Math.round(c.minute)),
    }))
    .sort((a, b) => a.minute - b.minute);

  const byMinute: DutyChange[] = [];
  for (const change of sorted) {
    const previous = byMinute[byMinute.length - 1];
    if (previous && previous.minute === change.minute) {
      byMinute[byMinute.length - 1] = change; // later write wins
    } else {
      byMinute.push(change);
    }
  }

  if (byMinute.length === 0) {
    return [
      { minute: 0, status: "OFF", kind: "offduty", label: "Off duty", location: "" },
    ];
  }
  if (byMinute[0].minute !== 0) {
    byMinute.unshift({
      minute: 0,
      status: "OFF",
      kind: "offduty",
      label: "Off duty",
      location: byMinute[0].location,
    });
  }

  // A change to the status already in effect is not a change.
  const merged: DutyChange[] = [];
  for (const change of byMinute) {
    const previous = merged[merged.length - 1];
    if (previous && previous.status === change.status) continue;
    merged.push(change);
  }
  return merged;
}

function clampMinute(minute: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY - 1, minute));
}

/* -------------------------------------------------------------------------
   Operations - all immutable
   ------------------------------------------------------------------------- */

export function snap(minute: number, step: number): number {
  if (step <= 1) return Math.round(minute);
  return Math.round(minute / step) * step;
}

/** Insert a change, or restyle the existing one if the minute is taken. */
export function addChange(
  changes: DutyChange[],
  minute: number,
  status: DutyStatus
): DutyChange[] {
  const at = clampMinute(Math.round(minute));
  const existing = changes.find((c) => c.minute === at);
  if (existing) {
    return normalise(
      changes.map((c) => (c.minute === at ? { ...c, status } : c))
    );
  }
  return normalise([
    ...changes,
    { minute: at, status, kind: "manual", label: labelFor(status), location: "" },
  ]);
}

/**
 * Move a change in time.
 *
 * The first change anchors midnight and cannot move; the rest are held strictly
 * between their neighbours so the ordering can never invert mid-drag.
 */
export function moveChange(
  changes: DutyChange[],
  index: number,
  minute: number
): DutyChange[] {
  if (index <= 0 || index >= changes.length) return changes;
  const lower = changes[index - 1].minute + 1;
  const upper =
    index + 1 < changes.length
      ? changes[index + 1].minute - 1
      : MINUTES_PER_DAY - 1;
  if (upper < lower) return changes;

  const target = Math.max(lower, Math.min(upper, Math.round(minute)));
  const next = [...changes];
  next[index] = { ...next[index], minute: target };
  // Deliberately not normalised: merging mid-drag would delete the point the
  // pointer is holding. Callers normalise when the drag ends.
  return next;
}

export function setStatus(
  changes: DutyChange[],
  index: number,
  status: DutyStatus
): DutyChange[] {
  if (index < 0 || index >= changes.length) return changes;
  const next = [...changes];
  const current = next[index];
  next[index] = {
    ...current,
    status,
    kind: current.kind === "manual" ? "manual" : current.kind,
    label:
      current.kind === "manual" || current.label === labelFor(current.status)
        ? labelFor(status)
        : current.label,
  };
  return next;
}

export function updateChange(
  changes: DutyChange[],
  index: number,
  patch: Partial<DutyChange>
): DutyChange[] {
  if (index < 0 || index >= changes.length) return changes;
  const next = [...changes];
  next[index] = { ...next[index], ...patch };
  return next;
}

/** Remove a change; the preceding status simply runs on through it. */
export function removeChange(
  changes: DutyChange[],
  index: number
): DutyChange[] {
  if (index <= 0 || index >= changes.length) return changes;
  return normalise(changes.filter((_, i) => i !== index));
}

/* -------------------------------------------------------------------------
   Derived values
   ------------------------------------------------------------------------- */

export function totalsOf(changes: DutyChange[]): Record<DutyStatus, number> {
  const totals: Record<DutyStatus, number> = { OFF: 0, SB: 0, D: 0, ON: 0 };
  for (const span of toSpans(changes)) totals[span.status] += span.minutes;
  return totals;
}

export function labelFor(status: DutyStatus): string {
  switch (status) {
    case "OFF":
      return "Off duty";
    case "SB":
      return "Sleeper berth";
    case "D":
      return "Driving";
    default:
      return "On duty (not driving)";
  }
}

/** The SVG path for the duty trace, in sheet coordinates. */
export function tracePath(
  spans: DutySpan[],
  xAt: (minute: number) => number,
  yAt: (status: DutyStatus) => number
): string {
  const parts: string[] = [];
  spans.forEach((span, i) => {
    const y = yAt(span.status);
    parts.push(i === 0 ? `M ${xAt(span.start)} ${y}` : `L ${xAt(span.start)} ${y}`);
    parts.push(`L ${xAt(span.end)} ${y}`);
  });
  return parts.join(" ");
}

/** Apply edited changes back onto a LogDay so the rest of the app sees them. */
export function applyChanges(day: LogDay, changes: DutyChange[]): LogDay {
  const spans = toSpans(changes);
  const totals = totalsOf(changes);
  const entries: LogEntry[] = spans.map((span) => ({
    status: span.status,
    status_label: labelFor(span.status),
    kind: span.kind,
    label: span.label,
    start: span.start,
    end: span.end,
    start_clock: hhmm(span.start),
    end_clock: hhmm(span.end),
    minutes: span.minutes,
    hours: Number((span.minutes / 60).toFixed(2)),
    miles: 0,
    location: span.location,
    lat: 0,
    lon: 0,
  }));

  const onDuty = totals.D + totals.ON;
  return {
    ...day,
    entries,
    remarks: spans
      .filter((span, i) => i > 0 || span.kind !== "offduty")
      .map((span) => ({
        minute: span.start,
        clock: hhmm(span.start),
        label: span.label,
        kind: span.kind,
        location: span.location,
        lat: null,
        lon: null,
      })),
    totals: {
      OFF: { minutes: totals.OFF, hours: round2(totals.OFF / 60) },
      SB: { minutes: totals.SB, hours: round2(totals.SB / 60) },
      D: { minutes: totals.D, hours: round2(totals.D / 60) },
      ON: { minutes: totals.ON, hours: round2(totals.ON / 60) },
    },
    total_minutes: MINUTES_PER_DAY,
    on_duty_hours: round2(onDuty / 60),
  };
}

function hhmm(minute: number): string {
  const m = Math.round(minute) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/* -------------------------------------------------------------------------
   Undo / redo
   ------------------------------------------------------------------------- */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const HISTORY_LIMIT = 60;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, present: T): History<T> {
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
  };
}

/** Replace the present without recording a step - used during a live drag. */
export function replaceHistory<T>(history: History<T>, present: T): History<T> {
  return { ...history, present };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: rest,
  };
}
