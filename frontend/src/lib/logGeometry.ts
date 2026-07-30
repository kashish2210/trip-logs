import type { DutyStatus } from "../types";

/**
 * Geometry for the driver's daily log sheet.
 *
 * One coordinate system for the whole form, so the grid, the remark flags and
 * the totals column can never drift out of alignment. The x-axis is not fixed
 * to a full day: it maps whatever minute window is currently in view, which is
 * what makes the grid zoomable without any other component having to care.
 */

export const W = 1120;
export const H = 678;

export const GRID_X = 138;
export const GRID_W = 840;
export const GRID_Y = 214;
export const ROW_H = 34;
export const GRID_H = ROW_H * 4;
export const GRID_RIGHT = GRID_X + GRID_W;

export const TOTAL_X = GRID_RIGHT + 8;
export const TOTAL_W = 86;

export const REMARKS_Y = GRID_Y + GRID_H;
export const REMARKS_H = 150;
export const FOOTER_Y = REMARKS_Y + REMARKS_H + 14;

export const MINUTES_PER_DAY = 1440;
/** Zooming closer than this makes dragging jittery rather than precise. */
export const MIN_SPAN = 30;

export const ROWS: DutyStatus[] = ["OFF", "SB", "D", "ON"];

export interface ViewWindow {
  start: number;
  end: number;
}

export const FULL_DAY: ViewWindow = { start: 0, end: MINUTES_PER_DAY };

export interface Scale {
  view: ViewWindow;
  span: number;
  /** Minute of day to sheet x. */
  xAt(minute: number): number;
  /** Sheet x back to minute of day. */
  minuteAt(x: number): number;
  visible(minute: number): boolean;
}

export function makeScale(view: ViewWindow): Scale {
  const span = Math.max(1, view.end - view.start);
  return {
    view,
    span,
    xAt: (minute) => GRID_X + ((minute - view.start) / span) * GRID_W,
    minuteAt: (x) => view.start + ((x - GRID_X) / GRID_W) * span,
    visible: (minute) => minute >= view.start && minute <= view.end,
  };
}

export function rowIndex(status: DutyStatus): number {
  return ROWS.indexOf(status);
}

export function yAt(status: DutyStatus): number {
  return GRID_Y + rowIndex(status) * ROW_H + ROW_H / 2;
}

/** Which duty row a sheet y-coordinate falls in. */
export function statusAtY(y: number): DutyStatus {
  const index = Math.floor((y - GRID_Y) / ROW_H);
  return ROWS[Math.min(ROWS.length - 1, Math.max(0, index))];
}

/** Clamp a window to the day and to a sane minimum span. */
export function clampView(view: ViewWindow): ViewWindow {
  let span = Math.min(MINUTES_PER_DAY, Math.max(MIN_SPAN, view.end - view.start));
  let start = Math.max(0, Math.min(view.start, MINUTES_PER_DAY - span));
  return { start, end: start + span };
}

/**
 * Zoom by `factor` while holding `anchorMinute` still under the cursor.
 */
export function zoomAround(
  view: ViewWindow,
  factor: number,
  anchorMinute: number
): ViewWindow {
  const span = view.end - view.start;
  const nextSpan = Math.min(
    MINUTES_PER_DAY,
    Math.max(MIN_SPAN, span * factor)
  );
  const ratio = (anchorMinute - view.start) / span;
  return clampView({
    start: anchorMinute - ratio * nextSpan,
    end: anchorMinute - ratio * nextSpan + nextSpan,
  });
}

export function panBy(view: ViewWindow, minutes: number): ViewWindow {
  return clampView({ start: view.start + minutes, end: view.end + minutes });
}

export interface TickPlan {
  major: number;
  minor: number;
  /** Snap step offered while dragging at this zoom level. */
  snap: number;
  label: (minute: number) => string;
}

/**
 * Tick density follows the zoom level: the full-day view shows the printed
 * form's hours and 15-minute marks, and zooming in progressively reveals
 * finer marks so a change can be placed to the minute.
 */
export function tickPlan(span: number): TickPlan {
  if (span > 720) return { major: 60, minor: 15, snap: 15, label: hourLabel };
  if (span > 240) return { major: 60, minor: 15, snap: 15, label: hourLabel };
  if (span > 90) return { major: 30, minor: 5, snap: 5, label: clockLabel };
  if (span > 45) return { major: 15, minor: 5, snap: 5, label: clockLabel };
  return { major: 10, minor: 1, snap: 1, label: clockLabel };
}

function hourLabel(minute: number): string {
  const hour = Math.round(minute / 60);
  if (hour === 0 || hour === 24) return "Midnight";
  if (hour === 12) return "Noon";
  return String(hour > 12 ? hour - 12 : hour);
}

export function clockLabel(minute: number): string {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(
    m % 60
  ).padStart(2, "0")}`;
}

/** Tick positions of `step` minutes covering the visible window. */
export function ticksIn(view: ViewWindow, step: number): number[] {
  const first = Math.ceil(view.start / step) * step;
  const out: number[] = [];
  for (let m = first; m <= view.end + 1e-6; m += step) {
    out.push(Math.round(m));
  }
  return out;
}

/**
 * Convert a pointer event to sheet coordinates.
 *
 * The sheet is drawn in viewBox units and scaled to whatever width the layout
 * gives it, so client pixels have to be mapped back through that ratio or
 * every drag lands in the wrong place.
 */
export function toSheetPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H,
  };
}
