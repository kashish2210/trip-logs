import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import LogSheet from "./LogSheet";
import type { DutyStatus, LogDay, LogValidation } from "../types";
import { DUTY_META, decimalHours, shortDate } from "../lib/format";
import { validateLogs } from "../lib/api";
import {
  FULL_DAY,
  MINUTES_PER_DAY,
  type ViewWindow,
  clampView,
  clockLabel,
  panBy,
  tickPlan,
  zoomAround,
} from "../lib/logGeometry";
import {
  DUTY_ORDER,
  type DutyChange,
  type History,
  applyChanges,
  initHistory,
  normalise,
  pushHistory,
  redo,
  removeChange,
  replaceHistory,
  setStatus,
  toChanges,
  toSpans,
  totalsOf,
  undo,
  updateChange,
} from "../lib/logEdit";

/** Header fields a driver fills in by hand. */
const HEADER_FIELDS: [keyof LogDay, string, string][] = [
  ["driver_name", "Driver", "H. Alvarez"],
  ["co_driver", "Co-driver", "None"],
  ["carrier_name", "Carrier", "Northline Freight"],
  ["main_office", "Main office", "Green Bay, WI"],
  ["truck_number", "Truck / tractor", "T-4471"],
  ["trailer_number", "Trailer", "TR-9082"],
  ["shipper", "Shipper", "Don's Paper Company"],
  ["commodity", "Commodity", "Paper products"],
  ["load_id", "Load / Pro no.", "LD-77120"],
];

type ChangeMap = Record<string, DutyChange[]>;
type HeaderMap = Record<string, Partial<LogDay>>;

interface EditState {
  changes: ChangeMap;
  header: HeaderMap;
}

interface Props {
  days: LogDay[];
  cycleUsedStart: number;
  onExit(): void;
}

