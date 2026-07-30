import { useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useInView } from "framer-motion";
import type { DutyStatus, LogDay } from "../types";
import {
  DUTY_META,
  dateParts,
  decimalHours,
  longDate,
  miles as fmtMiles,
} from "../lib/format";
import {
  FOOTER_Y,
  GRID_H,
  GRID_RIGHT,
  GRID_W,
  GRID_X,
  GRID_Y,
  H,
  MINUTES_PER_DAY,
  REMARKS_H,
  REMARKS_Y,
  ROWS,
  ROW_H,
  TOTAL_W,
  TOTAL_X,
  W,
  type Scale,
  type ViewWindow,
  clockLabel,
  makeScale,
  panBy,
  statusAtY,
  tickPlan,
  ticksIn,
  toSheetPoint,
  zoomAround,
} from "../lib/logGeometry";
import {
  type DutyChange,
  type DutySpan,
  addChange,
  moveChange,
  normalise,
  snap,
  toChanges,
  toSpans,
  totalsOf,
  tracePath,
} from "../lib/logEdit";

export interface EditHandlers {
  changes: DutyChange[];
  view: ViewWindow;
  selected: number | null;
  onSelect(index: number | null): void;
  /** Live updates during a drag - not recorded in history. */
  onDraft(changes: DutyChange[]): void;
  /** End of a gesture - recorded in history. */
  onCommit(changes: DutyChange[]): void;
  onView(view: ViewWindow): void;
}

interface Props {
  day: LogDay;
  /** Staggers sheets so a multi-day trip draws one after another. */
  order?: number;
  replayKey?: number;
  edit?: EditHandlers;
}

/** Movement past this many pixels turns a click into a drag. */
const DRAG_THRESHOLD = 3;

