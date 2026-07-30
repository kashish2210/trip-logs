import { useRef, useState } from "react";
import { motion } from "framer-motion";
import LogSheet from "./LogSheet";
import LogEditor from "./LogEditor";
import type { TripPlan } from "../types";
import { DUTY_META, decimalHours, miles, shortDate } from "../lib/format";
import { downloadBlob, svgToPngBlob } from "../lib/exportImage";

type View = "stack" | "single";

export default function LogSheets({ plan }: { plan: TripPlan }) {
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<View>("stack");
  const [active, setActive] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const days = plan.log_days;
  const visible = view === "stack" ? days : [days[active]];

  async function exportPng() {
    setError(null);
    setBusy(true);
    try {
      const svgs = Array.from(
        hostRef.current?.querySelectorAll("svg") ?? []
      ) as SVGSVGElement[];
      if (svgs.length === 0) throw new Error("Nothing to export yet.");
      // The editor shows a single sheet, so the on-screen SVGs are the source
      // of truth for what gets exported rather than the `visible` list.
      for (let i = 0; i < svgs.length; i += 1) {
        const label =
          svgs[i].getAttribute("aria-label")?.replace(/^Driver's daily log for /, "") ??
          `sheet-${i + 1}`;
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const blob = await svgToPngBlob(svgs[i]);
        downloadBlob(blob, `eld-log-${slug || i + 1}.png`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Record of duty status</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">
            Driver&apos;s daily logs
            <span className="ml-2 text-sm font-medium text-subtle">
              {days.length} {days.length === 1 ? "sheet" : "sheets"}
            </span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Legend />
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={editing ? "btn btn-primary !py-2" : "btn btn-ghost !py-2"}
          >
            ✎ {editing ? "Editing" : "Edit logs"}
          </button>
          {!editing && (
            <>
              <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-line">
                {(["stack", "single"] as View[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setView(mode)}
                    className={`px-3 py-2 text-[0.78rem] font-semibold transition-colors ${
                      view === mode
                        ? "bg-accent-soft text-accent"
                        : "bg-surface-2 text-muted hover:text-ink"
                    }`}
                  >
                    {mode === "stack" ? "All days" : "One day"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setReplayKey((k) => k + 1)}
                className="btn btn-ghost !py-2"
                title="Replay the drawing animation"
              >
                ↻ Replay
              </button>
            </>
          )}
          <button
            type="button"
            onClick={exportPng}
            disabled={busy}
            className="btn btn-ghost !py-2"
          >
            {busy ? "Exporting…" : "↓ PNG"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn btn-ghost !py-2"
          >
            ⎙ Print / PDF
          </button>
        </div>
      </div>

      {error && (
        <p className="no-print text-[0.8rem] text-danger">{error}</p>
      )}

      {!editing && view === "single" && (
        <div className="no-print flex flex-wrap gap-2">
          {days.map((day, i) => (
            <button
              key={day.date}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                active === i
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <span className="block text-[0.7rem] font-bold uppercase tracking-wider text-subtle">
                Day {day.day_number}
              </span>
              <span className="block text-[0.82rem] font-semibold text-ink">
                {shortDate(day.date)}
              </span>
              <span className="num block text-[0.7rem] text-subtle">
                {miles(day.miles_driving)} mi · {decimalHours(day.totals.D.minutes)} h
                driving
              </span>
            </button>
          ))}
        </div>
      )}

      {/* The export helpers read the SVGs under this node, so it wraps both
          the read-only stack and the editor. */}
      <div ref={hostRef} className="space-y-5">
        {editing ? (
          <LogEditor
            days={days}
            cycleUsedStart={plan.summary.cycle_used_start}
            onExit={() => setEditing(false)}
          />
        ) : (
          visible.map((day, i) => (
            <motion.div
              key={`${day.date}-${view}`}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              <LogSheet day={day} order={i} replayKey={replayKey} />
            </motion.div>
          ))
        )}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="hidden items-center gap-2.5 rounded-[var(--radius-sm)] border border-line bg-surface-2 px-3 py-2 lg:flex">
      {(["OFF", "SB", "D", "ON"] as const).map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: DUTY_META[status].color }}
          />
          <span className="text-[0.7rem] text-muted">
            {DUTY_META[status].line}. {DUTY_META[status].short}
          </span>
        </span>
      ))}
    </div>
  );
}