export default function LogEditor({ days, cycleUsedStart, onExit }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<ViewWindow>(FULL_DAY);
  const [selected, setSelected] = useState<number | null>(null);
  const [validation, setValidation] = useState<LogValidation | null>(null);
  const [checking, setChecking] = useState(false);

  const baseline = useMemo<EditState>(
    () => ({
      changes: Object.fromEntries(
        days.map((day) => [day.date, toChanges(day.entries)])
      ),
      header: {},
    }),
    [days]
  );

  const [history, setHistory] = useState<History<EditState>>(() =>
    initHistory(baseline)
  );
  const state = history.present;

  // A fresh plan replaces whatever was being edited.
  useEffect(() => {
    setHistory(initHistory(baseline));
    setSelected(null);
    setActiveIndex(0);
    setView(FULL_DAY);
  }, [baseline]);

  const day = days[Math.min(activeIndex, days.length - 1)];
  const changes = state.changes[day.date] ?? [];
  const spans = useMemo(() => toSpans(changes), [changes]);
  const totals = useMemo(() => totalsOf(changes), [changes]);

  const mergedDay = useMemo(
    () => ({ ...applyChanges(day, changes), ...(state.header[day.date] ?? {}) }),
    [day, changes, state.header]
  );

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(baseline),
    [state, baseline]
  );

  /* ---------------------------------------------------------------- edits */

  const commitChanges = useCallback(
    (next: DutyChange[]) => {
      setHistory((h) =>
        pushHistory(h, {
          ...h.present,
          changes: { ...h.present.changes, [day.date]: normalise(next) },
        })
      );
    },
    [day.date]
  );

  // Drags stream through here so the sheet follows the pointer without
  // filling the undo stack with one entry per frame.
  const draftChanges = useCallback(
    (next: DutyChange[]) => {
      setHistory((h) =>
        replaceHistory(h, {
          ...h.present,
          changes: { ...h.present.changes, [day.date]: next },
        })
      );
    },
    [day.date]
  );

  const patchHeader = useCallback(
    (patch: Partial<LogDay>) => {
      setHistory((h) =>
        pushHistory(h, {
          ...h.present,
          header: {
            ...h.present.header,
            [day.date]: { ...(h.present.header[day.date] ?? {}), ...patch },
          },
        })
      );
    },
    [day.date]
  );

  const reset = useCallback(() => {
    setHistory(initHistory(baseline));
    setSelected(null);
  }, [baseline]);

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((h) => (event.shiftKey ? redo(h) : undo(h)));
        return;
      }
      if (typing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        commitChanges(removeChange(changes, selected));
        setSelected(null);
      }
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, changes, commitChanges]);

  /* -------------------------------------------------------- validation */

  const signature = useMemo(
    () =>
      JSON.stringify(
        days.map((d) => toSpans(state.changes[d.date] ?? []).map((s) => [s.status, s.start, s.end]))
      ),
    [days, state.changes]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const payload = days.map((d) => ({
          date: d.date,
          entries: toSpans(state.changes[d.date] ?? []).map((span) => ({
            status: span.status,
            start: span.start,
            end: span.end,
            kind: span.kind,
            label: span.label,
          })),
        }));
        setValidation(
          await validateLogs(payload, cycleUsedStart, controller.signal)
        );
      } catch {
        if (!controller.signal.aborted) setValidation(null);
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `signature` collapses the edit state to just what the rules care about,
    // so retyping a remark doesn't trigger a re-check.
  }, [signature, cycleUsedStart, days, state.changes]);

  const dayReport = validation?.days.find((d) => d.date === day.date);
  const balanced = totals.OFF + totals.SB + totals.D + totals.ON === MINUTES_PER_DAY;
  const snapStep = tickPlan(view.end - view.start).snap;

  return (
    <div className="space-y-4">
      <Toolbar
        days={days}
        activeIndex={activeIndex}
        onDay={(i) => {
          setActiveIndex(i);
          setSelected(null);
          setView(FULL_DAY);
        }}
        view={view}
        onView={setView}
        snapStep={snapStep}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => setHistory(undo)}
        onRedo={() => setHistory(redo)}
        dirty={dirty}
        onReset={reset}
        onExit={onExit}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          <LogSheet
            day={mergedDay}
            edit={{
              changes,
              view,
              selected,
              onSelect: setSelected,
              onDraft: draftChanges,
              onCommit: commitChanges,
              onView: setView,
            }}
          />
          <p className="text-[0.76rem] text-subtle">
            Click a row to add a duty change · drag a point to move it, or up and
            down to change status · drag the grid to pan · scroll to zoom ·
            Delete removes the selected point · Ctrl+Z undoes.
          </p>
        </div>

        <div className="space-y-3">
          <StatusStrip totals={totals} balanced={balanced} />
          <ComplianceStrip
            validation={validation}
            checking={checking}
            report={dayReport}
          />
          <ChangeTable
            changes={changes}
            selected={selected}
            snapStep={snapStep}
            onSelect={setSelected}
            onUpdate={(index, patch) =>
              commitChanges(updateChange(changes, index, patch))
            }
            onStatus={(index, status) =>
              commitChanges(setStatus(changes, index, status))
            }
            onRemove={(index) => {
              commitChanges(removeChange(changes, index));
              setSelected(null);
            }}
            onFocusPoint={(minute) => {
              setView(clampView({ start: minute - 90, end: minute + 90 }));
            }}
          />
          <HeaderFields
            day={mergedDay}
            onChange={patchHeader}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  days,
  activeIndex,
  onDay,
  view,
  onView,
  snapStep,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dirty,
  onReset,
  onExit,
}: {
  days: LogDay[];
  activeIndex: number;
  onDay(index: number): void;
  view: ViewWindow;
  onView(view: ViewWindow): void;
  snapStep: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  dirty: boolean;
  onReset(): void;
  onExit(): void;
}) {
  const centre = (view.start + view.end) / 2;
  const zoomed = view.end - view.start < MINUTES_PER_DAY;
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {days.map((day, i) => (
          <button
            key={day.date}
            type="button"
            onClick={() => onDay(i)}
            className={`rounded-lg border px-2.5 py-1.5 text-[0.76rem] font-semibold transition-colors ${
              i === activeIndex
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-surface-2 text-muted hover:text-ink"
            }`}
          >
            Day {day.day_number}
            <span className="ml-1.5 font-normal text-subtle">
              {shortDate(day.date)}
            </span>
          </button>
        ))}
      </div>

      <span className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <div className="flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => onView(zoomAround(view, 1.5, centre))}>
          −
        </IconButton>
        <span className="num min-w-24 text-center text-[0.72rem] text-muted">
          {clockLabel(view.start)}–{clockLabel(view.end)}
        </span>
        <IconButton label="Zoom in" onClick={() => onView(zoomAround(view, 1 / 1.5, centre))}>
          +
        </IconButton>
        <IconButton label="Pan earlier" onClick={() => onView(panBy(view, -(view.end - view.start) / 3))}>
          ‹
        </IconButton>
        <IconButton label="Pan later" onClick={() => onView(panBy(view, (view.end - view.start) / 3))}>
          ›
        </IconButton>
        {zoomed && (
          <button type="button" onClick={() => onView(FULL_DAY)} className="chip hover:text-accent">
            Fit 24 h
          </button>
        )}
        <span className="chip" title="Dragging snaps to this increment">
          snap {snapStep}m
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
          ↶
        </IconButton>
        <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
          ↷
        </IconButton>
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty}
          className="btn btn-ghost !py-2 !text-[0.8rem]"
        >
          Revert
        </button>
        <button type="button" onClick={onExit} className="btn btn-primary !py-2 !text-[0.8rem]">
          Done editing
        </button>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-2 text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function StatusStrip({
  totals,
  balanced,
}: {
  totals: Record<DutyStatus, number>;
  balanced: boolean;
}) {
  const grand = totals.OFF + totals.SB + totals.D + totals.ON;
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Totals</p>
        <span
          className="num text-[0.78rem] font-bold"
          style={{ color: balanced ? "var(--success)" : "var(--danger)" }}
        >
          {decimalHours(grand)} h
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {DUTY_ORDER.map((status) => (
          <div key={status} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: DUTY_META[status].color }}
            />
            <span className="flex-1 truncate text-[0.7rem] text-subtle">
              {DUTY_META[status].line}. {DUTY_META[status].short}
            </span>
            <span className="num text-[0.76rem] font-semibold text-ink">
              {decimalHours(totals[status])}
            </span>
          </div>
        ))}
      </div>
      {!balanced && (
        <p className="mt-2 text-[0.72rem] text-danger">
          A sheet must total exactly 24.00 h.
        </p>
      )}
    </div>
  );
}