export default function LogSheet({ day, order = 0, replayKey = 0, edit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const penRef = useRef<SVGGElement>(null);
  // `once` matters: a sheet that un-draws itself when it scrolls out of view
  // would also export as an empty grid.
  const inView = useInView(hostRef, { once: true, amount: 0.2 });
  const [hover, setHover] = useState<{ minute: number; x: number } | null>(null);

  const editing = Boolean(edit);
  const scale = useMemo(
    () => makeScale(edit?.view ?? { start: 0, end: MINUTES_PER_DAY }),
    [edit?.view]
  );
  const plan = useMemo(() => tickPlan(scale.span), [scale.span]);

  const changes = useMemo(
    () => edit?.changes ?? toChanges(day.entries),
    [edit?.changes, day.entries]
  );
  const spans = useMemo(() => toSpans(changes), [changes]);
  const totals = useMemo(() => totalsOf(changes), [changes]);
  const path = useMemo(
    () => tracePath(spans, scale.xAt, yFor),
    [spans, scale]
  );

  const drawDuration = Math.min(4.2, 1.5 + spans.length * 0.09);
  const delay = 0.25 + order * 0.18;
  const animateDraw = !editing;

  // Drive the travelling pen from the same clock as the stroke reveal so the
  // nib always sits exactly at the end of the drawn line.
  useEffect(() => {
    if (!animateDraw) return;
    const pathEl = pathRef.current;
    const pen = penRef.current;
    if (!pathEl || !pen || !inView) return;

    const total = pathEl.getTotalLength();
    if (!Number.isFinite(total) || total <= 0) return;

    pen.style.opacity = "0";
    const controls = animate(0, 1, {
      duration: drawDuration,
      delay,
      ease: "easeInOut",
      onPlay: () => {
        pen.style.opacity = "1";
      },
      onUpdate: (value) => {
        const point = pathEl.getPointAtLength(value * total);
        pen.setAttribute("transform", `translate(${point.x} ${point.y})`);
      },
      onComplete: () => {
        pen.style.opacity = "0";
      },
    });
    return () => controls.stop();
  }, [path, drawDuration, delay, inView, replayKey, animateDraw]);

  const grandTotal = totals.OFF + totals.SB + totals.D + totals.ON;
  const date = dateParts(day.date);
  const clipId = `grid-clip-${day.day_index}`;

  const pointer = usePointerTools(svgRef, scale, edit, setHover);

  return (
    <div ref={hostRef} className="print-sheet card overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto select-none"
        role="img"
        aria-label={`Driver's daily log for ${longDate(day.date)}`}
        style={{
          fontFamily: "var(--font-sans)",
          background: "var(--log-paper)",
          touchAction: editing ? "none" : undefined,
          cursor: pointer.cursor,
        }}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerLeave={pointer.onPointerLeave}
        onWheel={pointer.onWheel}
      >
        <defs>
          <filter
            id={`glow-${day.day_index}`}
            x="-40%"
            y="-400%"
            width="180%"
            height="900%"
          >
            <feGaussianBlur stdDeviation="3.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={clipId}>
            <rect x={GRID_X} y={GRID_Y - 2} width={GRID_W} height={GRID_H + 4} />
          </clipPath>
        </defs>

        <Header day={day} date={date} />
        <HourAxis scale={scale} plan={plan} />
        <GridBody scale={scale} plan={plan} />
        <TotalsColumn totals={totals} grandTotal={grandTotal} />

        <g clipPath={`url(#${clipId})`}>
          <motion.path
            ref={pathRef}
            d={path}
            fill="none"
            stroke="var(--log-accent)"
            strokeWidth={2.6}
            strokeLinecap="square"
            strokeLinejoin="miter"
            filter={`url(#glow-${day.day_index})`}
            initial={animateDraw ? { pathLength: 0 } : false}
            animate={
              animateDraw ? (inView ? { pathLength: 1 } : { pathLength: 0 }) : undefined
            }
            transition={{ duration: drawDuration, delay, ease: "easeInOut" }}
            key={animateDraw ? `${day.date}-${replayKey}` : "static"}
          />

          {animateDraw && (
            <g ref={penRef} style={{ opacity: 0 }}>
              <circle r={6.5} fill="var(--log-accent)" opacity={0.22} />
              <circle r={3} fill="var(--log-accent)" />
            </g>
          )}

          {editing ? (
            <EditHandles
              spans={spans}
              scale={scale}
              selected={edit!.selected}
              dragging={pointer.draggingIndex}
            />
          ) : (
            <StatusDots
              spans={spans}
              scale={scale}
              inView={inView}
              delay={delay}
              duration={drawDuration}
            />
          )}
        </g>

        {editing && hover && (
          <HoverReadout minute={hover.minute} x={hover.x} />
        )}

        <Remarks
          spans={spans}
          scale={scale}
          inView={inView || editing}
          delay={delay}
          duration={drawDuration}
          animateIn={animateDraw}
        />
        <Footer day={day} grandTotal={grandTotal} totals={totals} />
      </svg>
    </div>
  );
}

const yFor = (status: DutyStatus) =>
  GRID_Y + ROWS.indexOf(status) * ROW_H + ROW_H / 2;

/* --------------------------------------------------------------------------
   Pointer handling: drag points, click to add, drag background to pan, wheel
   to zoom around the cursor.
   -------------------------------------------------------------------------- */

type Gesture =
  | { type: "idle" }
  | { type: "point"; index: number; moved: boolean }
  | { type: "pan"; originMinute: number; moved: boolean; startY: number; startX: number }
  | { type: "press"; x: number; y: number };

function usePointerTools(
  svgRef: React.RefObject<SVGSVGElement | null>,
  scale: Scale,
  edit: EditHandlers | undefined,
  setHover: (h: { minute: number; x: number } | null) => void
) {
  const gesture = useRef<Gesture>({ type: "idle" });
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  if (!edit) {
    return {
      cursor: undefined,
      draggingIndex: null,
      onPointerDown: undefined,
      onPointerMove: undefined,
      onPointerUp: undefined,
      onPointerLeave: undefined,
      onWheel: undefined,
    };
  }

  const insideGrid = (p: { x: number; y: number }) =>
    p.x >= GRID_X && p.x <= GRID_RIGHT && p.y >= GRID_Y && p.y <= GRID_Y + GRID_H;

  /** Nearest change handle to a point, within a grab radius. */
  const hitHandle = (p: { x: number; y: number }): number | null => {
    const spans = toSpans(edit.changes);
    let best: number | null = null;
    let bestDistance = 11;
    spans.forEach((span, i) => {
      if (i === 0) return; // midnight anchor is fixed
      const dx = scale.xAt(span.start) - p.x;
      const dy = yFor(span.status) - p.y;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const p = toSheetPoint(svg, event.clientX, event.clientY);
    if (!insideGrid(p)) return;

    // Capture keeps a drag alive if the pointer leaves the sheet. It throws
    // for a pointer id the browser doesn't know about, which is never fatal.
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* continue without capture */
    }
    const index = hitHandle(p);
    if (index !== null) {
      gesture.current = { type: "point", index, moved: false };
      setDraggingIndex(index);
      edit.onSelect(index);
      setCursor("grabbing");
    } else {
      gesture.current = { type: "press", x: p.x, y: p.y };
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const p = toSheetPoint(svg, event.clientX, event.clientY);
    const current = gesture.current;

    if (current.type === "idle" || current.type === "press") {
      if (insideGrid(p)) {
        setHover({ minute: scale.minuteAt(p.x), x: p.x });
        setCursor(hitHandle(p) !== null ? "grab" : "crosshair");
      } else {
        setHover(null);
        setCursor(undefined);
      }
    }

    // A press that travels far enough becomes a pan.
    if (current.type === "press") {
      if (Math.hypot(p.x - current.x, p.y - current.y) > DRAG_THRESHOLD) {
        gesture.current = {
          type: "pan",
          originMinute: scale.minuteAt(current.x),
          moved: true,
          startX: current.x,
          startY: current.y,
        };
        setCursor("grabbing");
      }
      return;
    }

    if (current.type === "pan") {
      const deltaMinutes = scale.minuteAt(p.x) - current.originMinute;
      edit.onView(panBy(scale.view, -deltaMinutes));
      return;
    }

    if (current.type === "point") {
      const step = tickPlan(scale.span).snap;
      const minute = snap(scale.minuteAt(p.x), step);
      const status = statusAtY(p.y);
      let next = moveChange(edit.changes, current.index, minute);
      if (next[current.index] && next[current.index].status !== status) {
        next = [...next];
        next[current.index] = { ...next[current.index], status };
      }
      gesture.current = { ...current, moved: true };
      edit.onDraft(next);
      setHover({ minute, x: scale.xAt(minute) });
    }
  };

  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const current = gesture.current;
    gesture.current = { type: "idle" };
    setDraggingIndex(null);
    setCursor(undefined);
    try {
      if (svg?.hasPointerCapture(event.pointerId)) {
        svg.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* nothing to release */
    }

    if (current.type === "point") {
      // Normalising here rather than mid-drag: a point dragged across its
      // neighbour would otherwise be merged away under the pointer.
      edit.onCommit(normalise(edit.changes));
      return;
    }

    if (current.type === "press" && svg) {
      const p = toSheetPoint(svg, event.clientX, event.clientY);
      if (!insideGrid(p)) return;
      const step = tickPlan(scale.span).snap;
      const minute = snap(scale.minuteAt(p.x), step);
      if (minute <= 0 || minute >= MINUTES_PER_DAY) return;
      const status = statusAtY(p.y);
      const next = addChange(edit.changes, minute, status);
      edit.onCommit(next);
      const index = next.findIndex((c) => c.minute === minute);
      edit.onSelect(index >= 0 ? index : null);
    }
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const p = toSheetPoint(svg, event.clientX, event.clientY);
    if (!insideGrid(p)) return;
    // The sheet only claims the wheel over the grid, so the page still scrolls
    // normally everywhere else.
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    edit.onView(zoomAround(scale.view, factor, scale.minuteAt(p.x)));
  };

  return {
    cursor,
    draggingIndex,
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerLeave: (event: React.PointerEvent<SVGSVGElement>) => {
      setHover(null);
      if (gesture.current.type !== "idle") finish(event);
    },
    onWheel,
  };
}

/* -------------------------------------------------------------------------- */

function EditHandles({
  spans,
  scale,
  selected,
  dragging,
}: {
  spans: DutySpan[];
  scale: Scale;
  selected: number | null;
  dragging: number | null;
}) {
  return (
    <g>
      {spans.map((span, i) => {
        if (i === 0) return null;
        if (!scale.visible(span.start)) return null;
        const x = scale.xAt(span.start);
        const y = yFor(span.status);
        const active = selected === i || dragging === i;
        return (
          <g key={`${i}-${span.start}`}>
            {active && (
              <line
                x1={x}
                y1={GRID_Y}
                x2={x}
                y2={GRID_Y + GRID_H}
                stroke="var(--log-accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={active ? 6 : 4.4}
              fill="var(--log-paper)"
              stroke="var(--log-accent)"
              strokeWidth={active ? 2.6 : 2}
            />
            {active && <circle cx={x} cy={y} r={2} fill="var(--log-accent)" />}
          </g>
        );
      })}
    </g>
  );
}

function HoverReadout({ minute, x }: { minute: number; x: number }) {
  const clamped = Math.max(GRID_X + 26, Math.min(GRID_RIGHT - 26, x));
  return (
    <g pointerEvents="none">
      <rect
        x={clamped - 26}
        y={GRID_Y - 40}
        width={52}
        height={18}
        rx={4}
        fill="var(--log-accent)"
        opacity={0.92}
      />
      <text
        x={clamped}
        y={GRID_Y - 27}
        fontSize={10.5}
        fontWeight={700}
        textAnchor="middle"
        fill="var(--log-paper)"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {clockLabel(minute)}
      </text>
    </g>
  );
}

function Header({
  day,
  date,
}: {
  day: LogDay;
  date: { month: string; day: string; year: string };
}) {
  return (
    <g>
      <text x={28} y={44} fontSize={23} fontWeight={800} fill="var(--log-ink)">
        Driver&apos;s Daily Log
      </text>
      <text x={28} y={62} fontSize={10.5} fill="var(--log-rule)">
        One calendar day — 24 hours · U.S. Department of Transportation
      </text>

      <g transform="translate(324, 24)">
        {[date.month, date.day, date.year].map((value, i) => (
          <g key={i} transform={`translate(${i * 78}, 0)`}>
            <line
              x1={0}
              y1={24}
              x2={62}
              y2={24}
              stroke="var(--log-rule)"
              strokeWidth={1.2}
            />
            <text
              x={31}
              y={20}
              fontSize={16}
              fontWeight={700}
              textAnchor="middle"
              fill="var(--log-ink)"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {value}
            </text>
            <text
              x={31}
              y={36}
              fontSize={8.5}
              textAnchor="middle"
              fill="var(--log-rule)"
            >
              {["MONTH", "DAY", "YEAR"][i]}
            </text>
          </g>
        ))}
      </g>

      <text x={W - 28} y={30} fontSize={9} textAnchor="end" fill="var(--log-rule)">
        ORIGINAL — file at home terminal
      </text>
      <text x={W - 28} y={44} fontSize={9} textAnchor="end" fill="var(--log-rule)">
        DUPLICATE — driver retains for 8 days
      </text>
      <text
        x={W - 28}
        y={62}
        fontSize={10}
        textAnchor="end"
        fontWeight={700}
        fill="var(--log-accent)"
      >
        DAY {day.day_number}
      </text>

      <Box x={28} y={84} w={252} h={44} caption="FROM" value={firstLocation(day)} />
      <Box x={288} y={84} w={252} h={44} caption="TO" value={lastLocation(day)} />
      <Box
        x={548}
        y={84}
        w={168}
        h={44}
        caption="TOTAL MILES DRIVING TODAY"
        value={fmtMiles(day.miles_driving)}
        mono
      />
      <Box
        x={724}
        y={84}
        w={168}
        h={44}
        caption="TOTAL MILEAGE TODAY"
        value={fmtMiles(day.total_mileage)}
        mono
      />
      <Box
        x={900}
        y={84}
        w={192}
        h={44}
        caption="NAME OF CARRIER"
        value={day.carrier_name || "—"}
      />

      <Box
        x={28}
        y={136}
        w={252}
        h={44}
        caption="TRUCK / TRACTOR & TRAILER NO."
        value={vehicleLabel(day)}
      />
      <Box
        x={288}
        y={136}
        w={252}
        h={44}
        caption="MAIN OFFICE ADDRESS"
        value={day.main_office || "—"}
      />
      <Box
        x={548}
        y={136}
        w={344}
        h={44}
        caption="DRIVER'S SIGNATURE — I certify these entries are true and correct"
        value={day.driver_name || "—"}
        script
      />
      <Box
        x={900}
        y={136}
        w={192}
        h={44}
        caption="NAME OF CO-DRIVER"
        value={day.co_driver || "None"}
      />
    </g>
  );
}

function Box({
  x,
  y,
  w,
  h,
  caption,
  value,
  mono,
  script,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  caption: string;
  value: string;
  mono?: boolean;
  script?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={5}
        fill="var(--log-panel)"
        stroke="var(--log-grid)"
        strokeWidth={1}
      />
      <text
        x={x + 9}
        y={y + 14}
        fontSize={7.6}
        fill="var(--log-rule)"
        letterSpacing={0.5}
      >
        {caption}
      </text>
      <text
        x={x + 9}
        y={y + 33}
        fontSize={script ? 14 : 12.5}
        fontWeight={script ? 500 : 650}
        fill="var(--log-ink)"
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontStyle: script ? "italic" : "normal",
        }}
      >
        {truncate(value, mono ? 14 : w > 260 ? 44 : 30)}
      </text>
    </g>
  );
}

function HourAxis({ scale, plan }: { scale: Scale; plan: ReturnType<typeof tickPlan> }) {
  const majors = ticksIn(scale.view, plan.major);
  return (
    <g>
      {majors.map((minute) => {
        const x = scale.xAt(minute);
        const label = plan.label(minute);
        const stacked = label === "Midnight";
        return (
          <text
            key={minute}
            x={x}
            y={stacked ? GRID_Y - 16 : GRID_Y - 8}
            fontSize={stacked ? 7.6 : 9.5}
            fontWeight={600}
            textAnchor="middle"
            fill="var(--log-rule)"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {stacked ? (
              <>
                <tspan x={x} dy="0">
                  Mid-
                </tspan>
                <tspan x={x} dy="8.5">
                  night
                </tspan>
              </>
            ) : (
              label
            )}
          </text>
        );
      })}
      <text
        x={TOTAL_X + TOTAL_W / 2}
        y={GRID_Y - 8}
        fontSize={8.4}
        fontWeight={700}
        textAnchor="middle"
        fill="var(--log-rule)"
      >
        TOTAL HOURS
      </text>
    </g>
  );
}

function GridBody({ scale, plan }: { scale: Scale; plan: ReturnType<typeof tickPlan> }) {
  const majors = ticksIn(scale.view, plan.major);
  const minors = ticksIn(scale.view, plan.minor);
  return (
    <g>
      <rect
        x={GRID_X}
        y={GRID_Y}
        width={GRID_W}
        height={GRID_H}
        fill="var(--log-panel)"
        stroke="var(--log-rule)"
        strokeWidth={1.4}
      />

      {ROWS.map((status, i) => {
        const y = GRID_Y + i * ROW_H;
        const meta = DUTY_META[status];
        return (
          <g key={status}>
            {i % 2 === 1 && (
              <rect
                x={GRID_X}
                y={y}
                width={GRID_W}
                height={ROW_H}
                fill="var(--log-grid)"
                opacity={0.32}
              />
            )}
            {i > 0 && (
              <line
                x1={GRID_X}
                y1={y}
                x2={GRID_RIGHT}
                y2={y}
                stroke="var(--log-rule)"
                strokeWidth={1}
              />
            )}
            <text
              x={GRID_X - 10}
              y={y + 15}
              fontSize={9.6}
              fontWeight={700}
              textAnchor="end"
              fill="var(--log-ink)"
            >
              {meta.line}. {status === "ON" ? "On Duty" : meta.label}
            </text>
            {status === "ON" && (
              <text
                x={GRID_X - 10}
                y={y + 26}
                fontSize={8}
                textAnchor="end"
                fill="var(--log-rule)"
              >
                (not driving)
              </text>
            )}
            <circle cx={GRID_X - 122} cy={y + 12} r={3.4} fill={meta.color} />
          </g>
        );
      })}

      {minors.map((minute) => {
        const x = scale.xAt(minute);
        // The half-hour mark is drawn taller, as on the printed form.
        const tall = minute % (plan.minor * 2) === 0;
        return ROWS.map((_, row) => {
          const top = GRID_Y + row * ROW_H;
          return (
            <line
              key={`t${minute}-${row}`}
              x1={x}
              y1={top}
              x2={x}
              y2={top + (tall ? 9 : 5)}
              stroke="var(--log-rule)"
              strokeWidth={0.7}
              opacity={0.5}
            />
          );
        });
      })}

      {majors.map((minute) => {
        const x = scale.xAt(minute);
        const heavy = minute % 360 === 0;
        return (
          <line
            key={`h${minute}`}
            x1={x}
            y1={GRID_Y}
            x2={x}
            y2={GRID_Y + GRID_H}
            stroke="var(--log-rule)"
            strokeWidth={heavy ? 1.3 : 0.8}
            opacity={heavy ? 0.95 : 0.55}
          />
        );
      })}
    </g>
  );
}

function TotalsColumn({
  totals,
  grandTotal,
}: {
  totals: Record<DutyStatus, number>;
  grandTotal: number;
}) {
  const balanced = grandTotal === MINUTES_PER_DAY;
  return (
    <g>
      <rect
        x={TOTAL_X}
        y={GRID_Y}
        width={TOTAL_W}
        height={GRID_H}
        fill="var(--log-panel)"
        stroke="var(--log-rule)"
        strokeWidth={1.4}
      />
      {ROWS.map((status, i) => {
        const y = GRID_Y + i * ROW_H;
        const minutes = totals[status] ?? 0;
        return (
          <g key={status}>
            {i > 0 && (
              <line
                x1={TOTAL_X}
                y1={y}
                x2={TOTAL_X + TOTAL_W}
                y2={y}
                stroke="var(--log-rule)"
                strokeWidth={1}
              />
            )}
            <text
              x={TOTAL_X + TOTAL_W / 2}
              y={y + ROW_H / 2 + 5}
              fontSize={14}
              fontWeight={700}
              textAnchor="middle"
              fill={minutes > 0 ? "var(--log-ink)" : "var(--log-rule)"}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {decimalHours(minutes)}
            </text>
          </g>
        );
      })}
      <rect
        x={TOTAL_X}
        y={GRID_Y + GRID_H + 4}
        width={TOTAL_W}
        height={24}
        rx={4}
        fill={balanced ? "var(--log-accent)" : "var(--danger)"}
        opacity={0.14}
      />
      <text
        x={TOTAL_X + TOTAL_W / 2}
        y={GRID_Y + GRID_H + 20}
        fontSize={12}
        fontWeight={800}
        textAnchor="middle"
        fill={balanced ? "var(--log-accent)" : "var(--danger)"}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        = {decimalHours(grandTotal)}
      </text>
    </g>
  );
}

/** A small dot at each duty change, appearing as the pen reaches it. */
function StatusDots({
  spans,
  scale,
  inView,
  delay,
  duration,
}: {
  spans: DutySpan[];
  scale: Scale;
  inView: boolean;
  delay: number;
  duration: number;
}) {
  return (
    <g>
      {spans.slice(1).map((span, i) => {
        const cx = scale.xAt(span.start);
        const cy = yFor(span.status);
        return (
          <motion.circle
            key={`${span.start}-${i}`}
            cx={cx}
            cy={cy}
            r={3.1}
            fill="var(--log-paper)"
            stroke="var(--log-accent)"
            strokeWidth={1.8}
            initial={{ scale: 0, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
            transition={{
              delay: delay + (span.start / MINUTES_PER_DAY) * duration * 0.96,
              duration: 0.28,
              ease: "backOut",
            }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
        );
      })}
    </g>
  );
}

interface PlacedRemark {
  minute: number;
  /** Empty when the flag is drawn but carries no label. */
  text: string;
  tier: number;
}

/**
 * Lays out the Remarks column so the labels stay readable.
 *
 * Sec. 395.8(h)(6) wants the city and state at every change of duty status,
 * but a shift produces several changes at the same place (arrive, work,
 * post-trip, rest). Writing the name four times just makes a smear, so a run
 * of changes at one location is labelled once and the rest keep only their
 * tick. Whatever labels remain are then dealt into tiers so that two that are
 * still close together sit at different depths instead of on top of each other.
 */
function layoutRemarks(spans: DutySpan[], scale: Scale): PlacedRemark[] {
  const MIN_GAP = 44; // horizontal room one rotated label needs, in view units
  const TIERS = 3;

  const placed: PlacedRemark[] = [];
  let lastLocation = "";
  const tierLastX = new Array<number>(TIERS).fill(-Infinity);

  spans.forEach((span, i) => {
    if (i === 0 && span.kind === "offduty") return;
    if (!scale.visible(span.start)) return;
    const x = scale.xAt(span.start);
    const sameSpot = span.location === lastLocation;
    lastLocation = span.location;

    if (sameSpot || !span.location) {
      placed.push({ minute: span.start, text: "", tier: 0 });
      return;
    }

    // First tier with enough clearance; otherwise the roomiest one.
    let tier = tierLastX.findIndex((last) => x - last >= MIN_GAP);
    if (tier === -1) tier = tierLastX.indexOf(Math.min(...tierLastX));
    tierLastX[tier] = x;
    placed.push({
      minute: span.start,
      text: `${clockLabel(span.start)} ${truncate(span.location, 20)}`,
      tier,
    });
  });
  return placed;
}

function Remarks({
  spans,
  scale,
  inView,
  delay,
  duration,
  animateIn,
}: {
  spans: DutySpan[];
  scale: Scale;
  inView: boolean;
  delay: number;
  duration: number;
  animateIn: boolean;
}) {
  return (
    <g>
      <text x={28} y={REMARKS_Y + 18} fontSize={10} fontWeight={800} fill="var(--log-ink)">
        REMARKS
      </text>
      <text x={28} y={REMARKS_Y + 32} fontSize={7.4} fill="var(--log-rule)">
        Location of each
      </text>
      <text x={28} y={REMARKS_Y + 42} fontSize={7.4} fill="var(--log-rule)">
        duty-status change
      </text>
      <line
        x1={GRID_X}
        y1={REMARKS_Y}
        x2={GRID_RIGHT}
        y2={REMARKS_Y}
        stroke="var(--log-rule)"
        strokeWidth={1.4}
      />
      <line
        x1={GRID_X}
        y1={REMARKS_Y + REMARKS_H}
        x2={GRID_RIGHT}
        y2={REMARKS_Y + REMARKS_H}
        stroke="var(--log-rule)"
        strokeWidth={1}
        opacity={0.7}
      />

      {layoutRemarks(spans, scale).map((remark, i) => {
        const x = scale.xAt(remark.minute);
        const at = delay + (remark.minute / MINUTES_PER_DAY) * duration * 0.96;
        const drop = 8 + remark.tier * 13;
        return (
          <motion.g
            key={`${remark.minute}-${i}`}
            initial={animateIn ? { opacity: 0 } : false}
            animate={animateIn ? (inView ? { opacity: 1 } : { opacity: 0 }) : undefined}
            transition={{ delay: at + 0.1, duration: 0.32 }}
          >
            {/* The 45-degree flag drivers draw down from the grid. */}
            <path
              d={`M ${x} ${REMARKS_Y} L ${x} ${REMARKS_Y + drop} ${
                remark.text ? `L ${x + 7} ${REMARKS_Y + drop + 7}` : ""
              }`}
              fill="none"
              stroke="var(--log-accent)"
              strokeWidth={1.2}
              opacity={remark.text ? 0.9 : 0.45}
            />
            {remark.text && (
              <text
                transform={`translate(${x + 9}, ${REMARKS_Y + drop + 11}) rotate(60)`}
                fontSize={8.4}
                fontWeight={650}
                fill="var(--log-ink)"
              >
                {remark.text}
              </text>
            )}
          </motion.g>
        );
      })}
    </g>
  );
}

function Footer({
  day,
  grandTotal,
  totals,
}: {
  day: LogDay;
  grandTotal: number;
  totals: Record<DutyStatus, number>;
}) {
  const shipping = [day.load_id && `Load ${day.load_id}`, day.shipper, day.commodity]
    .filter(Boolean)
    .join(" · ");
  const onDutyToday = (totals.D + totals.ON) / 60;
  const balanced = grandTotal === MINUTES_PER_DAY;

  return (
    <g>
      <rect
        x={28}
        y={FOOTER_Y}
        width={520}
        height={92}
        rx={6}
        fill="var(--log-panel)"
        stroke="var(--log-grid)"
      />
      <text x={42} y={FOOTER_Y + 18} fontSize={8} fontWeight={800} fill="var(--log-rule)">
        SHIPPING DOCUMENTS
      </text>
      <text x={42} y={FOOTER_Y + 38} fontSize={11} fontWeight={600} fill="var(--log-ink)">
        {truncate(shipping || "No shipping documents recorded", 62)}
      </text>
      <text x={42} y={FOOTER_Y + 58} fontSize={8} fill="var(--log-rule)">
        Pro or Shipping No. / Name of shipper and commodity
      </text>
      <text x={42} y={FOOTER_Y + 78} fontSize={8.5} fill="var(--log-rule)">
        Enter name of place you reported and were released from work.
      </text>

      <rect
        x={564}
        y={FOOTER_Y}
        width={W - 564 - 28}
        height={92}
        rx={6}
        fill="var(--log-panel)"
        stroke="var(--log-grid)"
      />
      <text x={578} y={FOOTER_Y + 18} fontSize={8} fontWeight={800} fill="var(--log-rule)">
        RECAP — 70 HOUR / 8 DAY DRIVERS
      </text>
      {[
        {
          label: "On-duty hours today\n(lines 3 & 4)",
          value: onDutyToday.toFixed(2),
        },
        { label: "Total on duty\nlast 8 days", value: day.cycle_used_end.toFixed(2) },
        {
          label: "Hours available\ntomorrow",
          value: day.cycle_available_tomorrow.toFixed(2),
        },
        { label: "Grid total\n(must be 24.00)", value: decimalHours(grandTotal) },
      ].map((cell, i) => {
        const x = 578 + i * 124;
        const [l1, l2] = cell.label.split("\n");
        return (
          <g key={i}>
            <text x={x} y={FOOTER_Y + 38} fontSize={7.6} fill="var(--log-rule)">
              {l1}
            </text>
            <text x={x} y={FOOTER_Y + 47} fontSize={7.6} fill="var(--log-rule)">
              {l2}
            </text>
            <text
              x={x}
              y={FOOTER_Y + 74}
              fontSize={19}
              fontWeight={800}
              fill={
                i === 3
                  ? balanced
                    ? "var(--log-accent)"
                    : "var(--danger)"
                  : "var(--log-ink)"
              }
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {cell.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* -------------------------------------------------------------------------- */

function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function firstLocation(day: LogDay): string {
  return day.entries.find((e) => e.location)?.location ?? "—";
}

function lastLocation(day: LogDay): string {
  for (let i = day.entries.length - 1; i >= 0; i -= 1) {
    if (day.entries[i].location) return day.entries[i].location;
  }
  return "—";
}

function vehicleLabel(day: LogDay): string {
  const parts = [day.truck_number, day.trailer_number].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}
