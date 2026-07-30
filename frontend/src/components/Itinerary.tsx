import { motion } from "framer-motion";
import type { TripPlan } from "../types";
import { STOP_META, dateTime, duration, miles, timeOfDay } from "../lib/format";

interface Props {
  plan: TripPlan;
  activeStop: number | null;
  onSelectStop: (index: number | null) => void;
}

export default function Itinerary({ plan, activeStop, onSelectStop }: Props) {
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow">Itinerary</p>
        <h3 className="mt-0.5 text-sm font-bold text-ink">
          {plan.stops.length} stops · {miles(plan.summary.total_miles)} mi
        </h3>
      </div>

      <ol className="relative flex-1 overflow-auto px-4 py-3">
        {/* Spine */}
        <span
          aria-hidden
          className="absolute bottom-6 left-[1.72rem] top-6 w-px"
          style={{ background: "var(--border)" }}
        />
        {plan.stops.map((stop, i) => {
          const meta = STOP_META[stop.kind] ?? STOP_META.break;
          const active = activeStop === i;
          return (
            <motion.li
              key={`${stop.arrive}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + i * 0.04, duration: 0.3 }}
              className="relative"
            >
              <button
                type="button"
                onClick={() => onSelectStop(active ? null : i)}
                className={`flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors ${
                  active ? "bg-surface-3" : "hover:bg-surface-2"
                }`}
              >
                <span
                  className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[0.66rem] font-bold"
                  style={{
                    borderColor: meta.color,
                    color: meta.color,
                    background: "var(--surface)",
                    boxShadow: active
                      ? `0 0 0 4px color-mix(in oklab, ${meta.color} 26%, transparent)`
                      : undefined,
                  }}
                >
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.84rem] font-semibold text-ink">
                      {stop.title}
                    </span>
                    <span className="num shrink-0 text-[0.72rem] text-muted">
                      {timeOfDay(stop.arrive)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[0.78rem] text-muted">
                    {stop.location}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] text-subtle">
                    <span className="num">mile {miles(stop.mile)}</span>
                    {stop.minutes > 0 && (
                      <span className="num">· {duration(stop.minutes)}</span>
                    )}
                    {active && <span>· until {dateTime(stop.depart)}</span>}
                  </span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