function ComplianceStrip({
  validation,
  checking,
  report,
}: {
  validation: LogValidation | null;
  checking: boolean;
  report: LogValidation["days"][number] | undefined;
}) {
  const issues = validation
    ? [
        ...validation.structural.map((s) => ({
          rule: "Sheet structure",
          detail: s.detail,
        })),
        ...validation.issues.map((i) => ({ rule: i.rule, detail: i.detail })),
      ]
    : [];
  const ok = validation?.compliant ?? true;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Hours of service</p>
        {checking ? (
          <span className="text-[0.72rem] text-subtle">checking…</span>
        ) : (
          <span
            className="text-[0.74rem] font-bold"
            style={{ color: ok ? "var(--success)" : "var(--danger)" }}
          >
            {ok ? "✓ Compliant" : `✕ ${issues.length}`}
          </span>
        )}
      </div>

      {report && (
        <p className="mt-1.5 text-[0.72rem] text-subtle">
          <span className="num text-muted">{report.driving_hours.toFixed(2)} h</span>{" "}
          driving ·{" "}
          <span className="num text-muted">{report.on_duty_hours.toFixed(2)} h</span>{" "}
          on duty ·{" "}
          <span className="num text-muted">
            {report.cycle_available_tomorrow.toFixed(1)} h
          </span>{" "}
          left on the cycle
        </p>
      )}

      <AnimatePresence initial={false}>
        {issues.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 space-y-1.5 overflow-hidden"
          >
            {issues.slice(0, 5).map((issue, i) => (
              <li
                key={i}
                className="rounded-md px-2 py-1.5 text-[0.72rem]"
                style={{
                  background: "color-mix(in oklab, var(--danger) 10%, transparent)",
                  color: "var(--danger)",
                }}
              >
                <span className="font-semibold">{issue.rule}</span> — {issue.detail}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChangeTable({
  changes,
  selected,
  snapStep,
  onSelect,
  onUpdate,
  onStatus,
  onRemove,
  onFocusPoint,
}: {
  changes: DutyChange[];
  selected: number | null;
  snapStep: number;
  onSelect(index: number | null): void;
  onUpdate(index: number, patch: Partial<DutyChange>): void;
  onStatus(index: number, status: DutyStatus): void;
  onRemove(index: number): void;
  onFocusPoint(minute: number): void;
}) {
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});

  useEffect(() => {
    if (selected === null) return;
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="card flex max-h-[30rem] flex-col overflow-hidden">
      <div className="border-b border-line px-3 py-2">
        <p className="eyebrow">Duty changes &amp; remarks</p>
        <p className="mt-0.5 text-[0.72rem] text-subtle">
          {changes.length} entries · city and state required at each change
        </p>
      </div>

      <ul className="flex-1 overflow-auto p-2">
        {changes.map((change, index) => {
          const active = selected === index;
          const anchored = index === 0;
          return (
            <li
              key={`${index}-${change.minute}`}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              className={`mb-1.5 rounded-lg border p-2 transition-colors ${
                active ? "border-accent bg-accent-soft/40" : "border-line bg-surface-2"
              }`}
              onClick={() => onSelect(index)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={snapStep * 60}
                  value={clockLabel(change.minute)}
                  disabled={anchored}
                  title={anchored ? "The first entry anchors midnight" : "Start time"}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (Number.isFinite(h) && Number.isFinite(m)) {
                      onUpdate(index, { minute: h * 60 + m });
                    }
                  }}
                  className="field num !w-24 !px-2 !py-1 !text-[0.76rem] disabled:opacity-55"
                />
                <select
                  value={change.status}
                  onChange={(e) => onStatus(index, e.target.value as DutyStatus)}
                  className="field !flex-1 !px-2 !py-1 !text-[0.76rem]"
                  style={{ color: DUTY_META[change.status].color }}
                >
                  {DUTY_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {DUTY_META[status].line}. {DUTY_META[status].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Zoom to this point"
                  aria-label="Zoom to this point"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocusPoint(change.minute);
                  }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-muted hover:text-accent"
                >
                  ⌖
                </button>
                <button
                  type="button"
                  title={anchored ? "The midnight entry can't be removed" : "Remove"}
                  aria-label="Remove duty change"
                  disabled={anchored}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(index);
                  }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-muted hover:text-danger disabled:opacity-30"
                >
                  ✕
                </button>
              </div>

              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <input
                  value={change.location}
                  placeholder="City, ST"
                  onChange={(e) => onUpdate(index, { location: e.target.value })}
                  className="field !px-2 !py-1 !text-[0.76rem]"
                />
                <input
                  value={change.label}
                  placeholder="Remark"
                  onChange={(e) => onUpdate(index, { label: e.target.value })}
                  className="field !px-2 !py-1 !text-[0.76rem]"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeaderFields({
  day,
  onChange,
}: {
  day: LogDay;
  onChange(patch: Partial<LogDay>): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span>
          <span className="eyebrow block">Sheet header</span>
          <span className="text-[0.72rem] text-subtle">
            carrier, driver, vehicle, shipping, mileage
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-subtle">
          ▾
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-2 border-t border-line p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label !mb-1 !text-[0.62rem]">Miles driving</span>
                  <input
                    type="number"
                    min={0}
                    value={day.miles_driving}
                    onChange={(e) =>
                      onChange({ miles_driving: Number(e.target.value) || 0 })
                    }
                    className="field num !px-2 !py-1 !text-[0.78rem]"
                  />
                </label>
                <label className="block">
                  <span className="label !mb-1 !text-[0.62rem]">Total mileage</span>
                  <input
                    type="number"
                    min={0}
                    value={day.total_mileage}
                    onChange={(e) =>
                      onChange({ total_mileage: Number(e.target.value) || 0 })
                    }
                    className="field num !px-2 !py-1 !text-[0.78rem]"
                  />
                </label>
              </div>
              {HEADER_FIELDS.map(([key, label, placeholder]) => (
                <label key={key} className="block">
                  <span className="label !mb-1 !text-[0.62rem]">{label}</span>
                  <input
                    value={String(day[key] ?? "")}
                    placeholder={placeholder}
                    onChange={(e) => onChange({ [key]: e.target.value } as Partial<LogDay>)}
                    className="field !px-2 !py-1 !text-[0.78rem]"
                  />
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
