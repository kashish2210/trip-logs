import type { DutyStatus } from "../types";

/** "9h 30m" - how drivers read a duration. */
export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Decimal hours, the way they are totalled on the log sheet. */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function clock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function miles(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function longDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function dateParts(iso: string): { month: string; day: string; year: string } {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return {
    month: String(d.getMonth() + 1).padStart(2, "0"),
    day: String(d.getDate()).padStart(2, "0"),
    year: String(d.getFullYear()),
  };
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A local `datetime-local` value for "now", rounded to the minute. */
export function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export const DUTY_META: Record<
  DutyStatus,
  { line: number; short: string; label: string; color: string }
> = {
  OFF: { line: 1, short: "Off", label: "Off Duty", color: "var(--duty-off)" },
  SB: { line: 2, short: "SB", label: "Sleeper Berth", color: "var(--duty-sb)" },
  D: { line: 3, short: "Drive", label: "Driving", color: "var(--duty-drive)" },
  ON: {
    line: 4,
    short: "On",
    label: "On Duty (Not Driving)",
    color: "var(--duty-on)",
  },
};

export const STOP_META: Record<string, { icon: string; color: string }> = {
  origin: { icon: "●", color: "var(--accent)" },
  pickup: { icon: "↓", color: "var(--duty-on)" },
  dropoff: { icon: "⚑", color: "var(--success)" },
  fuel: { icon: "⛽", color: "var(--warning)" },
  break: { icon: "⏸", color: "var(--duty-off)" },
  reset: { icon: "☽", color: "var(--duty-sb)" },
  restart: { icon: "↻", color: "var(--danger)" },
};
