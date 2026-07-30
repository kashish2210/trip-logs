import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";
import type { TripPlan } from "../types";
import { duration, miles } from "../lib/format";

function Counter({
  to,
  decimals = 0,
  suffix = "",
}: {
  to: number;
  decimals?: number;
  suffix?: string;
}) {
  const value = useMotionValue(0);
  const text = useTransform(value, (v) =>
    `${v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`
  );

  useEffect(() => {
    const controls = animate(value, to, { duration: 0.9, ease: "easeOut" });
    return () => controls.stop();
  }, [to, value]);

  return <motion.span>{text}</motion.span>;
}

interface Stat {
  label: string;
  node: React.ReactNode;
  sub: string;
  tone?: "accent" | "success" | "warning" | "danger";
  /** Word values need a smaller size than the numeric ones to fit the card. */
  wordy?: boolean;
}

export default function SummaryBar({ plan }: { plan: TripPlan }) {
  const s = plan.summary;
  const compliant = plan.compliance.compliant;

  const stats: Stat[] = [
    {
      label: "Distance",
      node: <Counter to={s.total_miles} />,
      sub: `mi · avg ${s.average_speed_mph} mph`,
    },
    {
      label: "Duration",
      node: <Counter to={s.elapsed_hours} decimals={1} />,
      sub: `h · ${duration(s.driving_minutes)} driving`,
    },
    {
      label: "Log sheets",
      node: <Counter to={s.days} />,
      sub: s.days === 1 ? "day" : "days on the road",
      tone: "accent",
    },
    {
      label: "Cycle left",
      node: <Counter to={s.cycle_remaining} decimals={1} />,
      sub: `of ${s.cycle_limit_hours} h · used ${s.cycle_used_end}`,
      tone: s.cycle_remaining < 8 ? "warning" : undefined,
    },
    {
      label: "Stops",
      node: (
        <Counter
          to={s.fuel_stops + s.rest_resets + s.short_breaks + s.cycle_restarts}
        />
      ),
      sub: `${s.rest_resets} rest · ${s.short_breaks} break · ${s.fuel_stops} fuel${
        s.cycle_restarts ? ` · ${s.cycle_restarts} restart` : ""
      }`,
    },
    {
      label: "HOS status",
      node: <span>{compliant ? "Compliant" : "Violation"}</span>,
      sub: compliant
        ? "all limits satisfied"
        : `${plan.compliance.issues.length} issue(s)`,
      tone: compliant ? "success" : "danger",
      wordy: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.35, ease: "easeOut" }}
          className="card p-3.5"
        >
          <p className="eyebrow">{stat.label}</p>
          <p
            className={`num mt-1.5 truncate font-bold tracking-tight ${
              stat.wordy ? "text-lg" : "text-2xl"
            }`}
            style={{
              color: stat.tone ? `var(--${stat.tone})` : "var(--ink)",
            }}
          >
            {stat.node}
          </p>
          <p className="mt-0.5 truncate text-[0.74rem] text-subtle">{stat.sub}</p>
        </motion.div>
      ))}
    </div>
  );
}

export function RouteLegs({ plan }: { plan: TripPlan }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.78rem] text-muted">
      {plan.waypoints.map((wp, i) => (
        <span key={wp.kind} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-subtle">
              — {miles(plan.route.legs[i - 1].miles)} mi ·{" "}
              {duration(plan.route.legs[i - 1].minutes)} →
            </span>
          )}
          <span className="chip">
            <span style={{ color: "var(--accent)" }}>
              {wp.kind === "origin" ? "◎" : wp.kind === "pickup" ? "↓" : "⚑"}
            </span>
            {wp.label}
          </span>
        </span>
      ))}
    </div>
  );
}
